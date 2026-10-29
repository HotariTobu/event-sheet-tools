//! Parallel workers own disjoint DFS continuations. Checkpoints remain ordinary
//! version-1 stacks, so the browser can resume them without a parallel runtime.
use crate::{
    Phase, Search,
    math::Val,
    search::{Frame, JS_MAX},
};
use anyhow::{Result, anyhow, ensure};
use std::{
    cmp::Ordering,
    collections::VecDeque,
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{
        Condvar, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering as AtomicOrdering},
    },
    thread,
    time::{Duration, Instant},
};

pub fn run(
    search: &mut Search,
    threads: usize,
    stopped: &AtomicBool,
    mut report: impl FnMut(&Search),
) -> Result<()> {
    ensure!(threads > 0, "スレッド数は1以上が必要です。");
    let mut reported = Instant::now();
    while !search.done() && !stopped.load(AtomicOrdering::Relaxed) {
        let before = search.state.phase;
        if threads > 1 && before == Phase::Exact {
            // Avoid starting workers when this single step proves the entire
            // remaining frontier exhausted (for example a zero-utility bound).
            search.step()?;
            if search.state.stack.is_empty() {
                search.step()?;
                return Ok(());
            }
            return exact(search, threads, stopped, report);
        }
        if threads > 1
            && before == Phase::Local
            && search.model.n * search.model.k >= threads.saturating_mul(16)
        {
            local_batch(search, threads, stopped)?;
        } else {
            search.step()?;
        }
        if search.state.phase != before || reported.elapsed() >= Duration::from_secs(1) {
            report(search);
            reported = Instant::now();
        }
    }
    if search.state.phase == Phase::Local
        && search
            .state
            .local
            .as_ref()
            .is_some_and(|local| local.best.is_some())
    {
        // A stopped checkpoint exposes the best candidate already evaluated.
        // Restart the sweep around that new incumbent rather than skipping its
        // earlier neighbours using a cursor from the previous assignment.
        let local = search.state.local.as_mut().unwrap();
        local.i = search.model.n;
        local.p = 0;
        search.step()?;
    }
    Ok(())
}

// Allocate a contiguous prefix of the current local sweep. Every allocated
// candidate finishes before joining; cancellation never creates cursor holes.
fn local_batch(search: &mut Search, threads: usize, stopped: &AtomicBool) -> Result<()> {
    let local = search.state.local.as_ref().unwrap();
    if local.i >= search.model.n {
        return search.step();
    }
    let start = local.i * search.model.k + local.p;
    let end = (start + threads.saturating_mul(16)).min(search.model.n * search.model.k);
    let next = AtomicUsize::new(start);
    let model = &search.model;
    let best = search.state.best.as_ref().unwrap();
    let results = thread::scope(|scope| {
        let mut handles = Vec::new();
        for _ in 0..threads.min(end - start) {
            handles.push(scope.spawn(|| {
                let mut winner: Option<(usize, Vec<isize>, Vec<Val>)> = None;
                while !stopped.load(AtomicOrdering::Relaxed) {
                    let index = next.fetch_add(1, AtomicOrdering::Relaxed);
                    if index >= end {
                        break;
                    }
                    let (i, p) = (index / model.k, index % model.k);
                    if best[i] == p as isize {
                        continue;
                    }
                    let j = best.iter().position(|&v| v == p as isize);
                    if j.is_some_and(|j| j < i) {
                        continue;
                    }
                    let mut pos = best.clone();
                    if let Some(j) = j {
                        pos[j] = pos[i];
                    }
                    pos[i] = p as isize;
                    if !model.valid(&pos, true) {
                        continue;
                    }
                    let score = model.score(&pos);
                    if winner.as_ref().is_none_or(|(old, _, value)| {
                        model.cmp(&score, value).then_with(|| old.cmp(&index)) == Ordering::Greater
                    }) {
                        winner = Some((index, pos, score));
                    }
                }
                winner
            }));
        }
        handles.into_iter().map(|h| h.join()).collect::<Vec<_>>()
    });
    // If any worker panics, preserve the original local cursor for a safe retry.
    let mut results = results
        .into_iter()
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|_| anyhow!("局所探索ワーカーが異常終了しました。"))?;
    results.sort_by_key(|x| x.as_ref().map(|x| x.0).unwrap_or(usize::MAX));
    for (_, pos, score) in results.into_iter().flatten() {
        if search.model.cmp(
            &score,
            search
                .local_score
                .as_ref()
                .or(search.best_score.as_ref())
                .unwrap(),
        ) == Ordering::Greater
        {
            search.state.local.as_mut().unwrap().best = Some(pos);
            search.local_score = Some(score);
        }
    }
    let cursor = next.load(AtomicOrdering::Relaxed).min(end);
    let local = search.state.local.as_mut().unwrap();
    local.i = cursor / model.k;
    local.p = cursor % model.k;
    Ok(())
}

struct Shared {
    queue: VecDeque<Vec<Frame>>,
    active: usize,
    best: Option<Vec<isize>>,
    score: Option<Vec<Val>>,
    nodes: u64,
    pruned: u64,
}
struct Pool {
    shared: Mutex<Shared>,
    wake: Condvar,
    failed: AtomicBool,
    finished: AtomicUsize,
}

fn add_count(total: &mut u64, delta: u64) -> Result<()> {
    *total = total
        .checked_add(delta)
        .filter(|&v| v <= JS_MAX)
        .ok_or_else(|| anyhow!("探索回数がブラウザと共通の整数範囲を超えます。"))?;
    Ok(())
}

fn exchange(search: &mut Search, shared: &mut Shared) -> Result<()> {
    add_count(&mut shared.nodes, search.state.nodes)?;
    add_count(&mut shared.pruned, search.state.pruned)?;
    search.state.nodes = 0;
    search.state.pruned = 0;
    if let Some(score) = &search.best_score
        && shared
            .score
            .as_ref()
            .is_none_or(|old| search.model.cmp(score, old) == Ordering::Greater)
    {
        shared.best = search.state.best.clone();
        shared.score = Some(score.clone());
    }
    search.state.best = shared.best.clone();
    search.best_score = shared.score.clone();
    Ok(())
}

fn worker(mut search: Search, pool: &Pool, threads: usize, stopped: &AtomicBool) -> Result<()> {
    loop {
        let mut shared = pool
            .shared
            .lock()
            .map_err(|_| anyhow!("探索状態の共有に失敗しました。"))?;
        loop {
            if stopped.load(AtomicOrdering::Relaxed) || pool.failed.load(AtomicOrdering::Relaxed) {
                return Ok(());
            }
            if let Some(stack) = shared.queue.pop_back() {
                search.state.stack = stack;
                search.state.nodes = 0;
                search.state.pruned = 0;
                search.state.best = shared.best.clone();
                search.best_score = shared.score.clone();
                shared.active += 1;
                break;
            }
            if shared.active == 0 {
                return Ok(());
            }
            shared = pool
                .wake
                .wait_timeout(shared, Duration::from_millis(20))
                .map_err(|_| anyhow!("探索状態の待機に失敗しました。"))?
                .0;
        }
        drop(shared);
        loop {
            let began = Instant::now();
            for _ in 0..32 {
                if search.state.stack.is_empty()
                    || stopped.load(AtomicOrdering::Relaxed)
                    || pool.failed.load(AtomicOrdering::Relaxed)
                {
                    break;
                }
                search.step()?;
                if began.elapsed() >= Duration::from_millis(10) {
                    break;
                }
            }
            let mut shared = pool
                .shared
                .lock()
                .map_err(|_| anyhow!("探索状態の共有に失敗しました。"))?;
            exchange(&mut search, &mut shared)?;
            if stopped.load(AtomicOrdering::Relaxed) || pool.failed.load(AtomicOrdering::Relaxed) {
                if !search.state.stack.is_empty() {
                    shared
                        .queue
                        .push_back(std::mem::take(&mut search.state.stack));
                }
                shared.active -= 1;
                pool.wake.notify_all();
                return Ok(());
            }
            if search.state.stack.is_empty() {
                shared.active -= 1;
                pool.wake.notify_all();
                break;
            }
            // A DFS ancestor's cursor already excludes its active descendant.
            // Giving its remaining siblings away cannot duplicate that subtree.
            if shared.queue.len() < threads && search.state.stack.len() > 1 {
                let frame = search.state.stack.remove(0);
                shared.queue.push_back(vec![frame]);
                pool.wake.notify_all();
            }
        }
    }
}

fn exact(
    search: &mut Search,
    threads: usize,
    stopped: &AtomicBool,
    mut report: impl FnMut(&Search),
) -> Result<()> {
    let pool = Pool {
        shared: Mutex::new(Shared {
            queue: VecDeque::from([search.state.stack.clone()]),
            active: 0,
            best: search.state.best.clone(),
            score: search.best_score.clone(),
            nodes: search.state.nodes,
            pruned: search.state.pruned,
        }),
        wake: Condvar::new(),
        failed: AtomicBool::new(false),
        finished: AtomicUsize::new(0),
    };
    // Keep the input frontier intact until all workers have returned. An error
    // or panic can then save this conservative frontier without losing branches.
    let results = thread::scope(|scope| {
        let mut handles = Vec::new();
        for _ in 0..threads {
            let search = search.clone();
            let pool = &pool;
            handles.push(scope.spawn(move || {
                let result =
                    catch_unwind(AssertUnwindSafe(|| worker(search, pool, threads, stopped)))
                        .unwrap_or_else(|_| Err(anyhow!("厳密探索ワーカーが異常終了しました。")));
                if result.is_err() {
                    pool.failed.store(true, AtomicOrdering::Relaxed);
                    pool.wake.notify_all();
                }
                let _guard = pool
                    .shared
                    .lock()
                    .unwrap_or_else(|error| error.into_inner());
                pool.finished.fetch_add(1, AtomicOrdering::Relaxed);
                pool.wake.notify_all();
                result
            }));
        }
        let mut reported = Instant::now();
        while pool.finished.load(AtomicOrdering::Relaxed) < threads {
            let shared = pool
                .shared
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if pool.finished.load(AtomicOrdering::Relaxed) < threads {
                let _guard = pool
                    .wake
                    .wait_timeout(shared, Duration::from_secs(1))
                    .unwrap_or_else(|error| error.into_inner());
            } else {
                drop(shared);
            }
            if reported.elapsed() >= Duration::from_secs(1) {
                if let Ok(shared) = pool.shared.lock() {
                    search.state.nodes = shared.nodes;
                    search.state.pruned = shared.pruned;
                    search.state.best = shared.best.clone();
                    search.best_score = shared.score.clone();
                }
                report(search);
                reported = Instant::now();
            }
        }
        handles.into_iter().map(|h| h.join()).collect::<Vec<_>>()
    });
    for result in results {
        result.map_err(|_| anyhow!("厳密探索ワーカーが異常終了しました。"))??;
    }
    let shared = pool
        .shared
        .into_inner()
        .map_err(|_| anyhow!("探索状態の共有に失敗しました。"))?;
    ensure!(shared.active == 0, "終了していない探索ワーカーがあります。");
    search.state.nodes = shared.nodes;
    search.state.pruned = shared.pruned;
    search.state.best = shared.best;
    search.best_score = shared.score;
    search.state.stack = shared.queue.into_iter().flatten().collect();
    if search.state.stack.is_empty() {
        search.state.phase = if search.state.best.is_some() {
            Phase::Complete
        } else {
            Phase::Infeasible
        };
    }
    Ok(())
}

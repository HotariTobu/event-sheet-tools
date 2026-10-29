use crate::{
    math::Val,
    model::{Job, Model},
};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashSet},
    sync::Arc,
};
pub(crate) const JS_MAX: u64 = 9_007_199_254_740_991;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Feasible,
    Local,
    Exact,
    Complete,
    Infeasible,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Frame {
    pub pos: Vec<isize>,
    pub remaining: Vec<usize>,
    pub opened: bool,
    #[serde(default)]
    pub g: Option<usize>,
    #[serde(default)]
    pub tables: Vec<Vec<usize>>,
    #[serde(default)]
    pub ti: usize,
    #[serde(default)]
    pub indices: Option<Vec<usize>>,
}
impl Frame {
    fn new(pos: Vec<isize>, remaining: Vec<usize>) -> Self {
        Self {
            pos,
            remaining,
            opened: false,
            g: None,
            tables: Vec::new(),
            ti: 0,
            indices: None,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Local {
    pub i: usize,
    pub p: usize,
    pub best: Option<Vec<isize>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FeasibleFrame {
    pub depth: usize,
    pub left: Vec<usize>,
    pub places: Vec<isize>,
    pub opened: bool,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub options: Vec<usize>,
    #[serde(default)]
    pub next: usize,
}
impl FeasibleFrame {
    fn new(depth: usize, left: Vec<usize>, places: Vec<isize>) -> Self {
        Self {
            depth,
            left,
            places,
            opened: false,
            key: None,
            options: Vec::new(),
            next: 0,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Feasible {
    pub order: Vec<usize>,
    pub failed: BTreeMap<String, bool>,
    pub frames: Vec<FeasibleFrame>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct State {
    pub phase: Phase,
    pub best: Option<Vec<isize>>,
    pub nodes: u64,
    pub pruned: u64,
    pub stack: Vec<Frame>,
    pub local: Option<Local>,
    #[serde(default)]
    pub feasible: Option<Feasible>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Snapshot {
    pub version: u32,
    pub job: Value,
    pub state: State,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}
#[derive(Clone)]
pub struct Search {
    pub model: Arc<Model>,
    pub state: State,
    raw_job: Value,
    extra: Map<String, Value>,
    pub(crate) best_score: Option<Vec<Val>>,
    pub(crate) local_score: Option<Vec<Val>>,
}
impl Search {
    pub fn from_snapshot(snapshot: Snapshot) -> Result<Self> {
        ensure!(
            snapshot.version == 1,
            "JSONのバージョンに対応していません。"
        );
        let job: Job = serde_json::from_value(snapshot.job.clone())?;
        let model = Arc::new(Model::new(job)?);
        let mut state = snapshot.state;
        validate(&model, &mut state)?;
        let best_score = state.best.as_ref().map(|p| model.score(p));
        let local_score = state
            .local
            .as_ref()
            .and_then(|l| l.best.as_ref())
            .map(|p| model.score(p));
        Ok(Self {
            model,
            state,
            raw_job: snapshot.job,
            extra: snapshot.extra,
            best_score,
            local_score,
        })
    }
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            version: 1,
            job: self.raw_job.clone(),
            state: self.state.clone(),
            extra: self.extra.clone(),
        }
    }
    pub fn done(&self) -> bool {
        matches!(self.state.phase, Phase::Complete | Phase::Infeasible)
    }
    pub fn minimum_utility(&self) -> Option<f64> {
        self.best_score
            .as_ref()
            .and_then(|s| s.first())
            .map(Val::approx)
    }
    pub fn step(&mut self) -> Result<()> {
        if self.done() {
            return Ok(());
        }
        if self.state.phase == Phase::Feasible {
            return self.feasible_step();
        }
        let m = &self.model;
        let s = &mut self.state;
        if s.phase == Phase::Local {
            let l = s.local.as_mut().unwrap();
            if l.i >= m.n {
                if let Some(best) = l.best.take() {
                    s.best = Some(best);
                    self.best_score = self.local_score.take();
                    s.local = Some(Local {
                        i: 0,
                        p: 0,
                        best: None,
                    });
                } else {
                    s.phase = Phase::Exact;
                    s.local = None;
                    s.stack = vec![Frame::new(vec![-1; m.n], (0..m.groups.len()).collect())];
                }
                return Ok(());
            }
            let (i, p) = (l.i, l.p);
            l.p += 1;
            if l.p >= m.k {
                l.p = 0;
                l.i += 1;
            }
            let best = s.best.as_ref().unwrap();
            if best[i] == p as isize {
                return Ok(());
            }
            let j = best.iter().position(|&v| v == p as isize);
            if j.is_some_and(|j| j < i) {
                return Ok(());
            }
            let mut pos = best.clone();
            if let Some(j) = j {
                pos[j] = pos[i];
            }
            pos[i] = p as isize;
            if !m.valid(&pos, true) {
                return Ok(());
            }
            let score = m.score(&pos);
            if m.cmp(
                &score,
                self.local_score
                    .as_ref()
                    .or(self.best_score.as_ref())
                    .unwrap(),
            ) == Ordering::Greater
            {
                l.best = Some(pos);
                self.local_score = Some(score);
            }
            return Ok(());
        }
        let Some(frame) = s.stack.last_mut() else {
            s.phase = if s.best.is_some() {
                Phase::Complete
            } else {
                Phase::Infeasible
            };
            return Ok(());
        };
        if !frame.opened {
            bump(&mut s.nodes)?;
            if frame.remaining.is_empty() {
                let score = m.score(&frame.pos);
                if self
                    .best_score
                    .as_ref()
                    .is_none_or(|b| m.cmp(&score, b) == Ordering::Greater)
                {
                    s.best = Some(frame.pos.clone());
                    self.best_score = Some(score);
                }
                s.stack.pop();
                return Ok(());
            }
            if s.phase == Phase::Exact
                && self
                    .best_score
                    .as_ref()
                    .is_some_and(|b| m.cmp(&m.upper(&frame.pos), b) != Ordering::Greater)
            {
                bump(&mut s.pruned)?;
                s.stack.pop();
                return Ok(());
            }
            if !open_frame(m, frame) {
                bump(&mut s.pruned)?;
                s.stack.pop();
                return Ok(());
            }
        }
        if let Some(child) = child(m, frame) {
            s.stack.push(child);
        } else {
            s.stack.pop();
        }
        Ok(())
    }
    fn feasible_step(&mut self) -> Result<()> {
        let m = &self.model;
        let s = &mut self.state;
        let f = s.feasible.as_mut().unwrap();
        let Some(frame) = f.frames.last_mut() else {
            s.phase = Phase::Infeasible;
            s.feasible = None;
            return Ok(());
        };
        if !frame.opened {
            bump(&mut s.nodes)?;
            if frame.depth == f.order.len() {
                let mut pos = vec![-1; m.n];
                let mut cursor = vec![0; m.tables.len()];
                for &g in &f.order {
                    for &i in &m.groups[g] {
                        let t = frame.places[g] as usize;
                        pos[i] = m.tables[t][cursor[t]] as isize;
                        cursor[t] += 1;
                    }
                }
                ensure!(m.valid(&pos, true), "初期配置の検証に失敗しました。");
                self.best_score = Some(m.score(&pos));
                s.best = Some(pos);
                s.phase = Phase::Local;
                s.local = Some(Local {
                    i: 0,
                    p: 0,
                    best: None,
                });
                s.feasible = None;
                return Ok(());
            }
            let key = feasible_key(frame);
            frame.key = Some(key.clone());
            if f.failed.get(&key) == Some(&true) {
                bump(&mut s.pruned)?;
                f.frames.pop();
                return Ok(());
            }
            frame.options = feasible_options(m, &f.order, frame);
            frame.next = 0;
            frame.opened = true;
        }
        if frame.next >= frame.options.len() {
            f.failed.insert(frame.key.clone().unwrap(), true);
            bump(&mut s.pruned)?;
            f.frames.pop();
            return Ok(());
        }
        let t = frame.options[frame.next];
        frame.next += 1;
        let g = f.order[frame.depth];
        let mut left = frame.left.clone();
        let mut places = frame.places.clone();
        left[t] -= m.groups[g].len();
        places[g] = t as isize;
        let next = FeasibleFrame::new(frame.depth + 1, left, places);
        f.frames.push(next);
        Ok(())
    }
}
fn bump(counter: &mut u64) -> Result<()> {
    ensure!(
        *counter < JS_MAX,
        "探索回数がブラウザと共通の整数範囲を超えます。"
    );
    *counter += 1;
    Ok(())
}
fn feasible_key(frame: &FeasibleFrame) -> String {
    let mut left = frame.left.clone();
    left.sort_unstable();
    format!(
        "{}|{}",
        frame.depth,
        left.iter()
            .map(usize::to_string)
            .collect::<Vec<_>>()
            .join(",")
    )
}
fn feasible_options(m: &Model, order: &[usize], f: &FeasibleFrame) -> Vec<usize> {
    let need = m.groups[order[f.depth]].len();
    let mut options: Vec<_> = (0..m.tables.len()).filter(|&t| f.left[t] >= need).collect();
    options.sort_by_key(|&t| (f.left[t], t));
    let mut tried = HashSet::new();
    options.retain(|&t| tried.insert(f.left[t]));
    options
}
fn open_frame(m: &Model, f: &mut Frame) -> bool {
    let used: HashSet<_> = f
        .pos
        .iter()
        .copied()
        .filter(|&p| p >= 0)
        .map(|p| p as usize)
        .collect();
    let mut best: Option<(usize, usize, Vec<Vec<usize>>, f64)> = None;
    for &g in &f.remaining {
        let size = m.groups[g].len();
        let tables: Vec<Vec<_>> = m
            .tables
            .iter()
            .map(|t| {
                t.iter()
                    .copied()
                    .filter(|p| !used.contains(p))
                    .collect::<Vec<_>>()
            })
            .filter(|t| t.len() >= size)
            .collect();
        if tables.is_empty() {
            return false;
        }
        let mut count = 0.0;
        for t in &tables {
            let mut n = 1.0;
            for k in 0..size {
                n *= (t.len() - k) as f64;
            }
            count += n;
        }
        if best.as_ref().is_none_or(|(bg, bs, _, bc)| {
            count < *bc || count == *bc && (size > *bs || size == *bs && g < *bg)
        }) {
            best = Some((g, size, tables, count));
        }
    }
    let (g, _, tables, _) = best.unwrap();
    f.opened = true;
    f.g = Some(g);
    f.tables = tables;
    f.ti = 0;
    f.indices = None;
    true
}
fn child(m: &Model, f: &mut Frame) -> Option<Frame> {
    let group = &m.groups[f.g.unwrap()];
    while f.ti < f.tables.len() {
        let seats = &f.tables[f.ti];
        match &mut f.indices {
            None => f.indices = Some((0..group.len()).collect()),
            Some(a) => {
                if !next_injection(a, seats.len()) {
                    f.ti += 1;
                    f.indices = None;
                    continue;
                }
            }
        }
        let mut pos = f.pos.clone();
        for (k, &i) in group.iter().enumerate() {
            pos[i] = seats[f.indices.as_ref().unwrap()[k]] as isize;
        }
        return Some(Frame::new(
            pos,
            f.remaining
                .iter()
                .copied()
                .filter(|g| Some(*g) != f.g)
                .collect(),
        ));
    }
    None
}
fn next_injection(a: &mut [usize], n: usize) -> bool {
    for k in (0..a.len()).rev() {
        let mut used: HashSet<_> = a[..k].iter().copied().collect();
        let mut v = a[k] + 1;
        while v < n && used.contains(&v) {
            v += 1;
        }
        if v == n {
            continue;
        }
        a[k] = v;
        used.insert(v);
        for item in a.iter_mut().skip(k + 1) {
            let mut q = 0;
            while used.contains(&q) {
                q += 1;
            }
            *item = q;
            used.insert(q);
        }
        return true;
    }
    false
}
fn validate(m: &Model, s: &mut State) -> Result<()> {
    ensure!(
        s.nodes <= JS_MAX && s.pruned <= JS_MAX,
        "探索回数が不正です。"
    );
    if let Some(best) = &s.best {
        ensure!(m.valid(best, true), "保存した配置が制約を満たしません。");
    }
    for frame in &s.stack {
        ensure!(m.valid(&frame.pos, false), "保存した探索木が不正です。");
        let mut remaining = frame.remaining.clone();
        remaining.sort_unstable();
        let expected: Vec<_> = (0..m.groups.len())
            .filter(|&g| m.groups[g].iter().all(|&i| frame.pos[i] < 0))
            .collect();
        ensure!(
            remaining == expected
                && !m
                    .groups
                    .iter()
                    .any(|g| g.iter().any(|&i| frame.pos[i] < 0)
                        && g.iter().any(|&i| frame.pos[i] >= 0)),
            "保存した同伴者グループが不正です。"
        );
        if frame.opened {
            let g = frame
                .g
                .filter(|g| frame.remaining.contains(g))
                .ok_or_else(|| anyhow::anyhow!("探索中のグループが不正です。"))?;
            ensure!(
                frame.ti <= frame.tables.len() && !frame.tables.is_empty(),
                "探索中の卓が不正です。"
            );
            for table in &frame.tables {
                let mut used = HashSet::new();
                ensure!(
                    table.len() >= m.groups[g].len()
                        && table.iter().all(|&p| p < m.k
                            && !frame.pos.contains(&(p as isize))
                            && used.insert(p)),
                    "探索中の席が不正です。"
                );
                ensure!(table.iter().all(|&p|m.job.layout.seats[p].table==m.job.layout.seats[table[0]].table),"探索中の卓が不正です。");
            }
            if let Some(a) = &frame.indices {
                let mut used = HashSet::new();
                ensure!(
                    frame.ti < frame.tables.len()
                        && a.len() == m.groups[g].len()
                        && a.iter()
                            .all(|&p| p < frame.tables[frame.ti].len() && used.insert(p)),
                    "探索中の順列が不正です。"
                );
            }
        }
    }
    if s.phase == Phase::Feasible {
        if s.feasible.is_none() {
            s.stack.clear();
            s.feasible = Some(Feasible {
                order: m.group_order(),
                failed: BTreeMap::new(),
                frames: vec![FeasibleFrame::new(
                    0,
                    m.tables.iter().map(Vec::len).collect(),
                    vec![-1; m.groups.len()],
                )],
            });
        }
        let f = s.feasible.as_ref().unwrap();
        ensure!(f.order == m.group_order(), "保存した初期探索順が不正です。");
        for frame in &f.frames {
            ensure!(
                frame.depth <= f.order.len()
                    && frame.left.len() == m.tables.len()
                    && frame.places.len() == m.groups.len(),
                "保存した初期探索状態が不正です。"
            );
            let mut left: Vec<_> = m.tables.iter().map(Vec::len).collect();
            for (k, &g) in f.order.iter().enumerate() {
                let t = frame.places[g];
                if k >= frame.depth {
                    ensure!(t == -1, "保存したグループ配置が不正です。");
                } else {
                    ensure!(
                        t >= 0 && (t as usize) < m.tables.len(),
                        "保存した卓が不正です。"
                    );
                    left[t as usize] = left[t as usize]
                        .checked_sub(m.groups[g].len())
                        .ok_or_else(|| anyhow::anyhow!("残席数が不正です。"))?;
                }
            }
            ensure!(left == frame.left, "保存した残席数が不正です。");
            if frame.opened {
                ensure!(
                    frame.depth < f.order.len()
                        && frame.key.as_deref() == Some(feasible_key(frame).as_str())
                        && frame.options == feasible_options(m, &f.order, frame)
                        && frame.next <= frame.options.len(),
                    "保存した初期探索カーソルが不正です。"
                );
            }
        }
    }
    if s.phase == Phase::Local {
        ensure!(s.best.is_some(), "局所探索の配置がありません。");
        let l = s
            .local
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("局所探索状態がありません。"))?;
        ensure!(
            l.i <= m.n && l.p < m.k && l.best.as_ref().is_none_or(|p| m.valid(p, true)),
            "局所探索状態が不正です。"
        );
    }
    if s.phase == Phase::Complete {
        ensure!(
            s.best.is_some() && s.stack.is_empty(),
            "完了状態が不正です。"
        );
    }
    if s.phase == Phase::Infeasible {
        ensure!(
            s.best.is_none() && s.stack.is_empty(),
            "配置不可能の状態が不正です。"
        );
    }
    Ok(())
}

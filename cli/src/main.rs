use anyhow::{Context, Result};
use chrono::Local;
use clap::Parser;
use seat_solver::{Phase, Search, Snapshot};
use std::{
    fs::{self, OpenOptions},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
#[derive(Parser)]
#[command(name = "seat-solver", version, about = "座席割当を計算します。")]
struct Args {
    #[arg(help = "チェックポイントファイル")]
    input: PathBuf,
}
fn write_snapshot(input: &Path, snapshot: &Snapshot) -> Result<PathBuf> {
    let parent = input
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let path = parent.join(Local::now().format("checkpoint-%m%d-%H%M.json").to_string());
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .with_context(|| format!("JSONを作成できません：{}", path.display()))?;
    let result = (|| {
        let mut writer = BufWriter::new(file);
        serde_json::to_writer(&mut writer, snapshot)?;
        writer.write_all(b"\n")?;
        writer.flush()?;
        writer.get_ref().sync_all()?;
        Ok::<_, anyhow::Error>(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&path);
        return Err(error.context(format!("JSONを保存できません：{}", path.display())));
    }
    Ok(path)
}
fn report(search: &Search) {
    let phase = match search.state.phase {
        Phase::Feasible => "初期配置探索",
        Phase::Local => "局所改善",
        Phase::Exact => "厳密探索",
        Phase::Complete => "厳密探索完了",
        Phase::Infeasible => "配置不可能",
    };
    let score = search
        .minimum_utility()
        .map(|v| format!("｜最低効用: {v:.7}"))
        .unwrap_or_default();
    eprintln!(
        "{phase}｜探索節点: {}　除外した枝: {}{score}",
        search.state.nodes, search.state.pruned
    );
}
fn run() -> Result<()> {
    let args = Args::parse();
    let stopped = Arc::new(AtomicBool::new(false));
    let flag = stopped.clone();
    ctrlc::set_handler(move || flag.store(true, Ordering::Relaxed))?;
    let text = fs::read_to_string(&args.input)
        .with_context(|| format!("JSONを読み込めません：{}", args.input.display()))?;
    let snapshot: Snapshot = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .context("探索状態JSONの読み込みに失敗しました。")?;
    eprintln!("入力を検証・前処理中…");
    let mut search = Search::from_snapshot(snapshot)?;
    eprintln!(
        "{}人 / {}席 / {}作品",
        search.model.n, search.model.k, search.model.m
    );
    report(&search);
    let threads = std::thread::available_parallelism().map_or(1, usize::from);
    if let Err(error) = seat_solver::parallel::run(&mut search, threads, &stopped, report) {
        let output = write_snapshot(&args.input, &search.snapshot())?;
        eprintln!("保存しました：{}", output.display());
        return Err(error.context("探索を停止し、その時点の状態を保存しました。"));
    }
    let output = write_snapshot(&args.input, &search.snapshot())?;
    report(&search);
    if !search.done() {
        eprintln!("中断しました。次回は保存先JSONを入力にして再開できます。");
    }
    eprintln!("保存しました：{}", output.display());
    Ok(())
}
fn main() {
    if let Err(e) = run() {
        eprintln!("エラー：{e:#}");
        std::process::exit(1);
    }
}

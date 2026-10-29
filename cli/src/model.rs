use crate::math::{self, Arithmetic, Val};
use anyhow::{Result, ensure};
use num_bigint::BigInt;
use serde::Deserialize;
use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
    sync::Mutex,
};
#[derive(Clone, Deserialize)]
pub struct Person {
    pub nickname: String,
    #[serde(default)]
    pub passphrase: String,
    pub levels: Vec<u8>,
    pub favorites: Vec<Vec<String>>,
}
#[derive(Clone, Deserialize)]
pub struct Seat {
    pub row: i64,
    pub col: i64,
    pub table: String,
    pub label: String,
}
#[derive(Clone, Deserialize)]
pub struct Layout {
    pub seats: Vec<Seat>,
    #[serde(default)]
    pub walls: Vec<[i64; 4]>,
}
#[derive(Clone, Deserialize)]
pub struct Job {
    pub version: u32,
    pub people: Vec<Person>,
    pub works: Vec<String>,
    pub layout: Layout,
    pub horizontal: String,
    pub vertical: String,
}
pub struct Model {
    pub job: Job,
    pub n: usize,
    pub k: usize,
    pub m: usize,
    pub groups: Vec<Vec<usize>>,
    pub tables: Vec<Vec<usize>>,
    pub ar: Mutex<Arithmetic>,
    pub s: Vec<Vec<Val>>,
    pub w: Vec<Vec<Val>>,
    sorted_people: Vec<Vec<usize>>,
    sorted_seats: Vec<Vec<usize>>,
}
impl Model {
    pub fn new(job: Job) -> Result<Self> {
        let (n, k, m) = (job.people.len(), job.layout.seats.len(), job.works.len());
        ensure!(job.version == 1, "入力バージョンに対応していません。");
        ensure!(n > 0 && m > 0, "参加者と作品が必要です。");
        ensure!(n <= k, "総席数が不足しています。参加者{n}人、座席{k}席。");
        ensure!(m.checked_mul(256).is_some(), "作品数が大きすぎます。");
        let (mut positions, mut labels) = (HashSet::new(), HashSet::new());
        for seat in &job.layout.seats {
            ensure!(
                seat.row > 0
                    && seat.col > 0
                    && seat.row <= 9_007_199_254_740_991
                    && seat.col <= 9_007_199_254_740_991
                    && !seat.table.is_empty(),
                "座席位置・卓IDが不正です。"
            );
            ensure!(
                positions.insert((seat.row, seat.col)) && labels.insert(&seat.label),
                "座席位置または識別子が重複しています。"
            );
        }
        for wall in &job.layout.walls {
            ensure!(
                wall.iter()
                    .all(|x| x.unsigned_abs() <= 9_007_199_254_740_991),
                "壁の座標が不正です。"
            );
        }
        let mut groups: Vec<Vec<usize>> = Vec::new();
        let mut phrases: HashMap<String, usize> = HashMap::new();
        for (i, p) in job.people.iter().enumerate() {
            ensure!(
                !p.nickname.is_empty()
                    && p.levels.len() == m
                    && p.favorites.len() == m
                    && p.levels.iter().all(|v| (1..=5).contains(v)),
                "参加者の作品レベル・推しが不正です。"
            );
            if !p.passphrase.is_empty() && phrases.contains_key(&p.passphrase) {
                groups[*phrases.get(&p.passphrase).unwrap()].push(i);
            } else {
                if !p.passphrase.is_empty() {
                    phrases.insert(p.passphrase.clone(), groups.len());
                }
                groups.push(vec![i]);
            }
        }
        let mut tables: Vec<Vec<usize>> = Vec::new();
        let mut table_ids: HashMap<String, usize> = HashMap::new();
        for (i, seat) in job.layout.seats.iter().enumerate() {
            if let Some(t) = table_ids.get(&seat.table) {
                tables[*t].push(i);
            } else {
                table_ids.insert(seat.table.clone(), tables.len());
                tables.push(vec![i]);
            }
        }
        let max = tables.iter().map(Vec::len).max().unwrap();
        ensure!(
            groups.iter().all(|g| g.len() <= max),
            "同伴者グループが最大の卓の定員を超えています。"
        );
        let ar = Mutex::new(Arithmetic::default());
        let delta = math::delta(&ar, m);
        let mut common = vec![vec![0usize; n]; n];
        let mut cmax = 0;
        for (i, _) in job.people.iter().enumerate() {
            for (j, _) in job.people.iter().enumerate().skip(i + 1) {
                let mut c = 0;
                for t in 0..m {
                    let a: HashSet<_> = job.people[i].favorites[t]
                        .iter()
                        .filter(|x| !x.is_empty())
                        .collect();
                    let b: HashSet<_> = job.people[j].favorites[t].iter().collect();
                    c += a.intersection(&b).count();
                }
                common[i][j] = c;
                common[j][i] = c;
                cmax = cmax.max(c);
            }
        }
        let zero = Val::int(0);
        let mut s = vec![vec![zero.clone(); n]; n];
        for (i, _) in job.people.iter().enumerate() {
            for (j, _) in job.people.iter().enumerate().skip(i + 1) {
                let mut distance = 0;
                for t in 0..m {
                    let a = (job.people[i].levels[t] as i32 - 1).pow(2);
                    let b = (job.people[j].levels[t] as i32 - 1).pow(2);
                    distance += (a - b).pow(2) as usize;
                }
                let value = Val::base(distance)
                    .add(&delta.mul(&Val::rat(common[i][j].into(), (cmax + 1).into())));
                s[i][j] = value.clone();
                s[j][i] = value;
            }
        }
        let h = math::decimal(&job.horizontal)?;
        let v = math::decimal(&job.vertical)?;
        let den = h.denom() * v.denom();
        let hh = h.numer() * v.denom();
        let vv = v.numer() * h.denom();
        let mut w = vec![vec![zero; k]; k];
        for (p, a) in job.layout.seats.iter().enumerate() {
            for (q, b) in job.layout.seats.iter().enumerate().skip(p + 1) {
                if job
                    .layout
                    .walls
                    .iter()
                    .any(|wall| crossing([2 * a.col, 2 * a.row], [2 * b.col, 2 * b.row], *wall))
                {
                    continue;
                }
                let dx = &hh * BigInt::from(a.col - b.col);
                let dy = &vv * BigInt::from(a.row - b.row);
                let r = &dx * &dx + &dy * &dy;
                let value = Val::inverse_root(r, den.clone());
                w[p][q] = value.clone();
                w[q][p] = value;
            }
        }
        let sorted_people = s
            .iter()
            .map(|row| {
                let mut order: Vec<_> = (0..n).collect();
                order.sort_by(|&a, &b| math::compare(&ar, &row[b], &row[a]).then(a.cmp(&b)));
                order
            })
            .collect();
        let sorted_seats = w
            .iter()
            .map(|row| {
                let mut order: Vec<_> = (0..k).collect();
                order.sort_by(|&a, &b| math::compare(&ar, &row[b], &row[a]).then(a.cmp(&b)));
                order
            })
            .collect();
        Ok(Self {
            job,
            n,
            k,
            m,
            groups,
            tables,
            ar,
            s,
            w,
            sorted_people,
            sorted_seats,
        })
    }
    pub fn valid(&self, pos: &[isize], complete: bool) -> bool {
        if pos.len() != self.n {
            return false;
        }
        let mut used = HashSet::new();
        for &p in pos {
            if p == -1 && !complete {
                continue;
            }
            if p < 0 || p as usize >= self.k || !used.insert(p) {
                return false;
            }
        }
        self.groups.iter().all(|g| {
            let mut table = None;
            for &i in g {
                if pos[i] >= 0 {
                    let t = &self.job.layout.seats[pos[i] as usize].table;
                    if table.is_some_and(|old| old != t) {
                        return false;
                    }
                    table = Some(t);
                }
            }
            true
        })
    }
    pub fn score(&self, pos: &[isize]) -> Vec<Val> {
        let mut u = vec![Val::int(0); self.n];
        for i in 0..self.n {
            for j in i + 1..self.n {
                let e = self.s[i][j].mul(&self.w[pos[i] as usize][pos[j] as usize]);
                u[i] = u[i].add(&e);
                u[j] = u[j].add(&e);
            }
        }
        u.sort_by(|a, b| math::compare(&self.ar, a, b));
        u
    }
    pub fn cmp(&self, a: &[Val], b: &[Val]) -> Ordering {
        for (x, y) in a.iter().zip(b) {
            let c = math::compare(&self.ar, x, y);
            if c != Ordering::Equal {
                return c;
            }
        }
        Ordering::Equal
    }
    pub fn upper(&self, pos: &[isize]) -> Vec<Val> {
        let used: HashSet<_> = pos
            .iter()
            .copied()
            .filter(|&p| p >= 0)
            .map(|p| p as usize)
            .collect();
        let free: Vec<_> = (0..self.k).filter(|p| !used.contains(p)).collect();
        let mut upper = Vec::with_capacity(self.n);
        for i in 0..self.n {
            let others: Vec<_> = self.sorted_people[i]
                .iter()
                .copied()
                .filter(|&j| j != i && pos[j] < 0)
                .collect();
            let candidates = if pos[i] >= 0 {
                vec![pos[i] as usize]
            } else {
                free.clone()
            };
            let mut best = None;
            for p in candidates {
                let mut u = Val::int(0);
                for (j, &placed) in pos.iter().enumerate() {
                    if j != i && placed >= 0 {
                        u = u.add(&self.s[i][j].mul(&self.w[p][placed as usize]));
                    }
                }
                let near: Vec<_> = self.sorted_seats[p]
                    .iter()
                    .copied()
                    .filter(|&q| q != p && !used.contains(&q))
                    .collect();
                for (t, &j) in others.iter().enumerate() {
                    u = u.add(&self.s[i][j].mul(&self.w[p][near[t]]));
                }
                if best
                    .as_ref()
                    .is_none_or(|b| math::compare(&self.ar, &u, b) == Ordering::Greater)
                {
                    best = Some(u);
                }
            }
            upper.push(best.unwrap());
        }
        upper.sort_by(|a, b| math::compare(&self.ar, a, b));
        upper
    }
    pub fn group_order(&self) -> Vec<usize> {
        let mut v: Vec<_> = (0..self.groups.len()).collect();
        v.sort_by(|&a, &b| {
            self.groups[b]
                .len()
                .cmp(&self.groups[a].len())
                .then(a.cmp(&b))
        });
        v
    }
}
pub fn crossing(a: [i64; 2], b: [i64; 2], wall: [i64; 4]) -> bool {
    let c = [wall[0], wall[1]];
    let d = [wall[2], wall[3]];
    let turn = |p: [i64; 2], q: [i64; 2], r: [i64; 2]| {
        (q[0] as i128 - p[0] as i128) * (r[1] as i128 - p[1] as i128)
            - (q[1] as i128 - p[1] as i128) * (r[0] as i128 - p[0] as i128)
    };
    let on = |p: [i64; 2], q: [i64; 2], r: [i64; 2]| {
        p[0].min(q[0]) <= r[0]
            && r[0] <= p[0].max(q[0])
            && p[1].min(q[1]) <= r[1]
            && r[1] <= p[1].max(q[1])
    };
    let (u, v, w, x) = (turn(a, b, c), turn(a, b, d), turn(c, d, a), turn(c, d, b));
    ((u < 0 && v > 0 || u > 0 && v < 0) && (w < 0 && x > 0 || w > 0 && x < 0))
        || (u == 0 && on(a, b, c))
        || (v == 0 && on(a, b, d))
        || (w == 0 && on(c, d, a))
        || (x == 0 && on(c, d, b))
}

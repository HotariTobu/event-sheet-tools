//! 64-bit fixed-point intervals, with exact radical polynomials when intervals overlap.
use anyhow::{Result, bail, ensure};
use num_bigint::BigInt;
use num_integer::Integer;
use num_rational::BigRational as Q;
use num_traits::{One, Signed, ToPrimitive, Zero};
use std::{
    cmp::Ordering,
    collections::BTreeMap,
    sync::{Arc, LazyLock, Mutex, OnceLock},
};
static SCALE: LazyLock<BigInt> = LazyLock::new(|| BigInt::one() << 64usize);
type Poly = BTreeMap<BigInt, Q>;
#[derive(Default)]
pub struct Arithmetic {
    roots: Vec<BigInt>,
    canonical: BTreeMap<BigInt, (BigInt, Q)>,
    bounds: BTreeMap<(BigInt, usize), (BigInt, BigInt)>,
}
impl Arithmetic {
    fn radical(&mut self, r: &BigInt) -> (BigInt, Q) {
        if let Some(x) = self.canonical.get(r) {
            return x.clone();
        }
        let sq = r.sqrt();
        let mut answer = None;
        if &sq * &sq == *r {
            answer = Some((BigInt::one(), Q::from_integer(sq)));
        } else {
            for known in &self.roots {
                let g = r.gcd(known);
                let a = (r / &g).sqrt();
                let b = (known / &g).sqrt();
                if &a * &a == r / &g && &b * &b == known / &g {
                    answer = Some((known.clone(), Q::new(a, b)));
                    break;
                }
            }
        }
        let answer = answer.unwrap_or_else(|| {
            self.roots.push(r.clone());
            (r.clone(), Q::one())
        });
        self.canonical.insert(r.clone(), answer.clone());
        answer
    }
    fn root_poly(&mut self, r: &BigInt, q: &Q) -> Poly {
        let (k, f) = self.radical(r);
        let mut p = Poly::new();
        term(&mut p, k, q * f);
        p
    }
    fn multiply(&mut self, a: &Poly, b: &Poly) -> Poly {
        let mut p = Poly::new();
        for (r, x) in a {
            for (s, y) in b {
                let g = r.gcd(s);
                let (k, f) = self.radical(&((r / &g) * (s / &g)));
                term(&mut p, k, x * y * Q::from_integer(g) * f);
            }
        }
        p
    }
    fn bounds(&mut self, p: &Poly, bits: usize) -> (BigInt, BigInt) {
        let mut lo = BigInt::zero();
        let mut hi = BigInt::zero();
        for (r, q) in p {
            let key = (r.clone(), bits);
            let (a, b) = self.bounds.entry(key).or_insert_with(|| {
                let n = r << (bits * 2);
                let root = n.sqrt();
                let high = if &root * &root == n {
                    root.clone()
                } else {
                    &root + 1
                };
                (root, high)
            });
            let (x, y) = if q.is_negative() {
                (&*b, &*a)
            } else {
                (&*a, &*b)
            };
            lo += (q.numer() * x).div_floor(q.denom());
            hi += (q.numer() * y).div_ceil(q.denom());
        }
        (lo, hi)
    }
    fn sign(&mut self, p: &Poly) -> Ordering {
        if p.is_empty() {
            return Ordering::Equal;
        }
        let mut bits = 64;
        loop {
            let (lo, hi) = self.bounds(p, bits);
            if lo > BigInt::zero() {
                return Ordering::Greater;
            }
            if hi < BigInt::zero() {
                return Ordering::Less;
            }
            bits *= 2;
        }
    }
}
fn term(p: &mut Poly, r: BigInt, q: Q) {
    if q.is_zero() {
        return;
    }
    let sum = p.get(&r).cloned().unwrap_or_default() + q;
    if sum.is_zero() {
        p.remove(&r);
    } else {
        p.insert(r, sum);
    }
}
fn poly_add(a: &Poly, b: &Poly, negative: bool) -> Poly {
    let mut p = a.clone();
    for (r, q) in b {
        term(&mut p, r.clone(), if negative { -q } else { q.clone() });
    }
    p
}
#[derive(Clone)]
pub struct Val(Arc<Node>);
struct Node {
    lo: BigInt,
    hi: BigInt,
    approx: f64,
    poly: OnceLock<Poly>,
    expr: Expr,
}
enum Expr {
    Rat(Q),
    Root(BigInt, Q),
    Add(Val, Val),
    Sub(Val, Val),
    Mul(Val, Val),
    Base(usize),
}
impl Val {
    fn new(lo: BigInt, hi: BigInt, approx: f64, expr: Expr) -> Self {
        Self(Arc::new(Node {
            lo,
            hi,
            approx,
            expr,
            poly: OnceLock::new(),
        }))
    }
    pub fn rat(n: BigInt, d: BigInt) -> Self {
        let q = Q::new(n, d);
        let lo = (q.numer() * &*SCALE).div_floor(q.denom());
        let hi = (q.numer() * &*SCALE).div_ceil(q.denom());
        Self::new(lo, hi, q.to_f64().unwrap_or(f64::INFINITY), Expr::Rat(q))
    }
    pub fn int(n: i64) -> Self {
        Self::rat(n.into(), BigInt::one())
    }
    pub fn add(&self, b: &Self) -> Self {
        Self::new(
            &self.0.lo + &b.0.lo,
            &self.0.hi + &b.0.hi,
            self.approx() + b.approx(),
            Expr::Add(self.clone(), b.clone()),
        )
    }
    pub fn sub(&self, b: &Self) -> Self {
        Self::new(
            &self.0.lo - &b.0.hi,
            &self.0.hi - &b.0.lo,
            self.approx() - b.approx(),
            Expr::Sub(self.clone(), b.clone()),
        )
    }
    pub fn mul(&self, b: &Self) -> Self {
        let p = [
            &self.0.lo * &b.0.lo,
            &self.0.lo * &b.0.hi,
            &self.0.hi * &b.0.lo,
            &self.0.hi * &b.0.hi,
        ];
        let lo = p.iter().min().unwrap().div_floor(&SCALE);
        let hi = p.iter().max().unwrap().div_ceil(&SCALE);
        Self::new(
            lo,
            hi,
            self.approx() * b.approx(),
            Expr::Mul(self.clone(), b.clone()),
        )
    }
    pub fn base(n: usize) -> Self {
        let r = BigInt::from(n);
        let x = &r << 128usize;
        let lo = x.sqrt();
        let hi = if &lo * &lo == x { lo.clone() } else { &lo + 1 };
        let numerator = BigInt::from(16) << 128usize;
        Self::new(
            numerator.div_floor(&((&*SCALE << 4usize) + &hi)),
            numerator.div_ceil(&((&*SCALE << 4usize) + lo)),
            16.0 / (16.0 + (n as f64).sqrt()),
            Expr::Base(n),
        )
    }
    pub fn inverse_root(r: BigInt, den: BigInt) -> Self {
        let x = &r << 128usize;
        let lo = x.sqrt();
        let hi = if &lo * &lo == x { lo.clone() } else { &lo + 1 };
        let numerator = &den << 128usize;
        let approx = Q::new(&den * &den, r.clone())
            .to_f64()
            .unwrap_or(f64::INFINITY)
            .sqrt();
        Self::new(
            numerator.div_floor(&hi),
            numerator.div_ceil(&lo),
            approx,
            Expr::Root(r.clone(), Q::new(den, r)),
        )
    }
    pub fn approx(&self) -> f64 {
        self.0.approx
    }
    fn exact(&self, ar: &mut Arithmetic) -> &Poly {
        self.0.poly.get_or_init(|| match &self.0.expr {
            Expr::Rat(q) => {
                let mut p = Poly::new();
                term(&mut p, BigInt::one(), q.clone());
                p
            }
            Expr::Root(r, q) => ar.root_poly(r, q),
            Expr::Add(a, b) => poly_add(a.exact(ar), b.exact(ar), false),
            Expr::Sub(a, b) => poly_add(a.exact(ar), b.exact(ar), true),
            Expr::Mul(a, b) => {
                let a = a.exact(ar).clone();
                let b = b.exact(ar).clone();
                ar.multiply(&a, &b)
            }
            Expr::Base(n) => {
                if *n == 256 {
                    let mut p = Poly::new();
                    term(&mut p, BigInt::one(), Q::new(1.into(), 2.into()));
                    return p;
                }
                let d = BigInt::from(256) - BigInt::from(*n);
                let mut p = Poly::new();
                term(&mut p, BigInt::one(), Q::new(256.into(), d.clone()));
                let root = ar.root_poly(&BigInt::from(*n), &Q::new((-16).into(), d));
                poly_add(&p, &root, false)
            }
        })
    }
}
pub fn compare(ar: &Mutex<Arithmetic>, a: &Val, b: &Val) -> Ordering {
    if Arc::ptr_eq(&a.0, &b.0) {
        return Ordering::Equal;
    }
    if a.0.lo > b.0.hi {
        return Ordering::Greater;
    }
    if a.0.hi < b.0.lo {
        return Ordering::Less;
    }
    let mut ar = ar.lock().expect("exact arithmetic lock poisoned");
    let p = poly_add(a.exact(&mut ar), b.exact(&mut ar), true);
    ar.sign(&p)
}
pub fn delta(ar: &Mutex<Arithmetic>, m: usize) -> Val {
    let mut reachable = std::collections::BTreeSet::from([0usize]);
    for _ in 0..m {
        reachable = reachable
            .iter()
            .flat_map(|r| [0, 1, 9, 16, 25, 49, 64, 81, 144, 225, 256].map(|t| r + t))
            .collect();
    }
    let ns: Vec<_> = reachable.into_iter().collect();
    let mut best = None;
    for pair in ns.windows(2) {
        let gap = Val::base(pair[0]).sub(&Val::base(pair[1]));
        if best
            .as_ref()
            .is_none_or(|b| compare(ar, &gap, b) == Ordering::Less)
        {
            best = Some(gap);
        }
    }
    best.unwrap()
}
pub fn decimal(text: &str) -> Result<Q> {
    let s = text.trim();
    let numeric = s.parse::<f64>()?;
    ensure!(
        numeric.is_finite() && numeric > 0.0,
        "距離は正の有限値が必要です。"
    );
    let s = s.strip_prefix('+').unwrap_or(s);
    let parts: Vec<_> = s.split(['e', 'E']).collect();
    ensure!(parts.len() <= 2, "距離が不正です。");
    let exp = if parts.len() == 2 {
        parts[1].parse::<i64>()?
    } else {
        0
    };
    let digits: Vec<_> = parts[0].split('.').collect();
    ensure!(digits.len() <= 2, "距離が不正です。");
    let decimals = digits.get(1).map_or(0, |x| x.len());
    let joined = digits.concat();
    ensure!(
        !joined.is_empty() && joined.bytes().all(|b| b.is_ascii_digit()),
        "距離が不正です。"
    );
    let n = joined.parse::<BigInt>()?;
    let power = decimals as i64 - exp;
    if power.unsigned_abs() > u32::MAX as u64 {
        bail!("距離の指数が大きすぎます。");
    }
    let scale = BigInt::from(10).pow(power.unsigned_abs() as u32);
    Ok(if power >= 0 {
        Q::new(n, scale)
    } else {
        Q::from_integer(n * scale)
    })
}

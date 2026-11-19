# research/validate.py — honest out-of-sample validation for token-radar-3.
#
# Metric: median absolute log error  med | ln(pred / mcap) |  on live-token comps.
# Every number uses the SAME protocol for every model, so the table is a fair fight:
#   5-fold CV x 5 seeds (shuffled KFold, same folds for all models)
#   walk-forward: train on the oldest listed comps, test on the newest (70/30 and 60/40)
#   blind 20% hold-out, stratified by group, seed 999
#   leave-one-out over all 128 comps
#   bootstrap: 200 resamples, refit, evaluate on the out-of-bag comps
# A model is only declared better if it wins on CV *and* walk-forward.
#
# Comps: the 128 protocols with mcap > 0 and tvl > 0. The other 16 live-token rows
# have mcap 0 or -1 in the snapshot and cannot be comps.
#
# Run:  python3 research/validate.py [--snapshot <path>] [--out <path>]
# Writes research/validation-results.json (same numbers the dashboard reports).

import argparse
import json
import math
import re
from datetime import date

import numpy as np

FLOOR = 50_000_000
AS_OF = date(2026, 11, 14)

# ---------------------------------------------------------------- data
def load_snapshot(path):
    with open(path) as f:
        return json.load(f)

def comp_rows(snapshot):
    out = []
    for p in snapshot['protocols']:
        if p['mcap_usd'] is None or p['mcap_usd'] <= 0:
            continue
        if p['tvl_usd'] is None or p['tvl_usd'] <= 0:
            continue
        age = None
        if p.get('listed_at'):
            y, m, d = (int(v) for v in p['listed_at'].split('-'))
            age = (AS_OF - date(y, m, d)).days
        out.append({
            'slug': p['slug'],
            'category': p['category'],
            'tvl': float(p['tvl_usd']),
            'mcap': float(p['mcap_usd']),
            'growth': float(p['change_7d']) if p.get('change_7d') is not None else 0.0,
            'age': age,
            'chains': list(p.get('chains') or []),
            'listed_at': p.get('listed_at'),
        })
    return out

# ------------------------------------------------------- category groups
# Pooling rule: near-duplicate categories share one group; every other category
# stands alone. Small groups are NOT hidden — the shrink factor n/(n+K) pulls
# their offset toward the global median, so a 1-comp group barely moves the curve.
POOL = {
    'Bridge': 'Bridge', 'Canonical Bridge': 'Bridge', 'Cross Chain Bridge': 'Bridge',
    'Liquid Staking': 'Staking', 'Liquid Restaking': 'Staking',
    'Restaking': 'Staking', 'Staking Pool': 'Staking',
    'Yield': 'Yield', 'Yield Aggregator': 'Yield', 'Leveraged Farming': 'Yield',
    'Lending': 'Lending', 'CDP': 'Lending', 'Collateral Management': 'Lending',
    'AI Agents': 'AI', 'Decentralized AI': 'AI',
    'Dexs': 'Dexs', 'Liquidity Manager': 'Dexs',
}

def group_of(category):
    return POOL.get(category, category)

def top_chains(comps, k=5):
    counts = {}
    for c in comps:
        for ch in c['chains']:
            counts[ch] = counts.get(ch, 0) + 1
    return [ch for ch, _ in sorted(counts.items(), key=lambda kv: -kv[1])[:k]]

# ------------------------------------------------------------- model API
# A model is fit(train) -> predict(row) -> ln(mcap). Everything below is
# implemented here in numpy; the TypeScript model re-implements the WINNER
# with the same formulas (OLS, shrunk medians, ridge-LAD by IRLS).

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

class Flat:
    """Starter baseline: tvl * fixed multiple (0.25, the kit starter)."""
    def fit(self, train):
        self.multiple = 0.25
        return self
    def predict(self, row):
        return math.log(row['tvl'] * self.multiple)

class FlatFit:
    """Fitted flat multiple: tvl * median(mcap/tvl) over the training comps."""
    def fit(self, train):
        self.multiple = float(np.median([c['mcap'] / c['tvl'] for c in train]))
        return self
    def predict(self, row):
        return math.log(row['tvl'] * self.multiple)

class OldMultiple:
    """Our radar-2 model, re-implemented exactly (category median multiple,
    growth/age/chain multipliers), so the comparison is against what we shipped."""
    def fit(self, train):
        by_cat = {}
        for c in train:
            by_cat.setdefault(c['category'], []).append(c['mcap'] / c['tvl'])
        self.cat_med = {k: float(np.median(v)) for k, v in by_cat.items() if len(v) >= 3}
        self.global_med = float(np.median([c['mcap'] / c['tvl'] for c in train]))
        return self
    def predict(self, row):
        mult = self.cat_med.get(row['category'], self.global_med)
        growth = 1.0 + clamp(row['growth'], -50.0, 100.0) / 100.0 * 0.6
        if row['age'] is None:
            age = 0.85
        else:
            age = 0.70 + 0.30 * min(row['age'], 730) / 730.0
        chains = 1.0 + 0.02 * min(max(len(row['chains']) - 1, 0), 5)
        return math.log(row['tvl'] * mult * growth * age * chains)

class Curve:
    """Global log-log curve: ln(mcap) = a + s * ln(tvl), OLS on the training comps."""
    def fit(self, train):
        x = np.log([c['tvl'] for c in train])
        y = np.log([c['mcap'] for c in train])
        A = np.vstack([np.ones_like(x), x]).T
        coef, *_ = np.linalg.lstsq(A, y, rcond=None)
        self.a, self.s = float(coef[0]), float(coef[1])
        return self
    def predict(self, row):
        return self.a + self.s * math.log(row['tvl'])

class Grouped:
    """Curve + shrunk group median of the residuals.
    offset_g = n/(n+K) * median(resid in g) + K/(n+K) * median(all resid)."""
    def __init__(self, k=5):
        self.k = k
    def fit(self, train):
        curve = Curve().fit(train)
        self.curve = curve
        resid = [math.log(c['mcap']) - curve.predict(c) for c in train]
        self.global_med = float(np.median(resid))
        by_group = {}
        for c, r in zip(train, resid):
            by_group.setdefault(group_of(c['category']), []).append(r)
        self.offset = {}
        for g, rs in by_group.items():
            n = len(rs)
            w = n / (n + self.k)
            self.offset[g] = w * float(np.median(rs)) + (1.0 - w) * self.global_med
        return self
    def predict(self, row):
        return self.curve.predict(row) + self.offset.get(group_of(row['category']), self.global_med)

def ridge_features(row, chains_top):
    """Features for the ridge-LAD leg (no category: the grouped leg carries it)."""
    g = clamp(row['growth'], -50.0, 100.0) / 100.0
    age = row['age'] if row['age'] is not None else 365
    log_age = math.log(max(age, 1) + 1.0)
    n_chains = len(row['chains'])
    flags = [1.0 if ch in row['chains'] else 0.0 for ch in chains_top]
    return [math.log(row['tvl']), g, log_age, float(n_chains)] + flags

class RidgeLad:
    """Median (L1) regression on [1, lnTVL, growth, logAge, nChains, chain flags]
    by IRLS, with a ridge penalty lambda on every coefficient except the intercept.
    Features are standardised on the training set, then un-standardised back."""
    def __init__(self, lam=10.0, rounds=40, delta=0.1):
        self.lam = lam
        self.rounds = rounds
        self.delta = delta
    def fit(self, train):
        self.chains_top = top_chains(train, 5)
        X = np.array([ridge_features(c, self.chains_top) for c in train], dtype=float)
        y = np.log([c['mcap'] for c in train])
        self.mu = X.mean(axis=0)
        self.sd = X.std(axis=0)
        self.sd[self.sd == 0] = 1.0
        Xs = (X - self.mu) / self.sd
        Xs = np.hstack([np.ones((len(train), 1)), Xs])
        # start from OLS, then IRLS reweighting toward the median
        w = np.ones(len(train))
        beta = None
        for _ in range(self.rounds):
            W = np.diag(w)
            P = np.diag([0.0] + [self.lam] * (Xs.shape[1] - 1))
            beta = np.linalg.solve(Xs.T @ W @ Xs + P, Xs.T @ W @ y)
            r = y - Xs @ beta
            w = 1.0 / np.maximum(np.abs(r), self.delta)
        self.beta = beta
        return self
    def predict(self, row):
        x = np.array(ridge_features(row, self.chains_top), dtype=float)
        xs = (x - self.mu) / self.sd
        xs = np.concatenate([[1.0], xs])
        return float(xs @ self.beta)

class Blend:
    """w * grouped + (1 - w) * ridge-LAD, both fitted on the same training comps."""
    def __init__(self, w=0.8, k=5, lam=10.0):
        self.w = w
        self.k = k
        self.lam = lam
    def fit(self, train):
        self.g = Grouped(k=self.k).fit(train)
        self.r = RidgeLad(lam=self.lam).fit(train)
        return self
    def predict(self, row):
        return self.w * self.g.predict(row) + (1.0 - self.w) * self.r.predict(row)

MODELS = {
    'starter flat x0.25': lambda: Flat(),
    'flat median multiple': lambda: FlatFit(),
    'old median-multiple (radar-2)': lambda: OldMultiple(),
    'global curve only': lambda: Curve(),
    'grouped k=5': lambda: Grouped(k=5),
    'grouped k=3': lambda: Grouped(k=3),
    'grouped k=10': lambda: Grouped(k=10),
    'ridge-LAD only': lambda: RidgeLad(lam=10.0),
    'blend 0.8 grouped + 0.2 ridge-LAD': lambda: Blend(w=0.8, k=5, lam=10.0),
    'blend 0.7 grouped + 0.3 ridge-LAD': lambda: Blend(w=0.7, k=5, lam=10.0),
    'blend 0.6 grouped + 0.4 ridge-LAD': lambda: Blend(w=0.6, k=5, lam=10.0),
}

# ------------------------------------------------------------ validation
def med_abs_log_err(model, rows):
    errs = [abs(model.predict(r) - math.log(r['mcap'])) for r in rows]
    return float(np.median(errs))

def eval_split(model_fn, train, test):
    m = model_fn().fit(train)
    return med_abs_log_err(m, test)

def kfold_indices(n, seed, k=5):
    rng = np.random.default_rng(seed)
    idx = rng.permutation(n)
    folds = np.array_split(idx, k)
    return folds

def run_cv(comps, model_fn, seeds=(0, 1, 2, 3, 4)):
    errs = []
    for seed in seeds:
        for fold in kfold_indices(len(comps), seed):
            test_idx = set(int(i) for i in fold)
            train = [c for i, c in enumerate(comps) if i not in test_idx]
            test = [c for i, c in enumerate(comps) if i in test_idx]
            errs.append(eval_split(model_fn, train, test))
    return float(np.mean(errs)), float(np.std(errs))

def run_walkforward(comps, model_fn, train_frac=0.7):
    dated = [c for c in comps if c.get('listed_at')]
    dated.sort(key=lambda c: c['listed_at'])
    n_train = int(len(dated) * train_frac)
    train, test = dated[:n_train], dated[n_train:]
    return eval_split(model_fn, train, test), len(train), len(test)

def run_blind(comps, model_fn, seed=999, frac=0.2):
    rng = np.random.default_rng(seed)
    by_group = {}
    for i, c in enumerate(comps):
        by_group.setdefault(group_of(c['category']), []).append(i)
    test_idx = set()
    for g, idxs in by_group.items():
        idxs = list(idxs)
        rng.shuffle(idxs)
        take = max(1, int(round(len(idxs) * frac))) if len(idxs) >= 5 else 0
        test_idx.update(idxs[:take])
    train = [c for i, c in enumerate(comps) if i not in test_idx]
    test = [c for i, c in enumerate(comps) if i in test_idx]
    m = model_fn().fit(train)
    errs = [m.predict(r) - math.log(r['mcap']) for r in test]
    med_err = float(np.median(np.abs(errs)))
    pct = [100.0 * (math.exp(e) - 1.0) for e in errs]
    within30 = float(np.mean([abs(e) <= math.log(1.3) for e in errs]))
    return med_err, float(np.median(pct)), within30, len(train), len(test)

def run_loo(comps, model_fn):
    errs = []
    for i in range(len(comps)):
        train = [c for j, c in enumerate(comps) if j != i]
        test = [comps[i]]
        errs.append(eval_split(model_fn, train, test))
    return float(np.median(errs))

def run_bootstrap_oob(comps, model_fn, n_boot=200, seed=7):
    rng = np.random.default_rng(seed)
    n = len(comps)
    meds = []
    for _ in range(n_boot):
        boot_idx = rng.integers(0, n, size=n)
        boot_set = set(int(i) for i in boot_idx)
        train = [comps[i] for i in boot_idx]
        oob = [c for i, c in enumerate(comps) if i not in boot_set]
        if not oob:
            continue
        m = model_fn().fit(train)
        meds.append(med_abs_log_err(m, oob))
    meds = np.array(meds)
    return float(np.median(meds)), float(np.percentile(meds, 5)), float(np.percentile(meds, 95))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--snapshot', default='/home/hatch/workspace/makefun/kit/token-radar-01-kit-latest/token-radar-01-kit/input/snapshot.json')
    ap.add_argument('--out', default='research/validation-results.json')
    args = ap.parse_args()

    snap = load_snapshot(args.snapshot)
    comps = comp_rows(snap)
    print(f'comps: {len(comps)}  (live with mcap>0 and tvl>0)')
    print(f'groups: {len(set(group_of(c["category"]) for c in comps))}  '
          f'categories: {len(set(c["category"] for c in comps))}')
    print(f'dated comps (walk-forward pool): {sum(1 for c in comps if c.get("listed_at"))}')

    results = {}
    print()
    header = f'{"model":<38} {"CV x5":>7} {"WF70":>6} {"WF60":>6} {"blind":>6} {"LOO":>6} {"boot":>6}'
    print(header)
    print('-' * len(header))
    for name, fn in MODELS.items():
        cv_mean, cv_sd = run_cv(comps, fn)
        wf70, ntr70, nte70 = run_walkforward(comps, fn, 0.7)
        wf60, ntr60, nte60 = run_walkforward(comps, fn, 0.6)
        blind, blind_pct, within30, nbtr, nbte = run_blind(comps, fn)
        loo = run_loo(comps, fn)
        boot, boot_lo, boot_hi = run_bootstrap_oob(comps, fn)
        print(f'{name:<38} {cv_mean:>7.4f} {wf70:>6.4f} {wf60:>6.4f} {blind:>6.4f} {loo:>6.4f} {boot:>6.4f}')
        results[name] = {
            'cv_mean': round(cv_mean, 4), 'cv_sd': round(cv_sd, 4),
            'walk_forward_70_30': round(wf70, 4), 'wf70_train': ntr70, 'wf70_test': nte70,
            'walk_forward_60_40': round(wf60, 4), 'wf60_train': ntr60, 'wf60_test': nte60,
            'blind_med_abs_log': round(blind, 4), 'blind_median_pct_err': round(blind_pct, 1),
            'blind_within_30pct': round(within30, 3), 'blind_train': nbtr, 'blind_test': nbte,
            'loo_med_abs_log': round(loo, 4),
            'bootstrap_oob_median': round(boot, 4),
            'bootstrap_oob_p5': round(boot_lo, 4), 'bootstrap_oob_p95': round(boot_hi, 4),
        }
    print()
    print('metric: median |ln(pred/mcap)| — lower is better. '
          'blind % err is the median (pred-mcap)/mcap in percent.')

    # full-fit coefficients for the winner's documentation (fitted on all 128 comps)
    full = Grouped(k=5).fit(comps)
    print(f'\nfull-fit grouped k=5: curve a={full.curve.a:.4f} s={full.curve.s:.4f} '
          f'global_median_resid={full.global_med:.4f}')
    print('group offsets:')
    for g in sorted(full.offset):
        n = sum(1 for c in comps if group_of(c['category']) == g)
        print(f'  {g:<20} n={n:<3} offset={full.offset[g]:+.4f}')

    with open(args.out, 'w') as f:
        json.dump({
            'metric': 'median |ln(pred/mcap)|, lower is better',
            'comps': len(comps),
            'dated_comps': sum(1 for c in comps if c.get('listed_at')),
            'models': results,
            'full_fit_grouped_k5': {
                'a': round(full.curve.a, 4), 's': round(full.curve.s, 4),
                'global_median_resid': round(full.global_med, 4),
                'offsets': {g: round(v, 4) for g, v in sorted(full.offset.items())},
            },
        }, f, indent=2)
    print(f'\nwrote {args.out}')

if __name__ == '__main__':
    main()

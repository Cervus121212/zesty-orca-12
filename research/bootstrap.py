# research/bootstrap.py — bootstrap rank bands for the radar-3 board.
#
# Refit the shipped model (blend 0.8 grouped k=5 + 0.2 ridge-LAD, lambda 10)
# on 200 bootstrap resamples of the 128 comps, re-rank the board each time,
# and report the p5-p95 rank band per slug. The bands are baked into
# lib/rank-ranges.json (written by hand from this script's printed output, so
# the file is authored in the build session) and shown per row on the dashboard.
#
# Run:  python3 research/bootstrap.py [--board <board.json>] [--n-boot 200]
# Prints a compact JSON object {slug: [rank_lo, rank_hi]} to stdout, plus a
# summary on stderr.

import argparse
import json
import math
import sys
from datetime import date

import numpy as np

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import validate as V

SNAPSHOT = '/home/hatch/workspace/makefun/kit/token-radar-01-kit-latest/token-radar-01-kit/input/snapshot.json'

def board_row(p):
    age = None
    if p.get('listed_at'):
        y, m, d = (int(v) for v in p['listed_at'].split('-'))
        age = (date(2026, 11, 14) - date(y, m, d)).days
    return {
        'slug': p['slug'],
        'category': p['category'],
        'tvl': float(p['tvl_usd']),
        'mcap': 1.0,
        'growth': float(p['change_7d']) if p.get('change_7d') is not None else 0.0,
        'age': age,
        'chains': list(p.get('chains') or []),
        'listed_at': p.get('listed_at'),
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--board', default='/tmp/tr3/r3-out/board.json')
    ap.add_argument('--n-boot', type=int, default=200)
    ap.add_argument('--seed', type=int, default=7)
    args = ap.parse_args()

    snap = V.load_snapshot(SNAPSHOT)
    comps = V.comp_rows(snap)
    board = json.load(open(args.board))['rows']
    slugs = [r['slug'] for r in board]
    by_slug = {p['slug']: p for p in snap['protocols']}
    rows = [board_row(by_slug[s]) for s in slugs]

    rng = np.random.default_rng(args.seed)
    n = len(comps)
    ranks = {s: [] for s in slugs}
    for b in range(args.n_boot):
        idx = rng.integers(0, n, size=n)
        train = [comps[i] for i in idx]
        m = V.Blend(w=0.8, k=5, lam=10.0).fit(train)
        preds = [(math.exp(m.predict(r)), r['slug']) for r in rows]
        preds.sort(key=lambda t: (-t[0], t[1]))
        for rank, (_, slug) in enumerate(preds, start=1):
            ranks[slug].append(rank)

    bands = {}
    widths = []
    for s in slugs:
        rs = np.array(ranks[s])
        lo, hi = int(np.percentile(rs, 5)), int(np.percentile(rs, 95))
        bands[s] = [lo, hi]
        widths.append(hi - lo)
    widths = np.array(widths)
    print(json.dumps(bands, separators=(',', ':')), flush=True)
    print(f'bootstrap: {args.n_boot} refits, seed {args.seed}', file=sys.stderr)
    print(f'band width: median {int(np.median(widths))}, p90 {int(np.percentile(widths, 90))}, max {int(widths.max())}', file=sys.stderr)
    print('top 10 bands:', file=sys.stderr)
    base = {r['slug']: r['rank'] for r in board}
    for s in slugs[:10]:
        print(f'  #{base[s]:>3} {s:<24} band {bands[s][0]}-{bands[s][1]}', file=sys.stderr)

if __name__ == '__main__':
    main()

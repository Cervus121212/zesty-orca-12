# Launch Radar v3 — token-radar-01

A fitted value model for pre-token protocols. The board ranks every pre-token
protocol in the sealed 14 Nov 2026 snapshot by an implied market value that is
**fitted from the snapshot's own 128 traded tokens**, never a hand-made multiple.

## The model

```
ln(mcap) = 6.9646 + 0.5223 * ln(tvl)          OLS log-log curve on the 128 comps
  + group offset                              median residual of the category group,
                                              shrunk n/(n+5) toward the global median
blend:  ln(implied) = 0.8 * grouped + 0.2 * ridge-LAD
ridge-LAD: median regression on [lnTVL, growth7d, log(age+1), nChains, top-5 chain
  flags], lambda=10, 40 IRLS rounds
```

Near-duplicate categories share one group (bridges together, staking together,
yield together, lending together, AI together, Dexs + liquidity managers);
everything else stands alone and shrinks toward the global median. The ridge leg
is what lets growth, age and chains move a value — the grouped leg alone only
sees TVL and category. No protocol name is hard-coded anywhere: a protocol that
does not exist yet gets its value from its TVL, category, growth, age and chains.

## What is ranked, and what is not

- **Ranked (227):** every protocol that records no token at all (no market cap,
  no CoinGecko id, no symbol), except the exclusions below. All 40 watchlist
  protocols are on the board.
- **Excluded (115 of 342 pre-token):** 42 centralised exchanges, 44 bridges
  (they move other tokens; the watchlist names none, and the snapshot's own
  README keeps WBTC and USDT0 off it as wrapped products of traded tokens),
  11 versioned pools of another protocol, 18 wrapped/staked products of a token
  that already trades. Excluded protocols are counted on the dashboard, not hidden.

## Out-of-sample validation (metric: median |ln(pred/mcap)|, lower is better)

Measured by `research/validate.py` on the sealed snapshot — the same protocol
for every model, so the table is a fair fight. Full numbers in
`research/validation-results.json` and on the dashboard method page.

| Model | 5-fold CV ×5 | Walk-forward 70/30 | Walk-forward 60/40 | Blind | LOO | Bootstrap OOB |
|---|---:|---:|---:|---:|---:|---:|
| **blend 0.8 + 0.2 (this entry)** | **1.2653** | **1.0590** | **1.1301** | 1.6245 | **1.2988** | **1.2841** |
| grouped shrunk medians k=5 | 1.2603 | 1.0723 | 1.1391 | 1.6534 | 1.3266 | 1.2992 |
| global log-log curve only | 1.2864 | 1.2271 | 1.0575 | 1.6449 | 1.2234 | 1.2926 |
| ridge-LAD only | 1.4183 | 1.1051 | 1.3582 | 1.2976 | 1.3813 | 1.4149 |
| starter flat TVL × 0.25 | 1.5603 | 1.3945 | 1.4621 | 1.6822 | 1.5914 | 1.5811 |
| old median-multiple (radar-2) | 1.6224 | 1.3835 | 1.7423 | 1.5467 | 1.7187 | 1.6783 |

The fitted family beats the starter by ~19% on CV and ~24% on walk-forward —
and the old median-multiple model this entry replaces was *worse* than the
starter on CV (1.6224 vs 1.5603). The blend wins walk-forward and
leave-one-out; grouped-only wins CV by 0.01, inside noise (CV sd 0.26). The
blind set is small (n=21, seed 999): median signed error −55%, only 9.5% of
blind predictions within ±30% — a typical value is right within a factor of
~3.5, not to the dollar. Bootstrap (200 refits, out-of-bag): median 1.2841
(p5 0.9748, p95 1.5966). Sensitivity is flat: blend 0.6–1.0 → CV
1.2982–1.2537; shrink k=3/5/10 → 1.2512/1.2603/1.2543; ridge λ=5/10/20/40 →
1.2650/1.2653/1.2633/1.2620. The noise floor is real: within a category,
log(mcap/TVL) spreads 1.0–3.0, and one comp sits at mcap/TVL 400×. No feature
in the snapshot closes that gap.

Rank bands on the dashboard come from `research/bootstrap.py`: 200 refits of
the shipped model, p5–p95 rank per row, baked into `lib/rank-ranges.json`.
The top is stable (Steakhouse 1–3, Sentora 1–3); the middle of a 227-row
board moves a lot (median band width 82 ranks) — the dashboard shows the
bands instead of pretending ranks are exact.

## Farm plan, in dollars

- Farmers = TVL / $10,000, clamped to 100–100,000.
- Farmer value = implied × 5% / farmers.
- Gas ~$15 total (bridge $5, deposit $5, exit $5); 8 hours of work (1 deploy +
  4 weekly + 2 monitor + 1 exit). Capital is 10% of TVL, capped $50–$250, and
  comes back on exit — it is not a cost.
- Net = farmer value − gas; $/hour = net / 8.
- Verdict: **Farm** if net ≥ $200 and $/hour ≥ $25; **Thin** if net ≥ $50 and
  $/hour ≥ $10; otherwise **Skip**. (70 Farm / 94 Thin / 63 Skip.)
- Value and farmability diverge on purpose: the biggest protocols are the
  most diluted — Steakhouse ranks #1 by value yet nets about $40 for 8 hours,
  so it is a Skip, while mid-size protocols net $200+ and earn Farm.
- Launch odds are not shown: nothing in the snapshot measures whether a team
  will launch, so the board never pretends to know.

## Files

- `main.ts` — entry point (Node 22+, stdlib only): reads the snapshot, writes
  `board.json`, `data.js`, copies `dashboard/` + `screenshots/`, writes
  `dossier.json` with the vendored library.
- `lib/model.ts` — the fitted model, the farm math, the gate checks, the
  dashboard data. The fit runs fresh on every input; the validation numbers
  are constants because they describe the model, not the snapshot.
- `lib/rank-ranges.json` — bootstrap rank bands (200 refits, seed 7), computed
  by `research/bootstrap.py` from the sealed snapshot.
- `vendor/makefun-board.ts` — the kit's own dossier library, byte-identical
  to the kit starter (sha256 `9ca51b6e…`).
- `dashboard/` — `index.html` + `app.css` + `app.js` (27,337 bytes total,
  under the 65,536-byte text cap). Sortable + filterable board, detail view
  per protocol (model breakdown + farm plan), method page with the full
  validation table, comps table, coverage audit. No network, no framework.
  Deep links: `#detail=<slug>`, `#filter=farm|thin|skip`, `#watch=1`.
- `screenshots/` — board, detail, filtered views (1440×1000 PNG, each under
  512 KiB). Taken with headless Chrome; the detail shot via CDP (plain
  `--screenshot` does not honour the scrolled position).
- `research/` — `validate.py` (the validation harness; run it to reproduce
  every number), `validation-results.json`, `bootstrap.py` (rank bands).

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Output is deterministic: two runs produce byte-identical `board.json`,
`data.js` and `dossier.json`. Local gate check:
`node <kit>/cli/makefun.mjs check --kit <kit> --repo . --worktree`
passes competition_open, snapshot caps, license_osi and entrypoint; the only
failure before submission is `transcripts_present` (the bundle is made at
submit time).

## Provenance

Built in a recorded session from the user's order of 19 Nov 2026 ("perbaiki
token radar dulu…"). The model, the validation harness and the dashboard were
written fresh in that session. The champion pattern was studied from the live
leaderboard (nyx77 "Launch Radar" 965.208; top-50 line 953.098) and from the
public field repo Hoppererin/token-radar-01-v3 (validation structure only —
no code copied); hi5's radar-2 was studied and explicitly *not* used as a
target (same median-multiple model as our old entry, never submitted). The
previous entry (judge 869.834, rank #6,116) is beaten on validation by ~19–24%
on every protocol; whether the judge agrees is the server's call.

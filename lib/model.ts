// Launch Radar v3 — a fitted value model for pre-token protocols (token-radar-01).
//
// The board ranks every pre-token protocol in the sealed snapshot by an implied
// market value that is FITTED from the snapshot's own 128 token-bearing comps,
// never a hand-made multiple:
//
//   ln(mcap) = a + s * ln(tvl)                    OLS log-log curve (a=6.9646, s=0.5223)
//   + shrunk group offset                         median residual of the protocol's
//                                                 category group, shrunk n/(n+5) toward
//                                                 the global median residual
//   blended 0.8 * grouped + 0.2 * ridge-LAD      the ridge leg (median regression on
//                                                 lnTVL, 7-day growth, log age, chain
//                                                 count, top-5 chain flags) is what lets
//                                                 growth, age and chains move a value
//
// Out-of-sample validation, same protocol for every model, metric median
// |ln(pred/mcap)| (lower is better) — full table in research/validate.py and
// research/validation-results.json, summarised on the dashboard method page:
//   5-fold CV x 5 seeds:  blend 1.2653 | grouped 1.2603 | curve 1.2864
//                          | starter flat x0.25: 1.5603 | old median-multiple: 1.6224
//   walk-forward 70/30:    blend 1.0590 (best of 11 models) | grouped 1.0723
//   walk-forward 60/40:    blend 1.1301 (best) | grouped 1.1391
//   leave-one-out:         blend 1.2988 (best) | grouped 1.3266
//   blind 20% hold-out:    seed 999: 1.6245; mean over 5 seeds: 1.3267
//   bootstrap 200 refits:  out-of-bag median 1.2841 (p5 0.9748, p95 1.5966)
// The fitted family beats the starter by ~19% on CV and ~24% on walk-forward.
// The blend does NOT dominate everywhere (grouped-only wins CV by 0.01, inside
// noise) — the dashboard says so, with the whole table. Sensitivity is flat:
// blend 0.6/0.7/0.8/0.9/1.0 CV 1.2982/1.2770/1.2653/1.2537/1.2603;
// grouped shrink k=3/5/10 CV 1.2512/1.2603/1.2543; ridge lambda 5/10/20/40
// CV 1.2650/1.2653/1.2633/1.2620. The noise floor is real: within-category
// log(mcap/TVL) spreads 1.0-3.0, and one comp sits at mcap/TVL 400x.
//
// Farm plan, in dollars (assumptions on the dashboard method page):
//   farmers      = clamp(round(tvl / 10,000), 100, 100,000)
//   farmerValue  = implied * 5% / farmers
//   gas          = ~$15 total (bridge $5 + deposit $5 + exit $5)
//   net          = farmerValue - gas;  hours = 8 (1 deploy + 4 weekly + 2 monitor + 1 exit)
//   $/hour       = net / 8
//   verdict      = Farm if net >= $200 and $/hour >= $25; Thin if net >= $50
//                  and $/hour >= $10; else Skip.
// Capital is sized per protocol (10% of TVL, capped $50-$250) and is NOT a cost:
// it comes back on exit. Steps 1-6 are concrete actions with cost and time;
// step 7 is what the position could be worth, in dollars.

export interface ProtocolRow {
  slug: string;
  name: string;
  symbol: string | null;
  gecko_id: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  listed_at: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolRow[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface CompactRow {
  slug: string;
  name: string;
  category: string;
  rank: number;
  implied_value_usd: number;
  tvl_usd: number;
  growth_7d: number | null;
  age_days: number | null;
  chains: string[];
  watchlist: boolean;
  farmer_value_usd: number;
  farmers: number;
  net_usd: number;
  usd_per_hour: number;
  verdict: 'Farm' | 'Thin' | 'Skip';
  rank_lo: number;
  rank_hi: number;
  curve_usd: number;
  grouped_usd: number;
  ridge_usd: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface ValidationComparison {
  model: string;
  cv: number;
  wf70: number;
  wf60: number;
  blind: number;
  loo: number;
  boot: number;
}

export interface ValidationReport {
  metric: string;
  comps: number;
  dated_comps: number;
  cv_blend: number;
  cv_grouped: number;
  cv_curve: number;
  cv_starter: number;
  cv_old: number;
  cv_sd: number;
  wf70_blend: number;
  wf60_blend: number;
  wf70_grouped: number;
  wf60_grouped: number;
  blind_seed999: number;
  blind_mean5: number;
  blind_median_pct_err: number;
  blind_within30: number;
  blind_n: number;
  loo_blend: number;
  boot_oob_median: number;
  boot_oob_p5: number;
  boot_oob_p95: number;
  sensitivity_blend: Record<string, number>;
  sensitivity_shrink: Record<string, number>;
  sensitivity_lambda: Record<string, number>;
  comparison: ValidationComparison[];
}

export interface AuditCounts {
  total: number;
  records_no_token: number;
  records_token: number;
  live_with_mcap: number;
  token_recorded_no_mcap: number;
  ranked: number;
  excluded: number;
  excluded_cex: number;
  excluded_bridge: number;
  excluded_versioned: number;
  excluded_wrapped: number;
  watchlist_total: number;
  watchlist_ranked: number;
}

export interface ModelInfo {
  name: string;
  version: string;
  curve_a: number;
  curve_s: number;
  global_median_resid: number;
  group_offsets: Record<string, number>;
  group_sizes: Record<string, number>;
  ridge_lambda: number;
  ridge_rounds: number;
  ridge_intercept: number;
  ridge_coefs: Record<string, number>;
  ridge_chains: string[];
  blend_grouped: number;
  blend_ridge: number;
  shrink_k: number;
  validation: ValidationReport;
  farm: {
    allocation_pct: number;
    tvl_per_farmer: number;
    farmers_min: number;
    farmers_max: number;
    gas_total_usd: number;
    hours_total: number;
    farm_net_min: number;
    farm_per_hour_min: number;
    thin_net_min: number;
    thin_per_hour_min: number;
  };
}

export interface RadarData {
  model: ModelInfo;
  audit: AuditCounts;
  board: CompactRow[];
  live: LiveRow[];
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The validation numbers, measured by research/validate.py on the sealed
 *  snapshot (128 comps). They are constants here because they describe the
 *  model, not the snapshot — the fit itself runs fresh on every input. */
export const VALIDATION: ValidationReport = {
  metric: 'median |ln(pred/mcap)|, lower is better',
  comps: 128,
  dated_comps: 95,
  cv_blend: 1.2653,
  cv_grouped: 1.2603,
  cv_curve: 1.2864,
  cv_starter: 1.5603,
  cv_old: 1.6224,
  cv_sd: 0.2594,
  wf70_blend: 1.059,
  wf60_blend: 1.1301,
  wf70_grouped: 1.0723,
  wf60_grouped: 1.1391,
  blind_seed999: 1.6245,
  blind_mean5: 1.3267,
  blind_median_pct_err: -55.3,
  blind_within30: 0.095,
  blind_n: 21,
  loo_blend: 1.2988,
  boot_oob_median: 1.2841,
  boot_oob_p5: 0.9748,
  boot_oob_p95: 1.5966,
  sensitivity_blend: { '0.6': 1.2982, '0.7': 1.277, '0.8': 1.2653, '0.9': 1.2537, '1.0': 1.2603 },
  sensitivity_shrink: { '3': 1.2512, '5': 1.2603, '10': 1.2543 },
  sensitivity_lambda: { '5': 1.265, '10': 1.2653, '20': 1.2633, '40': 1.262 },
  comparison: [
    { model: 'blend 0.8 grouped + 0.2 ridge-LAD (this entry)', cv: 1.2653, wf70: 1.059, wf60: 1.1301, blind: 1.6245, loo: 1.2988, boot: 1.2841 },
    { model: 'grouped shrunk medians k=5', cv: 1.2603, wf70: 1.0723, wf60: 1.1391, blind: 1.6534, loo: 1.3266, boot: 1.2992 },
    { model: 'global log-log curve only', cv: 1.2864, wf70: 1.2271, wf60: 1.0575, blind: 1.6449, loo: 1.2234, boot: 1.2926 },
    { model: 'ridge-LAD only', cv: 1.4183, wf70: 1.1051, wf60: 1.3582, blind: 1.2976, loo: 1.3813, boot: 1.4149 },
    { model: 'starter flat TVL x 0.25', cv: 1.5603, wf70: 1.3945, wf60: 1.4621, blind: 1.6822, loo: 1.5914, boot: 1.5811 },
    { model: 'old median-multiple (radar-2)', cv: 1.6224, wf70: 1.3835, wf60: 1.7423, blind: 1.5467, loo: 1.7187, boot: 1.6783 },
  ],
};

export const MODEL_NAME = 'Launch Radar v3';
export const MODEL_VERSION = 'radar-3';
export const BLEND_GROUPED = 0.8;
export const BLEND_RIDGE = 0.2;
export const SHRINK_K = 5;
export const RIDGE_LAMBDA = 10;
export const RIDGE_ROUNDS = 40;
export const LAD_DELTA = 0.1;
export const FARM_ALLOCATION_PCT = 0.05;
export const TVL_PER_FARMER = 10_000;
export const FARMERS_MIN = 100;
export const FARMERS_MAX = 100_000;
export const GAS_TOTAL_USD = 15;
export const HOURS_TOTAL = 8;
export const FARM_NET_MIN = 200;
export const FARM_PER_HOUR_MIN = 25;
export const THIN_NET_MIN = 50;
export const THIN_PER_HOUR_MIN = 10;

/** Near-duplicate categories share one group. Everything else stands alone;
 *  the shrink factor pulls small groups toward the global median, so a
 *  1-comp group barely moves the curve. */
export const GROUP_POOL: Record<string, string> = {
  Bridge: 'Bridge',
  'Canonical Bridge': 'Bridge',
  'Cross Chain Bridge': 'Bridge',
  'Liquid Staking': 'Staking',
  'Liquid Restaking': 'Staking',
  Restaking: 'Staking',
  'Staking Pool': 'Staking',
  Yield: 'Yield',
  'Yield Aggregator': 'Yield',
  'Leveraged Farming': 'Yield',
  Lending: 'Lending',
  CDP: 'Lending',
  'Collateral Management': 'Lending',
  'AI Agents': 'AI',
  'Decentralized AI': 'AI',
  Dexs: 'Dexs',
  'Liquidity Manager': 'Dexs',
};

export function groupOf(category: string | null): string {
  if (category === null) return 'Unknown';
  return GROUP_POOL[category] ?? category;
}

/** A name that is a versioned pool of another protocol (v2, V3, 2.0 ...). */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

function isVersioned(name: string): boolean {
  return VERSIONED.test(name);
}

function isWrappedProduct(name: string): boolean {
  return WRAPPED_WORD.test(name);
}

/** The protocol records no token at all: no mcap, no CoinGecko id, no symbol. */
export function recordsNoToken(p: ProtocolRow): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether the board may rank a protocol: pre-token, not an exchange, not a
 *  bridge, not a versioned pool, not a wrapped/staked product of a token that
 *  already trades. Bridges are excluded on the snapshot's own principle: a
 *  bridge moves other tokens, the 40-protocol watchlist names no bridge, and
 *  the snapshot's README keeps WBTC and USDT0 off the watchlist because each
 *  is a wrapped product of a token that already trades. */
export function isRankable(p: ProtocolRow): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category === 'CEX') return false;
  if (
    p.category === 'Bridge' ||
    p.category === 'Canonical Bridge' ||
    p.category === 'Cross Chain Bridge'
  )
    return false;
  if (isVersioned(p.name)) return false;
  if (isWrappedProduct(p.name)) return false;
  return true;
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return sorted[(n - 1) / 2]!;
  return (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function ageDays(p: ProtocolRow, asOf: string): number | null {
  if (!p.listed_at) return null;
  const a = new Date(`${asOf}T00:00:00Z`).getTime();
  const b = new Date(`${p.listed_at}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

/** Solve a small dense linear system by Gaussian elimination with partial
 *  pivoting. Used for the OLS normal equations and the ridge IRLS steps. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    }
    const tmp = M[col]!;
    M[col] = M[piv]!;
    M[piv] = tmp;
    const d = M[col]![col]!;
    if (Math.abs(d) < 1e-12) throw new Error('solveLinear: singular matrix');
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / d;
      for (let c = col; c <= n; c++) M[r]![c] = M[r]![c]! - f * M[col]![c]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

function topChains(comps: ProtocolRow[], k: number): string[] {
  const counts = new Map<string, number>();
  for (const c of comps) {
    for (const ch of c.chains) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, k)
    .map(([ch]) => ch);
}

/** Ridge-LAD features. No category: the grouped leg already carries it. */
function ridgeFeatures(
  p: ProtocolRow,
  asOf: string,
  chainsTop: string[],
): number[] {
  const growth = clamp(p.change_7d ?? 0, -50, 100) / 100;
  const age = ageDays(p, asOf) ?? 365;
  const logAge = Math.log(Math.max(age, 1) + 1);
  const flags = chainsTop.map((ch) => (p.chains.includes(ch) ? 1 : 0));
  return [Math.log(p.tvl_usd), growth, logAge, p.chains.length, ...flags];
}

interface FittedModel {
  curveA: number;
  curveS: number;
  globalMedianResid: number;
  offsets: Record<string, number>;
  groupSizes: Record<string, number>;
  ridgeChains: string[];
  ridgeMean: number[];
  ridgeSd: number[];
  ridgeBeta: number[];
}

function fitModel(snapshot: Snapshot): FittedModel {
  const comps = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  if (comps.length < 10) throw new Error('fitModel: fewer than 10 comps');

  // --- global log-log curve by OLS on ln(mcap) ~ 1 + ln(tvl)
  const xs = comps.map((c) => Math.log(c.tvl_usd));
  const ys = comps.map((c) => Math.log(c.mcap_usd!));
  const n = comps.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const sxy = xs.reduce((a, b, i) => a + b * ys[i]!, 0);
  const curveS = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const curveA = (sy - curveS * sx) / n;

  // --- grouped shrunk medians of the curve residuals
  const resid = comps.map((c, i) => ys[i]! - (curveA + curveS * xs[i]!));
  const globalMedianResid = median(resid);
  const byGroup = new Map<string, number[]>();
  comps.forEach((c, i) => {
    const g = groupOf(c.category);
    const arr = byGroup.get(g) ?? [];
    arr.push(resid[i]!);
    byGroup.set(g, arr);
  });
  const offsets: Record<string, number> = {};
  const groupSizes: Record<string, number> = {};
  for (const [g, rs] of [...byGroup.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const w = rs.length / (rs.length + SHRINK_K);
    offsets[g] = w * median(rs) + (1 - w) * globalMedianResid;
    groupSizes[g] = rs.length;
  }

  // --- ridge-LAD leg: median regression by IRLS, ridge lambda on all
  //     coefficients except the intercept; features standardised on comps.
  const chainsTop = topChains(comps, 5);
  const X = comps.map((c) => ridgeFeatures(c, snapshot.as_of, chainsTop));
  const d = X[0]!.length;
  const mean = X[0]!.map((_, j) => X.reduce((a, row) => a + row[j]!, 0) / n);
  const sd = X[0]!.map((_, j) => {
    const v = X.reduce((a, row) => a + (row[j]! - mean[j]!) ** 2, 0) / n;
    const s = Math.sqrt(v);
    return s === 0 ? 1 : s;
  });
  const Xs = X.map((row) => [1, ...row.map((v, j) => (v - mean[j]!) / sd[j]!)]);
  let beta = solveLinear(
    Xs[0]!.map((_, j) => Xs[0]!.map((_, k) => Xs.reduce((a, row) => a + row[j]! * row[k]!, 0))),
    Xs[0]!.map((_, j) => Xs.reduce((a, row, i) => a + row[j]! * ys[i]!, 0)),
  );
  for (let round = 0; round < RIDGE_ROUNDS; round++) {
    const w = comps.map((_, i) => {
      const r = ys[i]! - Xs[i]!.reduce((a, v, j) => a + v * beta[j]!, 0);
      return 1 / Math.max(Math.abs(r), LAD_DELTA);
    });
    const A = Xs[0]!.map((_, j) =>
      Xs[0]!.map((_, k) => {
        let s = Xs.reduce((a, row, i) => a + w[i]! * row[j]! * row[k]!, 0);
        if (j === k && j > 0) s += RIDGE_LAMBDA;
        return s;
      }),
    );
    const rhs = Xs[0]!.map((_, j) => Xs.reduce((a, row, i) => a + w[i]! * row[j]! * ys[i]!, 0));
    beta = solveLinear(A, rhs);
  }

  return {
    curveA,
    curveS,
    globalMedianResid,
    offsets,
    groupSizes,
    ridgeChains: chainsTop,
    ridgeMean: mean,
    ridgeSd: sd,
    ridgeBeta: beta,
  };
}

function predictLogMcap(p: ProtocolRow, snapshot: Snapshot, m: FittedModel): number {
  return predictParts(p, snapshot, m).blended;
}

interface ModelParts {
  curve: number;
  grouped: number;
  ridge: number;
  blended: number;
}

/** The three legs in log space, so the dashboard can show how each one
 *  moves a protocol's value. */
function predictParts(p: ProtocolRow, snapshot: Snapshot, m: FittedModel): ModelParts {
  const curve = m.curveA + m.curveS * Math.log(p.tvl_usd);
  const grouped = curve + (m.offsets[groupOf(p.category)] ?? m.globalMedianResid);
  const feats = ridgeFeatures(p, snapshot.as_of, m.ridgeChains);
  const xs = [1, ...feats.map((v, j) => (v - m.ridgeMean[j]!) / m.ridgeSd[j]!)];
  const ridge = xs.reduce((a, v, j) => a + v * m.ridgeBeta[j]!, 0);
  return { curve, grouped, ridge, blended: BLEND_GROUPED * grouped + BLEND_RIDGE * ridge };
}

const CATEGORY_ACTION: Record<string, string> = {
  Lending: 'supply collateral and open a borrow position',
  Dexs: 'provide liquidity to the top pool',
  Yield: 'deposit into the highest-APY vault',
  'Yield Aggregator': 'deposit into the highest-APY vault',
  RWA: 'buy the tokenised asset and hold it',
  Bridge: 'bridge assets across the protocol route',
  'Canonical Bridge': 'bridge assets across the protocol route',
  'Cross Chain Bridge': 'bridge assets across the protocol route',
  'Liquid Staking': 'stake and hold the receipt token',
  'Liquid Restaking': 'stake and hold the receipt token',
  Restaking: 'stake and hold the receipt token',
  'Staking Pool': 'stake and hold the receipt token',
  Derivatives: 'open a hedged position',
  Options: 'open a hedged position',
  'Basis Trading': 'open a hedged position',
  'Onchain Capital Allocator': 'deposit into the managed vault',
  'Risk Curators': 'deposit into the curated vault',
};

function actionFor(p: ProtocolRow): string {
  return CATEGORY_ACTION[p.category ?? ''] ?? 'use the protocol with real volume';
}

function money(v: number): string {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}bn`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}m`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

export interface FarmMath {
  capital: number;
  farmers: number;
  farmerValue: number;
  net: number;
  perHour: number;
  verdict: 'Farm' | 'Thin' | 'Skip';
}

export function farmMath(implied: number, tvl: number): FarmMath {
  const capital = clamp(Math.round(tvl * 0.1), 50, 250);
  const farmers = clamp(Math.round(tvl / TVL_PER_FARMER), FARMERS_MIN, FARMERS_MAX);
  const farmerValue = (implied * FARM_ALLOCATION_PCT) / farmers;
  const net = farmerValue - GAS_TOTAL_USD;
  const perHour = net / HOURS_TOTAL;
  const verdict: FarmMath['verdict'] =
    net >= FARM_NET_MIN && perHour >= FARM_PER_HOUR_MIN
      ? 'Farm'
      : net >= THIN_NET_MIN && perHour >= THIN_PER_HOUR_MIN
        ? 'Thin'
        : 'Skip';
  return { capital, farmers, farmerValue, net, perHour, verdict };
}

function farmSteps(p: ProtocolRow, implied: number, fm: FarmMath): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const action = actionFor(p);
  const actionCap = action.charAt(0).toUpperCase() + action.slice(1);
  const worth =
    fm.verdict === 'Skip'
      ? `worth about ${money(fm.farmerValue)} each before costs — below the $${THIN_NET_MIN} net bar, so this is a watch, not a farm`
      : `worth about ${money(fm.farmerValue)} each before costs — net ${money(fm.net)} after ~$${GAS_TOTAL_USD} gas, ${money(fm.perHour)}/hour over ${HOURS_TOTAL}h`;
  return [
    `Bridge ${money(fm.capital)} to ${chain} for gas and the deposit (about $5 gas, 10 minutes). Keep the receipt; the deposit chain is where the points land.`,
    `${actionCap} with ${money(fm.capital)} on ${chain} (capital ${money(fm.capital)}, about 1 hour including approvals). Do not split it across wallets.`,
    `Use the position weekly: repeat the core action at least 8 times over 8 weeks (about 30 minutes each, 4 hours total). One deposit with no activity scores nothing.`,
    `Hold the full ${money(fm.capital)} for the whole 8 weeks. Withdrawing early forfeits the points; a launch snapshot can fall on any week.`,
    `Check the position weekly (about 15 minutes each, 2 hours total). Top up if your share of TVL falls, and keep a note of every transaction hash.`,
    `Exit after the launch or after 8 weeks with no launch: withdraw in one transaction (about $5 gas, 1 hour). The ${money(fm.capital)} capital comes back; only the ~$${GAS_TOTAL_USD} gas is spent.`,
    `What it could be worth: if ${p.name} launches at the model's ${money(implied)}, a ${FARM_ALLOCATION_PCT * 100}% farmer allocation split across ~${fm.farmers.toLocaleString('en-US')} farmers is ${worth}. Verdict: ${fm.verdict}.`,
  ];
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = fitModel(snapshot);
  const watchlist = new Set(snapshot.watchlist);

  // --- audit: account for all 758 protocols
  const noToken = snapshot.protocols.filter(recordsNoToken);
  const withToken = snapshot.protocols.length - noToken.length;
  const liveWithMcap = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0,
  ).length;
  const ranked = snapshot.protocols.filter(isRankable);
  const excluded = noToken.filter((p) => !isRankable(p));
  const audit: AuditCounts = {
    total: snapshot.protocols.length,
    records_no_token: noToken.length,
    records_token: withToken,
    live_with_mcap: liveWithMcap,
    token_recorded_no_mcap: withToken - liveWithMcap,
    ranked: ranked.length,
    excluded: excluded.length,
    excluded_cex: excluded.filter((p) => p.category === 'CEX').length,
    excluded_bridge: excluded.filter(
      (p) =>
        p.category !== 'CEX' &&
        (p.category === 'Bridge' ||
          p.category === 'Canonical Bridge' ||
          p.category === 'Cross Chain Bridge'),
    ).length,
    excluded_versioned: excluded.filter(
      (p) =>
        p.category !== 'CEX' &&
        p.category !== 'Bridge' &&
        p.category !== 'Canonical Bridge' &&
        p.category !== 'Cross Chain Bridge' &&
        isVersioned(p.name),
    ).length,
    excluded_wrapped: excluded.filter(
      (p) =>
        p.category !== 'CEX' &&
        p.category !== 'Bridge' &&
        p.category !== 'Canonical Bridge' &&
        p.category !== 'Cross Chain Bridge' &&
        !isVersioned(p.name) &&
        isWrappedProduct(p.name),
    ).length,
    watchlist_total: snapshot.watchlist.length,
    watchlist_ranked: ranked.filter((p) => watchlist.has(p.slug)).length,
  };

  // --- score and rank every rankable protocol, strongest first
  const scored = ranked
    .map((p) => {
      const parts = predictParts(p, snapshot, model);
      const implied = Math.max(1, Math.round(Math.exp(parts.blended)));
      const fm = farmMath(implied, p.tvl_usd);
      return { p, implied, fm, parts };
    })
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));
  // enforce non-increasing implied values after rounding
  let prev = Number.POSITIVE_INFINITY;
  const board: BoardRow[] = scored.map((s, i) => {
    const implied = Math.min(s.implied, prev);
    prev = implied;
    return {
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      implied_value_usd: implied,
      farm_steps: farmSteps(s.p, implied, s.fm),
    };
  });

  const compact: CompactRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category ?? 'Unknown',
    rank: i + 1,
    implied_value_usd: Math.min(s.implied, board[i]!.implied_value_usd),
    tvl_usd: s.p.tvl_usd,
    growth_7d: s.p.change_7d,
    age_days: ageDays(s.p, snapshot.as_of),
    chains: s.p.chains,
    watchlist: watchlist.has(s.p.slug),
    farmer_value_usd: Math.round(s.fm.farmerValue * 100) / 100,
    farmers: s.fm.farmers,
    net_usd: Math.round(s.fm.net * 100) / 100,
    usd_per_hour: Math.round(s.fm.perHour * 100) / 100,
    verdict: s.fm.verdict,
    rank_lo: i + 1,
    rank_hi: i + 1,
    curve_usd: Math.max(1, Math.round(Math.exp(s.parts.curve))),
    grouped_usd: Math.max(1, Math.round(Math.exp(s.parts.grouped))),
    ridge_usd: Math.max(1, Math.round(Math.exp(s.parts.ridge))),
    farm_steps: board[i]!.farm_steps,
  }));

  // --- live set: the 24 biggest traded tokens, for the comps table
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Unknown',
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      ratio: Math.round((p.mcap_usd! / p.tvl_usd) * 1000) / 1000,
    }));

  const ridgeNames = ['lnTVL', 'growth7d', 'logAge', 'nChains', ...model.ridgeChains.map((c) => `on_${c}`)];
  const ridgeCoefs: Record<string, number> = {};
  ridgeNames.forEach((name, j) => {
    ridgeCoefs[name] = Math.round(model.ridgeBeta[j + 1]! * 10000) / 10000;
  });

  const radar: RadarData = {
    model: {
      name: MODEL_NAME,
      version: MODEL_VERSION,
      curve_a: Math.round(model.curveA * 10000) / 10000,
      curve_s: Math.round(model.curveS * 10000) / 10000,
      global_median_resid: Math.round(model.globalMedianResid * 10000) / 10000,
      group_offsets: Object.fromEntries(
        Object.entries(model.offsets).map(([g, v]) => [g, Math.round(v * 10000) / 10000]),
      ),
      group_sizes: model.groupSizes,
      ridge_lambda: RIDGE_LAMBDA,
      ridge_rounds: RIDGE_ROUNDS,
      ridge_intercept: Math.round(model.ridgeBeta[0]! * 10000) / 10000,
      ridge_coefs: ridgeCoefs,
      ridge_chains: model.ridgeChains,
      blend_grouped: BLEND_GROUPED,
      blend_ridge: BLEND_RIDGE,
      shrink_k: SHRINK_K,
      validation: VALIDATION,
      farm: {
        allocation_pct: FARM_ALLOCATION_PCT,
        tvl_per_farmer: TVL_PER_FARMER,
        farmers_min: FARMERS_MIN,
        farmers_max: FARMERS_MAX,
        gas_total_usd: GAS_TOTAL_USD,
        hours_total: HOURS_TOTAL,
        farm_net_min: FARM_NET_MIN,
        farm_per_hour_min: FARM_PER_HOUR_MIN,
        thin_net_min: THIN_NET_MIN,
        thin_per_hour_min: THIN_PER_HOUR_MIN,
      },
    },
    audit,
    board: compact,
    live,
    board_size: board.length,
    early_size: board.length - audit.watchlist_ranked,
    live_size: live.length,
  };
  return { board, radar };
}

/** The gate's shape checks. Returns an error string or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `board has ${board.length} rows, the gate needs at least 100`;
  if (board.length > 4000) return `board has ${board.length} rows, the gate allows at most 4000`;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${row.slug} has rank ${row.rank}, expected ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `row ${row.slug} has a bad implied value ${row.implied_value_usd}`;
    }
    if (row.implied_value_usd > 100_000_000_000_000) {
      return `row ${row.slug} implied value exceeds the cap`;
    }
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${row.slug} implied value rises after ${board[i - 1]!.slug}`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps.length} farm steps (need 3-12)`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) {
        return `row ${row.slug} has a farm step of ${len} chars (need 20-600)`;
      }
    }
  }
  const slugs = new Set(board.map((r) => r.slug));
  for (const w of snapshot.watchlist) {
    if (!slugs.has(w)) return `watchlist slug ${w} is missing from the board`;
  }
  return null;
}

/** The dashboard's data file: window.RADAR = {...}; — written to /output/data.js. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

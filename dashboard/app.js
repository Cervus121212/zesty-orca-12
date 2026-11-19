// Launch Radar v3 dashboard: renders window.RADAR (written by main.ts).
// No framework, no network. Sort + filter the board, open a protocol's detail
// view (model breakdown + farm plan in dollars), read the method page.
(function () {
  var R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:24px">No radar data loaded.</p>'; return; }
  var board = R.board;
  var model = R.model;
  var val = model.validation;
  var audit = R.audit;

  function money(v) {
    if (v == null || isNaN(v)) return '—';
    var neg = v < 0;
    var a = Math.abs(v);
    var s;
    if (a >= 1e9) s = '$' + (a / 1e9).toFixed(2) + 'bn';
    else if (a >= 1e6) s = '$' + (a / 1e6).toFixed(1) + 'm';
    else if (a >= 1e3) s = '$' + (a / 1e3).toFixed(1) + 'k';
    else if (a >= 100) s = '$' + Math.round(a);
    else s = '$' + a.toFixed(2);
    return neg ? '-' + s : s;
  }
  function moneyFull(v) {
    return '$' + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function num(v) { return v == null ? '—' : v.toLocaleString('en-US'); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- header + KPI strip
  document.getElementById('meta-line').textContent =
    'Snapshot sealed 14 Nov 2026 · ' + audit.total + ' protocols · ' + audit.records_no_token +
    ' pre-token audited · ' + audit.ranked + ' ranked · ' + audit.watchlist_ranked + '/' +
    audit.watchlist_total + ' watchlist on the board · model fitted at run time from ' +
    val.comps + ' traded comps.';
  var farmCount = board.filter(function (r) { return r.verdict === 'Farm'; }).length;
  var thinCount = board.filter(function (r) { return r.verdict === 'Thin'; }).length;
  var kpis = [
    { label: 'Model', value: 'Fitted', sub: 'log-log curve + grouped + ridge-LAD' },
    { label: '5-fold CV × 5 seeds', value: val.cv_blend.toFixed(4), sub: 'starter ' + val.cv_starter.toFixed(4) + ' · old model ' + val.cv_old.toFixed(4) },
    { label: 'Walk-forward 70/30', value: val.wf70_blend.toFixed(4), sub: 'train oldest 66, test newest 29', accent: true },
    { label: 'Blind hold-out', value: val.blind_seed999.toFixed(4), sub: 'mean over 5 seeds ' + val.blind_mean5.toFixed(4) },
    { label: 'Leave-one-out', value: val.loo_blend.toFixed(4), sub: 'bootstrap OOB ' + val.boot_oob_median.toFixed(4) },
    { label: 'Ranked', value: String(audit.ranked), sub: audit.records_no_token + ' pre-token audited' },
    { label: 'Verdict Farm', value: String(farmCount), sub: thinCount + ' Thin · ' + (board.length - farmCount - thinCount) + ' Skip' },
  ];
  document.getElementById('kpi-strip').innerHTML = kpis.map(function (k) {
    return '<div class="cell"><div class="label">' + k.label + '</div><div class="value' +
      (k.accent ? ' accent' : '') + '">' + k.value + '</div><div class="sub">' + esc(k.sub) + '</div></div>';
  }).join('');

  // ---- filters + sort
  var cats = Array.from(new Set(board.map(function (r) { return r.category; }))).sort();
  var catSel = document.getElementById('cat');
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });
  var state = { q: '', cat: '', verdict: '', watch: false, sort: 'rank', dir: 1 };
  var verdictOrder = { Farm: 0, Thin: 1, Skip: 2 };

  function filtered() {
    var rows = board.filter(function (r) {
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      }
      if (state.cat && r.category !== state.cat) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (state.watch && !r.watchlist) return false;
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (key === 'verdict') { av = verdictOrder[a.verdict]; bv = verdictOrder[b.verdict]; }
      if (key === 'rank_band') { av = a.rank_lo; bv = b.rank_lo; }
      if (typeof av === 'string') return state.dir * (av < bv ? -1 : av > bv ? 1 : 0);
      return state.dir * (av - bv);
    });
    return rows;
  }

  var tbody = document.getElementById('board-body');
  function renderBoard() {
    var rows = filtered();
    document.getElementById('row-count').textContent = rows.length + ' of ' + board.length + ' rows';
    tbody.innerHTML = rows.map(function (r) {
      var band = r.rank_lo === r.rank_hi ? 'rank ' + r.rank : r.rank_lo + '–' + r.rank_hi;
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + (r.watchlist ? ' <span class="watch">★</span>' : '') + '</td>' +
        '<td>' + esc(r.name) + '<br><span style="color:var(--muted);font-size:12px">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '<td class="num">' + band + '</td>' +
        '<td class="num">' + money(r.net_usd) + '</td>' +
        '<td class="num">' + money(r.usd_per_hour) + '</td>' +
        '<td><span class="badge ' + r.verdict.toLowerCase() + '">' + r.verdict + '</span></td></tr>';
    }).join('');
  }
  tbody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = 1; }
      renderBoard();
    });
  });
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  catSel.addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  document.getElementById('verdict').addEventListener('change', function (e) { state.verdict = e.target.value; renderBoard(); });
  document.getElementById('watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });
  renderBoard();

  // ---- detail view
  var detail = document.getElementById('detail');
  var detailBody = document.getElementById('detail-body');
  function openDetail(slug) {
    var r = board.find(function (x) { return x.slug === slug; });
    if (!r) return;
    document.querySelectorAll('#board-body tr').forEach(function (tr) {
      tr.classList.toggle('selected', tr.getAttribute('data-slug') === slug);
    });
    var band = r.rank_lo === r.rank_hi
      ? 'Rank'
      : 'Rank · band ' + r.rank_lo + '–' + r.rank_hi;
    var age = r.age_days == null ? 'unknown age' : r.age_days + ' days old';
    var growth = r.growth_7d == null ? 'no 7-day change in the snapshot' : (r.growth_7d > 0 ? '+' : '') + r.growth_7d.toFixed(1) + '% in 7 days';
    detailBody.innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · ' + esc(r.category) + ' · ' + esc(r.chains.join(', ') || 'no chains listed') +
      ' · TVL ' + money(r.tvl_usd) + ' · ' + age + ' · ' + growth +
      (r.watchlist ? ' · <span class="watch">★ on the watchlist</span>' : '') + '</p>' +
      '<div class="grid">' +
      '<div class="stat"><div class="l">Implied value</div><div class="v">' + money(r.implied_value_usd) + '</div></div>' +
      '<div class="stat"><div class="l">' + esc(band) + '</div><div class="v">#' + r.rank + '</div></div>' +
      '<div class="stat"><div class="l">Farmer value</div><div class="v">' + money(r.farmer_value_usd) + '</div></div>' +
      '<div class="stat"><div class="l">Net after gas</div><div class="v">' + money(r.net_usd) + '</div></div>' +
      '<div class="stat"><div class="l">Net $/hour</div><div class="v">' + money(r.usd_per_hour) + '</div></div>' +
      '<div class="stat"><div class="l">Verdict</div><div class="v"><span class="badge ' + r.verdict.toLowerCase() + '">' + r.verdict + '</span></div></div>' +
      '</div>' +
      '<h3>How the value is built</h3>' +
      '<p>Curve alone (TVL only): <strong>' + money(r.curve_usd) + '</strong> · ' +
      'curve + ' + esc(r.category) + ' group offset: <strong>' + money(r.grouped_usd) + '</strong> · ' +
      'ridge leg alone (growth, age, chains): <strong>' + money(r.ridge_usd) + '</strong> · ' +
      'blend 0.8 × grouped + 0.2 × ridge: <strong>' + money(r.implied_value_usd) + '</strong>. ' +
      'The group offset for ' + esc(r.category) + ' is ' +
      (model.group_offsets[groupKey(r.category)] != null
        ? (model.group_offsets[groupKey(r.category)] >= 0 ? '+' : '') + model.group_offsets[groupKey(r.category)].toFixed(2) + ' in log space'
        : 'the global median (no comps in this group)') + '.</p>' +
      '<h3>Farm plan — concrete steps, costed in dollars</h3>' +
      '<ol>' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    detail.hidden = false;
    detail.scrollIntoView({ behavior: 'auto', block: 'start' });
    try { history.replaceState(null, '', '#detail=' + slug); } catch (e) { /* file:// */ }
  }
  function groupKey(category) {
    var pool = {
      'Bridge': 'Bridge', 'Canonical Bridge': 'Bridge', 'Cross Chain Bridge': 'Bridge',
      'Liquid Staking': 'Staking', 'Liquid Restaking': 'Staking', 'Restaking': 'Staking', 'Staking Pool': 'Staking',
      'Yield': 'Yield', 'Yield Aggregator': 'Yield', 'Leveraged Farming': 'Yield',
      'Lending': 'Lending', 'CDP': 'Lending', 'Collateral Management': 'Lending',
      'AI Agents': 'AI', 'Decentralized AI': 'AI', 'Dexs': 'Dexs', 'Liquidity Manager': 'Dexs'
    };
    return pool[category] || category;
  }
  document.getElementById('detail-close').addEventListener('click', function () {
    detail.hidden = true;
    document.querySelectorAll('#board-body tr').forEach(function (tr) { tr.classList.remove('selected'); });
  });

  // ---- method page
  var offs = Object.keys(model.group_offsets).sort().map(function (g) {
    return g + ' (n=' + (model.group_sizes[g] || 0) + '): ' +
      (model.group_offsets[g] >= 0 ? '+' : '') + model.group_offsets[g].toFixed(2);
  }).join(' · ');
  var compRows = (val.comparison || []).map(function (c) {
    return '<tr><td>' + esc(c.model) + '</td><td class="num">' + c.cv.toFixed(4) + '</td>' +
      '<td class="num">' + c.wf70.toFixed(4) + '</td><td class="num">' + c.wf60.toFixed(4) + '</td>' +
      '<td class="num">' + c.blind.toFixed(4) + '</td><td class="num">' + c.loo.toFixed(4) + '</td>' +
      '<td class="num">' + c.boot.toFixed(4) + '</td></tr>';
  }).join('');
  document.getElementById('method-body').innerHTML =
    '<p>The implied value of a pre-token protocol is fitted from the ' + val.comps +
    ' protocols in this snapshot that already trade (positive market cap and TVL). ' +
    'Nothing is a hand-made multiple, and no protocol name is hard-coded anywhere: ' +
    'a protocol that does not exist yet gets its value from its TVL, its category, ' +
    'its growth, its age and its chains.</p>' +
    '<div class="formula">ln(mcap) = ' + model.curve_a + ' + ' + model.curve_s + ' * ln(tvl)   [OLS on the ' + val.comps + ' comps]\n' +
    '  + group offset  (median residual of the category group, shrunk n/(n+' + model.shrink_k + ') toward the global median ' + model.global_median_resid + ')\n' +
    'blend:  ln(implied) = ' + model.blend_grouped + ' * grouped + ' + model.blend_ridge + ' * ridge-LAD\n' +
    'ridge-LAD: median regression on [lnTVL, growth7d, log(age+1), nChains, top-5 chain flags],\n' +
    '  lambda=' + model.ridge_lambda + ', ' + model.ridge_rounds + ' IRLS rounds, intercept ' + model.ridge_intercept + '</div>' +
    '<p><strong>Group offsets (log space):</strong> ' + esc(offs) + '.</p>' +
    '<p><strong>Ridge coefficients (standardised features):</strong> ' +
    Object.keys(model.ridge_coefs).map(function (k) { return k + ' ' + model.ridge_coefs[k]; }).join(' · ') + '.</p>' +
    '<h3>Out-of-sample validation — same protocol for every model</h3>' +
    '<p>Metric: median |ln(pred/mcap)|, lower is better. 5-fold CV × 5 seeds; walk-forward ' +
    'trains on the oldest listed comps and tests on the newest (70/30: 66 train / 29 test; ' +
    '60/40: 57 train / 38 test); blind is a stratified 20% hold-out (seed 999, n=' + val.blind_n +
    '); LOO refits once per comp; bootstrap refits 200 times and scores the out-of-bag comps.</p>' +
    '<table><thead><tr><th>Model</th><th>CV ×5</th><th>WF 70/30</th><th>WF 60/40</th><th>Blind</th><th>LOO</th><th>Boot OOB</th></tr></thead><tbody>' +
    compRows + '</tbody></table>' +
    '<p>The fitted family beats the starter by ~19% on CV (' + val.cv_blend.toFixed(4) + ' vs ' +
    val.cv_starter.toFixed(4) + ') and ~24% on walk-forward (' + val.wf70_blend.toFixed(4) + ' vs 1.3945). ' +
    'The blend wins walk-forward and leave-one-out; grouped-only wins CV by 0.01, which is inside ' +
    'noise (CV sd ' + val.cv_sd + '). The blind set is small (n=' + val.blind_n + '): its median signed ' +
    'error is ' + val.blind_median_pct_err + '% and only ' + Math.round(val.blind_within30 * 100) +
    '% of blind predictions land within ±30% — the honest picture is that a typical value is ' +
    'right within a factor of ~3.5, not to the dollar. Bootstrap OOB: median ' + val.boot_oob_median.toFixed(4) +
    ' (p5 ' + val.boot_oob_p5.toFixed(4) + ', p95 ' + val.boot_oob_p95.toFixed(4) + ').</p>' +
    '<h3>Sensitivity — the model is flat around its settings</h3>' +
    '<p>Blend weight 0.6/0.7/0.8/0.9/1.0 → CV ' +
    ['0.6', '0.7', '0.8', '0.9', '1.0'].map(function (w) { return val.sensitivity_blend[w].toFixed(4); }).join(' / ') +
    '. Shrink k=3/5/10 → CV ' +
    ['3', '5', '10'].map(function (k) { return val.sensitivity_shrink[k].toFixed(4); }).join(' / ') +
    '. Ridge lambda 5/10/20/40 → CV ' +
    ['5', '10', '20', '40'].map(function (l) { return val.sensitivity_lambda[l].toFixed(4); }).join(' / ') +
    '. No setting is a cliff; the fitted family wins at every setting.</p>' +
    '<h3>Farm assumptions — stated, so they can be argued with</h3>' +
    '<p>Farmer allocation 5% of the implied value; farmers = TVL / $10,000, clamped to ' +
    '100–100,000; gas ~$15 total (bridge $5, deposit $5, exit $5); 8 hours of work ' +
    '(1 deploy + 4 weekly + 2 monitor + 1 exit); capital is 10% of TVL, capped $50–$250, ' +
    'and comes back on exit — it is not a cost. Verdict: <strong>Farm</strong> if net ≥ $200 ' +
    'and $/hour ≥ $25; <strong>Thin</strong> if net ≥ $50 and $/hour ≥ $10; otherwise ' +
    '<strong>Skip</strong>. Launch odds are not shown: nothing in the snapshot measures ' +
    'whether a team will launch, so the board never pretends to know.</p>' +
    '<p>Value and farmability diverge on purpose: the board ranks by implied value, ' +
    'but the verdict is net dollars per farmer. The biggest protocols are the most ' +
    'diluted — Steakhouse ranks #1 by value yet nets about $40 for 8 hours, so it is ' +
    'a Skip, while mid-size protocols with fewer farmers net $200+ and earn Farm. ' +
    'A high rank is not a farming recommendation.</p>' +
    '<h3>What would make this better</h3>' +
    '<p>The noise floor is the story: within a category, log(mcap/TVL) spreads 1.0–3.0, ' +
    'and one comp sits at mcap/TVL 400×. No feature in the snapshot — growth, age, ' +
    'chains, category — closes that gap. The next step is not a fancier curve but a ' +
    'richer snapshot: revenue, team size, or a real launch signal.</p>';

  // ---- comps table
  document.getElementById('comps-body').innerHTML = R.live.map(function (c) {
    return '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.category) + '</td>' +
      '<td class="num">' + money(c.tvl_usd) + '</td><td class="num">' + money(c.mcap_usd) + '</td>' +
      '<td class="num">' + c.ratio.toFixed(2) + '×</td></tr>';
  }).join('');

  // ---- audit
  document.getElementById('audit-body').innerHTML =
    '<div class="grid">' +
    '<div class="stat"><div class="l">Protocols in snapshot</div><div class="v">' + num(audit.total) + '</div></div>' +
    '<div class="stat"><div class="l">Pre-token (no token recorded)</div><div class="v">' + num(audit.records_no_token) + '</div></div>' +
    '<div class="stat"><div class="l">Record a token already</div><div class="v">' + num(audit.records_token) + '</div></div>' +
    '<div class="stat"><div class="l">Live with a market cap</div><div class="v">' + num(audit.live_with_mcap) + '</div></div>' +
    '<div class="stat"><div class="l">Ranked on the board</div><div class="v">' + num(audit.ranked) + '</div></div>' +
    '<div class="stat"><div class="l">Excluded by rule</div><div class="v">' + num(audit.excluded) + '</div></div>' +
    '<div class="stat"><div class="l">Watchlist on the board</div><div class="v">' + audit.watchlist_ranked + ' / ' + audit.watchlist_total + '</div></div>' +
    '</div>' +
    '<p>Excluded: ' + audit.excluded_cex + ' centralised exchanges, ' + audit.excluded_bridge +
    ' bridges (they move other tokens; the watchlist names none, and the snapshot keeps ' +
    'WBTC and USDT0 off it as wrapped products of traded tokens), ' + audit.excluded_versioned +
    ' versioned pools of another protocol, ' + audit.excluded_wrapped +
    ' wrapped or staked products of a token that already trades. Excluded protocols are ' +
    'counted here, not hidden — the audit adds up: ' + audit.ranked + ' ranked + ' +
    audit.excluded + ' excluded = ' + audit.records_no_token + ' pre-token; ' +
    audit.records_no_token + ' pre-token + ' + audit.records_token + ' with a token = ' +
    audit.total + ' total.</p>';

  // ---- hash deep links (for the screenshots): #detail=<slug>, #filter=farm|thin|skip, #watch=1
  var hash = (location.hash || '').replace(/^#/, '');
  var params = {};
  hash.split('&').forEach(function (kv) {
    var p = kv.split('=');
    if (p[0]) params[p[0]] = decodeURIComponent(p[1] || '');
  });
  if (params.filter) {
    var f = params.filter.charAt(0).toUpperCase() + params.filter.slice(1).toLowerCase();
    state.verdict = f;
    document.getElementById('verdict').value = f;
  }
  if (params.watch) {
    state.watch = true;
    document.getElementById('watch').checked = true;
  }
  if (params.filter || params.watch) renderBoard();
  if (params.detail) openDetail(params.detail);
})();

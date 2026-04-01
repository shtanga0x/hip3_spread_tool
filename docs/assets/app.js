/* ============================================================
   HIP-3 Spread Tool — app.js
   ============================================================ */

const API = 'https://api.hyperliquid.xyz/info';

// ── State ──
let state = {
  coin1: '',
  coin2: '',
  interval: '1h',
  period: 7,
  spreadSwapped: false,
  candleMode: false,      // false = line, true = candle
  fundingData1: [],
  fundingData2: [],
  candles1: [],
  candles2: [],
};

// ── Charts ──
let fundingChart = null;
let fundingSeries1 = null;
let fundingSeries2 = null;
let spreadChart = null;
let spreadLineSeries = null;
let spreadCandleSeries = null;

// ── DOM refs ──
const $asset1 = document.getElementById('input-asset1');
const $asset2 = document.getElementById('input-asset2');
const $interval = document.getElementById('select-interval');
const $period = document.getElementById('select-period');
const $load = document.getElementById('btn-load');
const $save = document.getElementById('btn-save');
const $upload = document.getElementById('btn-upload');
const $fileUpload = document.getElementById('file-upload');
const $swapBtn = document.getElementById('btn-swap-spread');
const $candleLineBtn = document.getElementById('btn-candle-line');
const $status = document.getElementById('status');
const $chartsSection = document.getElementById('charts-section');
const $fundingLegend = document.getElementById('funding-legend');
const $spreadLegend = document.getElementById('spread-legend');

// ── Helpers ──

function parseCoin(input) {
  const s = input.trim();
  // "https://app.hyperliquid.xyz/trade/cash:TSLA" → "cash:TSLA"
  const m = s.match(/trade\/([^/?#]+)/);
  if (m) return m[1];
  // bare "cash:TSLA"
  if (s.includes(':')) return s;
  return s;
}

function setStatus(msg, cls) {
  $status.textContent = msg;
  $status.className = cls || '';
}

async function apiPost(body) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

// Paginate candles (max 500 per response)
async function fetchAllCandles(coin, interval, startTime, endTime) {
  let all = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const batch = await apiPost({
      type: 'candleSnapshot',
      req: { coin, interval, startTime: cursor, endTime },
    });
    if (!batch || batch.length === 0) break;
    all = all.concat(batch);
    const lastT = batch[batch.length - 1].T;
    if (lastT + 1 >= endTime) break;
    cursor = lastT + 1;
  }
  return all;
}

async function fetchFunding(coin, startTime, endTime) {
  let all = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const batch = await apiPost({
      type: 'fundingHistory',
      coin,
      startTime: cursor,
      endTime,
    });
    if (!batch || batch.length === 0) break;
    all = all.concat(batch);
    const lastT = batch[batch.length - 1].time;
    if (lastT + 1 >= endTime) break;
    cursor = lastT + 1;
  }
  return all;
}

// Convert ms timestamp to lightweight-charts UTC timestamp (seconds)
function tsToUTC(ms) {
  return Math.floor(ms / 1000);
}

// ── Chart creation ──

const CHART_OPTS = {
  layout: {
    background: { color: '#161b22' },
    textColor: '#8b949e',
    fontSize: 11,
  },
  grid: {
    vertLines: { color: '#21262d' },
    horzLines: { color: '#21262d' },
  },
  crosshair: { mode: 0 },
  timeScale: {
    timeVisible: true,
    secondsVisible: false,
    borderColor: '#30363d',
  },
  rightPriceScale: {
    borderColor: '#30363d',
  },
  handleScroll: true,
  handleScale: true,
};

const COLOR1 = '#58a6ff';  // blue
const COLOR2 = '#f0883e';  // orange
const SPREAD_UP = '#3fb950';
const SPREAD_DOWN = '#f85149';

function createFundingChart() {
  const container = document.getElementById('funding-chart');
  container.innerHTML = '';
  fundingChart = LightweightCharts.createChart(container, {
    ...CHART_OPTS,
    width: container.clientWidth,
    height: 350,
  });

  fundingSeries1 = fundingChart.addLineSeries({
    color: COLOR1,
    lineWidth: 2,
    priceFormat: { type: 'custom', formatter: v => (v * 100).toFixed(4) + '%' },
  });

  fundingSeries2 = fundingChart.addLineSeries({
    color: COLOR2,
    lineWidth: 2,
    priceFormat: { type: 'custom', formatter: v => (v * 100).toFixed(4) + '%' },
  });

  // Resize
  new ResizeObserver(entries => {
    const { width } = entries[0].contentRect;
    fundingChart.applyOptions({ width });
  }).observe(container);
}

function createSpreadChart() {
  const container = document.getElementById('spread-chart');
  container.innerHTML = '';
  spreadChart = LightweightCharts.createChart(container, {
    ...CHART_OPTS,
    width: container.clientWidth,
    height: 350,
  });

  spreadLineSeries = spreadChart.addLineSeries({
    color: COLOR1,
    lineWidth: 2,
    priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
  });

  spreadCandleSeries = spreadChart.addCandlestickSeries({
    upColor: SPREAD_UP,
    downColor: SPREAD_DOWN,
    borderUpColor: SPREAD_UP,
    borderDownColor: SPREAD_DOWN,
    wickUpColor: SPREAD_UP,
    wickDownColor: SPREAD_DOWN,
    priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
  });

  // Start in line mode — hide candle series
  spreadCandleSeries.applyOptions({ visible: false });

  new ResizeObserver(entries => {
    const { width } = entries[0].contentRect;
    spreadChart.applyOptions({ width });
  }).observe(container);
}

// ── Data processing ──

function buildFundingData(raw) {
  return raw.map(d => ({
    time: tsToUTC(d.time),
    value: parseFloat(d.fundingRate),
  }));
}

function buildSpreadCandles(candles1, candles2, swapped) {
  // Align by timestamp
  const map2 = new Map();
  candles2.forEach(c => map2.set(c.t, c));

  const result = [];
  for (const c1 of candles1) {
    const c2 = map2.get(c1.t);
    if (!c2) continue;
    const sign = swapped ? -1 : 1;
    const o = sign * (parseFloat(c2.o) - parseFloat(c1.o));
    const h = sign * (parseFloat(c2.h) - parseFloat(c1.h));
    const l = sign * (parseFloat(c2.l) - parseFloat(c1.l));
    const c = sign * (parseFloat(c2.c) - parseFloat(c1.c));

    result.push({
      time: tsToUTC(c1.t),
      open: o,
      high: Math.max(o, h, l, c),
      low: Math.min(o, h, l, c),
      close: c,
    });
  }
  return result;
}

function buildSpreadLine(candles1, candles2, swapped) {
  const map2 = new Map();
  candles2.forEach(c => map2.set(c.t, c));

  const result = [];
  for (const c1 of candles1) {
    const c2 = map2.get(c1.t);
    if (!c2) continue;
    const sign = swapped ? -1 : 1;
    const val = sign * (parseFloat(c2.c) - parseFloat(c1.c));
    result.push({ time: tsToUTC(c1.t), value: val });
  }
  return result;
}

function updateLegends() {
  const label1 = state.spreadSwapped ? state.coin2 : state.coin1;
  const label2 = state.spreadSwapped ? state.coin1 : state.coin2;

  $fundingLegend.innerHTML =
    `<span class="legend-item"><span class="legend-dot" style="background:${COLOR1}"></span>${state.coin1}</span>` +
    `<span class="legend-item"><span class="legend-dot" style="background:${COLOR2}"></span>${state.coin2}</span>`;

  $spreadLegend.innerHTML =
    `<span class="legend-item">${label2} − ${label1}</span>`;
}

function renderSpread() {
  const lineData = buildSpreadLine(state.candles1, state.candles2, state.spreadSwapped);
  const candleData = buildSpreadCandles(state.candles1, state.candles2, state.spreadSwapped);

  spreadLineSeries.setData(lineData);
  spreadCandleSeries.setData(candleData);

  spreadLineSeries.applyOptions({ visible: !state.candleMode });
  spreadCandleSeries.applyOptions({ visible: state.candleMode });

  spreadChart.timeScale().fitContent();
  updateLegends();
}

// ── Sync crosshairs between charts ──

function syncCrosshairs(src, dst) {
  src.subscribeCrosshairMove(param => {
    if (!param || !param.time) {
      dst.clearCrosshairPosition();
      return;
    }
    // Move crosshair on dst to same time
    dst.setCrosshairPosition(undefined, param.time, dst.options().rightPriceScale ? spreadLineSeries : fundingSeries1);
  });
}

// ── Load data ──

async function loadData() {
  const coin1 = parseCoin($asset1.value);
  const coin2 = parseCoin($asset2.value);
  if (!coin1 || !coin2) {
    setStatus('Please enter both asset links', 'error');
    return;
  }

  state.coin1 = coin1;
  state.coin2 = coin2;
  state.interval = $interval.value;
  state.period = parseInt($period.value);

  const now = Date.now();
  const startTime = now - state.period * 24 * 60 * 60 * 1000;

  $load.disabled = true;
  setStatus('Loading data...', 'loading');

  try {
    // Fetch all 4 in parallel
    const [candles1, candles2, funding1, funding2] = await Promise.all([
      fetchAllCandles(coin1, state.interval, startTime, now),
      fetchAllCandles(coin2, state.interval, startTime, now),
      fetchFunding(coin1, startTime, now),
      fetchFunding(coin2, startTime, now),
    ]);

    state.candles1 = candles1;
    state.candles2 = candles2;
    state.fundingData1 = funding1;
    state.fundingData2 = funding2;

    if (candles1.length === 0 || candles2.length === 0) {
      setStatus('No candle data returned. Check asset names.', 'error');
      $load.disabled = false;
      return;
    }

    // Create charts
    createFundingChart();
    createSpreadChart();

    // Funding
    const fd1 = buildFundingData(funding1);
    const fd2 = buildFundingData(funding2);
    fundingSeries1.setData(fd1);
    fundingSeries2.setData(fd2);
    fundingChart.timeScale().fitContent();

    // Spread
    renderSpread();

    // Sync crosshairs
    syncCrosshairs(fundingChart, spreadChart);
    syncCrosshairs(spreadChart, fundingChart);

    $chartsSection.style.display = '';
    $pnlSection.style.display = '';
    renderPnL();
    setStatus(`Loaded ${candles1.length} + ${candles2.length} candles, ${fd1.length} + ${fd2.length} funding points`);
  } catch (e) {
    setStatus('Error: ' + e.message, 'error');
    console.error(e);
  } finally {
    $load.disabled = false;
  }
}

// ── Save / Upload ──

async function saveSnapshot() {
  // 1. Save config JSON
  const config = {
    coin1: state.coin1,
    coin2: state.coin2,
    interval: state.interval,
    period: state.period,
    spreadSwapped: state.spreadSwapped,
    candleMode: state.candleMode,
    timestamp: new Date().toISOString(),
  };

  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hip3_spread_${state.coin1}_vs_${state.coin2}_${Date.now()}.json`;
  a.click();

  // 2. Save screenshot
  try {
    const canvas = await html2canvas($chartsSection, {
      backgroundColor: '#0d1117',
      scale: 2,
    });
    const imgA = document.createElement('a');
    imgA.href = canvas.toDataURL('image/png');
    imgA.download = `hip3_spread_${state.coin1}_vs_${state.coin2}_${Date.now()}.png`;
    imgA.click();
  } catch (e) {
    console.error('Screenshot failed:', e);
    setStatus('Config saved, but screenshot failed.', 'error');
  }
}

function uploadConfig() {
  $fileUpload.click();
}

$fileUpload.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const config = JSON.parse(text);
    $asset1.value = config.coin1 || '';
    $asset2.value = config.coin2 || '';
    $interval.value = config.interval || '1h';
    $period.value = String(config.period || 7);
    state.spreadSwapped = config.spreadSwapped || false;
    state.candleMode = config.candleMode || false;
    $candleLineBtn.textContent = state.candleMode ? 'Candle' : 'Line';
    $candleLineBtn.classList.toggle('active', state.candleMode);
    setStatus('Config loaded — click Load Data to fetch.', '');
  } catch (err) {
    setStatus('Invalid config file', 'error');
  }
  $fileUpload.value = '';
});

// ── PnL Analysis ──

const $positionSize = document.getElementById('input-position-size');
const $pnlSection = document.getElementById('pnl-section');
const $pnlBody = document.getElementById('pnl-body');

// Only allow integers in position size input
$positionSize.addEventListener('input', () => {
  $positionSize.value = $positionSize.value.replace(/[^0-9]/g, '');
  renderPnL();
});

function coinLink(coin) {
  return `https://app.hyperliquid.xyz/trade/${coin}`;
}

function fmtUSD(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : v > 0 ? '+' : '';
  if (abs >= 1000) return sign + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sign + '$' + abs.toFixed(2);
}

function fmtPct(v) {
  const sign = v < 0 ? '' : '+';
  return sign + v.toFixed(2) + '%';
}

function fmtPrice(v) {
  if (Math.abs(v) >= 100) return v.toFixed(2);
  if (Math.abs(v) >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

function fmtSpreadEffect(v) {
  const sign = v >= 0 ? '+' : '-';
  const cls = v >= 0 ? 'positive' : 'negative';
  return `<span class="spread-effect ${cls}">${sign}${Math.abs(v).toFixed(4)}</span>`;
}

function fmtTime(tsMs) {
  const d = new Date(tsMs);
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function getAlignedSpreadData() {
  const { candles1, candles2, spreadSwapped } = state;
  const map2 = new Map();
  candles2.forEach(c => map2.set(c.t, c));

  const aligned = [];
  for (const c1 of candles1) {
    const c2 = map2.get(c1.t);
    if (!c2) continue;
    const p1 = parseFloat(c1.c);
    const p2 = parseFloat(c2.c);
    const spread = spreadSwapped ? (p1 - p2) : (p2 - p1);
    aligned.push({ t: c1.t, p1, p2, spread });
  }
  return aligned;
}

function renderPnL() {
  const aligned = getAlignedSpreadData();
  if (aligned.length < 2) {
    $pnlBody.innerHTML = '<div style="padding:8px;color:#8b949e;font-size:12px;">Not enough data</div>';
    return;
  }

  const posSize = parseInt($positionSize.value) || 0;
  const { spreadSwapped, coin1, coin2 } = state;

  // Long side buys the higher-spread asset, short side sells the lower
  // If not swapped: spread = coin2 - coin1 → LONG coin2, SHORT coin1
  // If swapped:     spread = coin1 - coin2 → LONG coin1, SHORT coin2
  const longCoin = spreadSwapped ? coin1 : coin2;
  const shortCoin = spreadSwapped ? coin2 : coin1;

  const entry = aligned[0];
  const exit = aligned[aligned.length - 1];

  // Best entry = min spread (cheapest to open), best exit = max spread
  let bestEntry = aligned[0];
  let bestExit = aligned[0];
  for (const pt of aligned) {
    if (pt.spread < bestEntry.spread) bestEntry = pt;
    if (pt.spread > bestExit.spread) bestExit = pt;
  }

  // Prices for long/short legs
  const longEntryP = spreadSwapped ? entry.p1 : entry.p2;
  const shortEntryP = spreadSwapped ? entry.p2 : entry.p1;
  const longExitP = spreadSwapped ? exit.p1 : exit.p2;
  const shortExitP = spreadSwapped ? exit.p2 : exit.p1;

  // PnL calc (equal $ notional each side)
  let pnlDollar = 0;
  let pnlPct = 0;
  if (posSize > 0 && longEntryP > 0 && shortEntryP > 0) {
    const longPnl = posSize * (longExitP / longEntryP - 1);
    const shortPnl = posSize * (1 - shortExitP / shortEntryP);
    pnlDollar = longPnl + shortPnl;
    pnlPct = (pnlDollar / posSize) * 100;
  }

  // Spread effects
  const entrySpreadEffect = entry.spread;
  const exitSpreadEffect = exit.spread;
  const bestEntryEffect = bestEntry.spread - entry.spread;  // negative = better (you saved)
  const bestExitEffect = bestExit.spread - exit.spread;     // positive = better (you gained)

  // Best-entry PnL (what if you entered at best entry and exited at best exit)
  const bestLongEntryP = spreadSwapped ? bestEntry.p1 : bestEntry.p2;
  const bestShortEntryP = spreadSwapped ? bestEntry.p2 : bestEntry.p1;
  const bestLongExitP = spreadSwapped ? bestExit.p1 : bestExit.p2;
  const bestShortExitP = spreadSwapped ? bestExit.p2 : bestExit.p1;
  let bestPnlDollar = 0;
  let bestPnlPct = 0;
  if (posSize > 0 && bestLongEntryP > 0 && bestShortEntryP > 0) {
    const bLong = posSize * (bestLongExitP / bestLongEntryP - 1);
    const bShort = posSize * (1 - bestShortExitP / bestShortEntryP);
    bestPnlDollar = bLong + bShort;
    bestPnlPct = (bestPnlDollar / posSize) * 100;
  }

  const pnlClass = pnlDollar > 0 ? 'profit' : pnlDollar < 0 ? 'loss' : 'neutral';
  const bestPnlClass = bestPnlDollar > 0 ? 'profit' : bestPnlDollar < 0 ? 'loss' : 'neutral';

  $pnlBody.innerHTML = `
    <div class="pnl-position-row">
      <div class="leg">
        <span class="leg-label long">Long</span>
        <a href="${coinLink(longCoin)}" target="_blank" rel="noopener">${longCoin}</a>
      </div>
      <div class="leg">
        <span class="leg-label short">Short</span>
        <a href="${coinLink(shortCoin)}" target="_blank" rel="noopener">${shortCoin}</a>
      </div>
    </div>

    <div class="pnl-grid">
      <div class="pnl-card">
        <div class="pnl-card-label">Entry (First)</div>
        <div class="pnl-card-time">${fmtTime(entry.t)}</div>
        <div class="pnl-card-row"><span class="label">${longCoin}</span><span class="value">${fmtPrice(longEntryP)}</span></div>
        <div class="pnl-card-row"><span class="label">${shortCoin}</span><span class="value">${fmtPrice(shortEntryP)}</span></div>
        <div class="pnl-card-row"><span class="label">Spread</span><span class="value">${fmtSpreadEffect(entrySpreadEffect)}</span></div>
      </div>

      <div class="pnl-card highlight-best-entry">
        <div class="pnl-card-label">Best Entry</div>
        <div class="pnl-card-time">${fmtTime(bestEntry.t)}</div>
        <div class="pnl-card-row"><span class="label">${longCoin}</span><span class="value">${fmtPrice(spreadSwapped ? bestEntry.p1 : bestEntry.p2)}</span></div>
        <div class="pnl-card-row"><span class="label">${shortCoin}</span><span class="value">${fmtPrice(spreadSwapped ? bestEntry.p2 : bestEntry.p1)}</span></div>
        <div class="pnl-card-row"><span class="label">Spread</span><span class="value">${fmtSpreadEffect(bestEntry.spread)}</span></div>
        <div class="pnl-card-row"><span class="label">vs Entry</span>${fmtSpreadEffect(bestEntryEffect)}</div>
      </div>

      <div class="pnl-card highlight-best-exit">
        <div class="pnl-card-label">Best Exit</div>
        <div class="pnl-card-time">${fmtTime(bestExit.t)}</div>
        <div class="pnl-card-row"><span class="label">${longCoin}</span><span class="value">${fmtPrice(spreadSwapped ? bestExit.p1 : bestExit.p2)}</span></div>
        <div class="pnl-card-row"><span class="label">${shortCoin}</span><span class="value">${fmtPrice(spreadSwapped ? bestExit.p2 : bestExit.p1)}</span></div>
        <div class="pnl-card-row"><span class="label">Spread</span><span class="value">${fmtSpreadEffect(bestExit.spread)}</span></div>
        <div class="pnl-card-row"><span class="label">vs Exit</span>${fmtSpreadEffect(bestExitEffect)}</div>
      </div>

      <div class="pnl-card">
        <div class="pnl-card-label">Exit (Last)</div>
        <div class="pnl-card-time">${fmtTime(exit.t)}</div>
        <div class="pnl-card-row"><span class="label">${longCoin}</span><span class="value">${fmtPrice(longExitP)}</span></div>
        <div class="pnl-card-row"><span class="label">${shortCoin}</span><span class="value">${fmtPrice(shortExitP)}</span></div>
        <div class="pnl-card-row"><span class="label">Spread</span><span class="value">${fmtSpreadEffect(exitSpreadEffect)}</span></div>
      </div>
    </div>

    <div class="pnl-result">
      <div class="pnl-result-item">
        <span class="pnl-result-label">Position P&L (Entry → Exit)</span>
        <span class="pnl-result-value ${pnlClass}">${posSize > 0 ? fmtUSD(pnlDollar) : '—'}</span>
      </div>
      <div class="pnl-divider"></div>
      <div class="pnl-result-item">
        <span class="pnl-result-label">Return %</span>
        <span class="pnl-result-value ${pnlClass}">${posSize > 0 ? fmtPct(pnlPct) : '—'}</span>
      </div>
      <div class="pnl-divider"></div>
      <div class="pnl-result-item">
        <span class="pnl-result-label">Best P&L (Best Entry → Best Exit)</span>
        <span class="pnl-result-value ${bestPnlClass}">${posSize > 0 ? fmtUSD(bestPnlDollar) : '—'}</span>
      </div>
      <div class="pnl-divider"></div>
      <div class="pnl-result-item">
        <span class="pnl-result-label">Best Return %</span>
        <span class="pnl-result-value ${bestPnlClass}">${posSize > 0 ? fmtPct(bestPnlPct) : '—'}</span>
      </div>
    </div>
  `;
}

// ── Event listeners ──

$load.addEventListener('click', loadData);

$save.addEventListener('click', saveSnapshot);
$upload.addEventListener('click', uploadConfig);

$swapBtn.addEventListener('click', () => {
  state.spreadSwapped = !state.spreadSwapped;
  $swapBtn.textContent = state.spreadSwapped ? 'Swap B↔A' : 'Swap A↔B';
  if (state.candles1.length) { renderSpread(); renderPnL(); }
});

$candleLineBtn.addEventListener('click', () => {
  state.candleMode = !state.candleMode;
  $candleLineBtn.textContent = state.candleMode ? 'Candle' : 'Line';
  $candleLineBtn.classList.toggle('active', state.candleMode);
  if (state.candles1.length) { renderSpread(); renderPnL(); }
});

// Enter to load
[$asset1, $asset2].forEach(el => {
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') loadData();
  });
});

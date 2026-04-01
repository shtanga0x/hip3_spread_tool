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
  spreadPct: true,        // true = % spread, false = $ spread
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
const $spreadUnitBtn = document.getElementById('btn-spread-unit');
const $status = document.getElementById('status');
const $chartsSection = document.getElementById('charts-section');
const $fundingLegend = document.getElementById('funding-legend');
const $spreadLegend = document.getElementById('spread-legend');

// ── Helpers ──

function parseCoin(input) {
  const s = input.trim();
  const m = s.match(/trade\/([^/?#]+)/);
  if (m) return m[1];
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

const COLOR1 = '#58a6ff';
const COLOR2 = '#f0883e';
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

  const pctFmt = { type: 'custom', formatter: v => v.toFixed(4) + '%' };
  const dolFmt = { type: 'price', precision: 4, minMove: 0.0001 };
  const fmt = state.spreadPct ? pctFmt : dolFmt;

  spreadLineSeries = spreadChart.addLineSeries({
    color: COLOR1,
    lineWidth: 2,
    priceFormat: fmt,
  });

  spreadCandleSeries = spreadChart.addCandlestickSeries({
    upColor: SPREAD_UP,
    downColor: SPREAD_DOWN,
    borderUpColor: SPREAD_UP,
    borderDownColor: SPREAD_DOWN,
    wickUpColor: SPREAD_UP,
    wickDownColor: SPREAD_DOWN,
    priceFormat: fmt,
  });

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

// Compute spread for a single candle pair.
// pct=true: percentage of midpoint.  pct=false: absolute $.
function spreadVal(v2, v1, swapped, mid) {
  const raw = swapped ? (v1 - v2) : (v2 - v1);
  return mid > 0 ? (raw / mid) * 100 : raw;
}

function buildSpreadCandles(candles1, candles2, swapped, pct) {
  const map2 = new Map();
  candles2.forEach(c => map2.set(c.t, c));

  const result = [];
  for (const c1 of candles1) {
    const c2 = map2.get(c1.t);
    if (!c2) continue;

    const p1o = parseFloat(c1.o), p1h = parseFloat(c1.h), p1l = parseFloat(c1.l), p1c = parseFloat(c1.c);
    const p2o = parseFloat(c2.o), p2h = parseFloat(c2.h), p2l = parseFloat(c2.l), p2c = parseFloat(c2.c);

    if (pct) {
      const midO = (p1o + p2o) / 2, midH = (p1h + p2h) / 2, midL = (p1l + p2l) / 2, midC = (p1c + p2c) / 2;
      const o = spreadVal(p2o, p1o, swapped, midO);
      const h = spreadVal(p2h, p1h, swapped, midH);
      const l = spreadVal(p2l, p1l, swapped, midL);
      const c = spreadVal(p2c, p1c, swapped, midC);
      result.push({ time: tsToUTC(c1.t), open: o, high: Math.max(o,h,l,c), low: Math.min(o,h,l,c), close: c });
    } else {
      const sign = swapped ? -1 : 1;
      const o = sign * (p2o - p1o);
      const h = sign * (p2h - p1h);
      const l = sign * (p2l - p1l);
      const c = sign * (p2c - p1c);
      result.push({ time: tsToUTC(c1.t), open: o, high: Math.max(o,h,l,c), low: Math.min(o,h,l,c), close: c });
    }
  }
  return result;
}

function buildSpreadLine(candles1, candles2, swapped, pct) {
  const map2 = new Map();
  candles2.forEach(c => map2.set(c.t, c));

  const result = [];
  for (const c1 of candles1) {
    const c2 = map2.get(c1.t);
    if (!c2) continue;
    const p1 = parseFloat(c1.c), p2 = parseFloat(c2.c);
    const mid = (p1 + p2) / 2;
    let val;
    if (pct) {
      val = spreadVal(p2, p1, swapped, mid);
    } else {
      val = swapped ? (p1 - p2) : (p2 - p1);
    }
    result.push({ time: tsToUTC(c1.t), value: val });
  }
  return result;
}

function updateLegends() {
  const label1 = state.spreadSwapped ? state.coin2 : state.coin1;
  const label2 = state.spreadSwapped ? state.coin1 : state.coin2;
  const unit = state.spreadPct ? ' (%)' : ' ($)';

  $fundingLegend.innerHTML =
    `<span class="legend-item"><span class="legend-dot" style="background:${COLOR1}"></span>${state.coin1}</span>` +
    `<span class="legend-item"><span class="legend-dot" style="background:${COLOR2}"></span>${state.coin2}</span>`;

  $spreadLegend.innerHTML =
    `<span class="legend-item">${label2} − ${label1}${unit}</span>`;
}

function renderSpread() {
  const lineData = buildSpreadLine(state.candles1, state.candles2, state.spreadSwapped, state.spreadPct);
  const candleData = buildSpreadCandles(state.candles1, state.candles2, state.spreadSwapped, state.spreadPct);

  const pctFmt = { type: 'custom', formatter: v => v.toFixed(4) + '%' };
  const dolFmt = { type: 'price', precision: 4, minMove: 0.0001 };
  const fmt = state.spreadPct ? pctFmt : dolFmt;

  spreadLineSeries.applyOptions({ priceFormat: fmt });
  spreadCandleSeries.applyOptions({ priceFormat: fmt });

  spreadLineSeries.setData(lineData);
  spreadCandleSeries.setData(candleData);

  spreadLineSeries.applyOptions({ visible: !state.candleMode });
  spreadCandleSeries.applyOptions({ visible: state.candleMode });

  spreadChart.timeScale().fitContent();
  updateLegends();
}

// ── Sync crosshairs ──

function syncCrosshairs(src, dst) {
  src.subscribeCrosshairMove(param => {
    if (!param || !param.time) {
      dst.clearCrosshairPosition();
      return;
    }
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

    createFundingChart();
    createSpreadChart();

    const fd1 = buildFundingData(funding1);
    const fd2 = buildFundingData(funding2);
    fundingSeries1.setData(fd1);
    fundingSeries2.setData(fd2);
    fundingChart.timeScale().fitContent();

    renderSpread();

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
  const config = {
    coin1: state.coin1,
    coin2: state.coin2,
    interval: state.interval,
    period: state.period,
    spreadSwapped: state.spreadSwapped,
    candleMode: state.candleMode,
    spreadPct: state.spreadPct,
    timestamp: new Date().toISOString(),
  };

  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hip3_spread_${state.coin1}_vs_${state.coin2}_${Date.now()}.json`;
  a.click();

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
    state.spreadPct = config.spreadPct !== undefined ? config.spreadPct : true;
    $candleLineBtn.textContent = state.candleMode ? 'Candle' : 'Line';
    $candleLineBtn.classList.toggle('active', state.candleMode);
    $spreadUnitBtn.textContent = state.spreadPct ? '%' : '$';
    $spreadUnitBtn.classList.toggle('active', state.spreadPct);
    setStatus('Config loaded — click Load Data to fetch.', '');
  } catch (err) {
    setStatus('Invalid config file', 'error');
  }
  $fileUpload.value = '';
});

// ── PnL Analysis ──
//
// Spread trade: equal $ notional on each leg.
//   Position size = $ per leg (you deploy posSize LONG + posSize SHORT).
//
//   LONG leg P&L  = posSize × (P_long_exit / P_long_entry − 1)
//   SHORT leg P&L = posSize × (1 − P_short_exit / P_short_entry)
//   Total P&L     = LONG P&L + SHORT P&L
//
// For nearly-equal prices (same underlying, different dex):
//   ≈ posSize × (spread_exit − spread_entry) / avg_price
//
// Return % = Total P&L / posSize × 100  (on per-leg capital)
//

const $positionSize = document.getElementById('input-position-size');
const $pnlSection = document.getElementById('pnl-section');
const $pnlBody = document.getElementById('pnl-body');

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

function fmtSpread$(v) {
  const sign = v >= 0 ? '+' : '-';
  const cls = v >= 0 ? 'positive' : 'negative';
  return `<span class="spread-effect ${cls}">${sign}$${Math.abs(v).toFixed(4)}</span>`;
}

function fmtSpreadPct(v) {
  const sign = v >= 0 ? '+' : '-';
  const cls = v >= 0 ? 'positive' : 'negative';
  return `<span class="spread-effect ${cls}">${sign}${Math.abs(v).toFixed(4)}%</span>`;
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
    const mid = (p1 + p2) / 2;
    const spreadAbs = spreadSwapped ? (p1 - p2) : (p2 - p1);
    const spreadPct = mid > 0 ? (spreadAbs / mid) * 100 : 0;
    aligned.push({ t: c1.t, p1, p2, spreadAbs, spreadPct });
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

  // LONG the asset being added (numerator in spread formula)
  // If not swapped: spread = coin2 − coin1 → LONG coin2, SHORT coin1
  // If swapped:     spread = coin1 − coin2 → LONG coin1, SHORT coin2
  const longCoin = spreadSwapped ? coin1 : coin2;
  const shortCoin = spreadSwapped ? coin2 : coin1;

  const entry = aligned[0];
  const exit = aligned[aligned.length - 1];

  // Best entry = min spread (cheapest), best exit = max spread (most profitable exit)
  let bestEntry = aligned[0];
  let bestExit = aligned[0];
  for (const pt of aligned) {
    if (pt.spreadAbs < bestEntry.spreadAbs) bestEntry = pt;
    if (pt.spreadAbs > bestExit.spreadAbs) bestExit = pt;
  }

  // Extract prices for long/short legs
  function longP(pt) { return spreadSwapped ? pt.p1 : pt.p2; }
  function shortP(pt) { return spreadSwapped ? pt.p2 : pt.p1; }

  // P&L: equal $ notional each side
  // LONG P&L  = posSize × (exit_price / entry_price − 1)
  // SHORT P&L = posSize × (1 − exit_price / entry_price)
  function calcPnl(entryPt, exitPt) {
    const le = longP(entryPt), se = shortP(entryPt);
    const lx = longP(exitPt), sx = shortP(exitPt);
    if (le <= 0 || se <= 0) return { dollar: 0, pct: 0, longPnl: 0, shortPnl: 0 };
    const lPnl = posSize * (lx / le - 1);
    const sPnl = posSize * (1 - sx / se);
    const total = lPnl + sPnl;
    return { dollar: total, pct: (total / posSize) * 100, longPnl: lPnl, shortPnl: sPnl };
  }

  const actualPnl = posSize > 0 ? calcPnl(entry, exit) : null;
  const bestPnl = posSize > 0 ? calcPnl(bestEntry, bestExit) : null;

  const pnlClass = v => v > 0.005 ? 'profit' : v < -0.005 ? 'loss' : 'neutral';

  // Spread effects: how much better/worse was best vs actual
  const entryEffectAbs = bestEntry.spreadAbs - entry.spreadAbs;
  const exitEffectAbs = bestExit.spreadAbs - exit.spreadAbs;
  const entryEffectPct = bestEntry.spreadPct - entry.spreadPct;
  const exitEffectPct = bestExit.spreadPct - exit.spreadPct;

  function cardRow(label, val) {
    return `<div class="pnl-card-row"><span class="label">${label}</span><span class="value">${val}</span></div>`;
  }

  function spreadRows(pt) {
    return cardRow('Spread $', fmtSpread$(pt.spreadAbs)) + cardRow('Spread %', fmtSpreadPct(pt.spreadPct));
  }

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
        ${cardRow(longCoin, fmtPrice(longP(entry)))}
        ${cardRow(shortCoin, fmtPrice(shortP(entry)))}
        ${spreadRows(entry)}
      </div>

      <div class="pnl-card highlight-best-entry">
        <div class="pnl-card-label">Best Entry</div>
        <div class="pnl-card-time">${fmtTime(bestEntry.t)}</div>
        ${cardRow(longCoin, fmtPrice(longP(bestEntry)))}
        ${cardRow(shortCoin, fmtPrice(shortP(bestEntry)))}
        ${spreadRows(bestEntry)}
        ${cardRow('vs Entry $', fmtSpread$(entryEffectAbs))}
        ${cardRow('vs Entry %', fmtSpreadPct(entryEffectPct))}
      </div>

      <div class="pnl-card highlight-best-exit">
        <div class="pnl-card-label">Best Exit</div>
        <div class="pnl-card-time">${fmtTime(bestExit.t)}</div>
        ${cardRow(longCoin, fmtPrice(longP(bestExit)))}
        ${cardRow(shortCoin, fmtPrice(shortP(bestExit)))}
        ${spreadRows(bestExit)}
        ${cardRow('vs Exit $', fmtSpread$(exitEffectAbs))}
        ${cardRow('vs Exit %', fmtSpreadPct(exitEffectPct))}
      </div>

      <div class="pnl-card">
        <div class="pnl-card-label">Exit (Last)</div>
        <div class="pnl-card-time">${fmtTime(exit.t)}</div>
        ${cardRow(longCoin, fmtPrice(longP(exit)))}
        ${cardRow(shortCoin, fmtPrice(shortP(exit)))}
        ${spreadRows(exit)}
      </div>
    </div>

    <div class="pnl-result">
      <div class="pnl-result-item">
        <span class="pnl-result-label">Position P&L (Entry → Exit)</span>
        <span class="pnl-result-value ${actualPnl ? pnlClass(actualPnl.dollar) : 'neutral'}">${actualPnl ? fmtUSD(actualPnl.dollar) : '—'}</span>
      </div>
      <div class="pnl-divider"></div>
      <div class="pnl-result-item">
        <span class="pnl-result-label">Return %</span>
        <span class="pnl-result-value ${actualPnl ? pnlClass(actualPnl.dollar) : 'neutral'}">${actualPnl ? fmtPct(actualPnl.pct) : '—'}</span>
      </div>
      <div class="pnl-divider"></div>
      <div class="pnl-result-item">
        <span class="pnl-result-label">Best P&L (Best Entry → Best Exit)</span>
        <span class="pnl-result-value ${bestPnl ? pnlClass(bestPnl.dollar) : 'neutral'}">${bestPnl ? fmtUSD(bestPnl.dollar) : '—'}</span>
      </div>
      <div class="pnl-divider"></div>
      <div class="pnl-result-item">
        <span class="pnl-result-label">Best Return %</span>
        <span class="pnl-result-value ${bestPnl ? pnlClass(bestPnl.dollar) : 'neutral'}">${bestPnl ? fmtPct(bestPnl.pct) : '—'}</span>
      </div>
    </div>

    <div class="pnl-formula">
      <div class="pnl-formula-title">How P&L is calculated</div>
      <div class="pnl-formula-text">
        Position size = <b>$${posSize > 0 ? posSize.toLocaleString() : '___'}</b> per leg
        (total capital deployed: <b>$${posSize > 0 ? (posSize * 2).toLocaleString() : '___'}</b>)<br>
        <b>LONG</b> ${longCoin} P&L = posSize × (exit_price / entry_price − 1)${actualPnl ? ` = <span class="${pnlClass(actualPnl.longPnl)}">${fmtUSD(actualPnl.longPnl)}</span>` : ''}<br>
        <b>SHORT</b> ${shortCoin} P&L = posSize × (1 − exit_price / entry_price)${actualPnl ? ` = <span class="${pnlClass(actualPnl.shortPnl)}">${fmtUSD(actualPnl.shortPnl)}</span>` : ''}<br>
        <b>Total P&L</b> = LONG P&L + SHORT P&L${actualPnl ? ` = <span class="${pnlClass(actualPnl.dollar)}">${fmtUSD(actualPnl.dollar)}</span>` : ''}<br>
        <b>Return %</b> = Total P&L / posSize × 100${actualPnl ? ` = <span class="${pnlClass(actualPnl.dollar)}">${fmtPct(actualPnl.pct)}</span>` : ''}
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

$spreadUnitBtn.addEventListener('click', () => {
  state.spreadPct = !state.spreadPct;
  $spreadUnitBtn.textContent = state.spreadPct ? '%' : '$';
  $spreadUnitBtn.classList.toggle('active', state.spreadPct);
  if (state.candles1.length) renderSpread();
});

[$asset1, $asset2].forEach(el => {
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') loadData();
  });
});

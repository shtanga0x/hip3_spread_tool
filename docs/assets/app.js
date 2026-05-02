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
  candleMode: false,
  spreadPct: true,
  fundingData1: [],
  fundingData2: [],
  candles1: [],
  candles2: [],
  // Cumulative chart visibility
  cumVis: { funding: true, spread: true, fees: true, total: true },
};

// ── Charts ──
let fundingChart = null;
let fundingSeries1 = null;
let fundingSeries2 = null;
let spreadChart = null;
let spreadLineSeries = null;
let spreadCandleSeries = null;
let cumChart = null;
let cumFundingSeries = null;
let cumSpreadSeries = null;
let cumFeesSeries = null;
let cumTotalSeries = null;

// ── DOM refs ──
const $asset1 = document.getElementById('input-asset1');
const $asset2 = document.getElementById('input-asset2');
const $interval = document.getElementById('select-interval');
const $period = document.getElementById('select-period');
const $load = document.getElementById('btn-load');
const $save = document.getElementById('btn-save');
const $upload = document.getElementById('btn-upload');
const $fileUpload = document.getElementById('file-upload');
const $flipBtn = document.getElementById('btn-flip-direction');
const $swapBtn = document.getElementById('btn-swap-spread');
const $candleLineBtn = document.getElementById('btn-candle-line');
const $spreadUnitBtn = document.getElementById('btn-spread-unit');
const $status = document.getElementById('status');
const $chartsSection = document.getElementById('charts-section');
const $fundingLegend = document.getElementById('funding-legend');
const $spreadLegend = document.getElementById('spread-legend');
const $cumulativeSection = document.getElementById('cumulative-section');
const $cumulativeLegend = document.getElementById('cumulative-legend');

// ── Helpers ──

// Returns the coin identifier as Hyperliquid's API expects it.
// Pre-launch futures keep their xyz: prefix (e.g. "xyz:BRENTOIL").
// Accepts a full trade URL or a bare coin name.
function parseCoin(input) {
  const s = input.trim();
  const m = s.match(/trade\/([^/?#]+)/);
  const raw = m ? m[1] : s;
  try { return decodeURIComponent(raw); } catch { return raw; }
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
  if (!res.ok) {
    let detail = '';
    try {
      const errBody = await res.json();
      if (typeof errBody === 'string') detail = errBody;
      else if (errBody?.error) detail = errBody.error;
      else if (errBody !== null && errBody !== undefined) detail = JSON.stringify(errBody);
    } catch {
      try { detail = (await res.text()).trim(); } catch {}
    }
    const hint = res.status === 500 && !detail ? ' — invalid coin name or unsupported market' : '';
    throw new Error(`API ${res.status}: ${detail || res.statusText}${hint}`);
  }
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
  try {
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
  } catch (e) {
    // Pre-launch / exotic futures may not have funding history — treat as empty
    console.warn(`Funding history unavailable for ${coin}:`, e.message);
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

// Cumulative chart colors
const CUM_FUNDING_COLOR = '#a371f7';   // purple
const CUM_SPREAD_COLOR = '#58a6ff';    // blue
const CUM_FEES_COLOR = '#f85149';      // red
const CUM_TOTAL_COLOR = '#3fb950';     // green

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

function createCumulativeChart() {
  const container = document.getElementById('cumulative-chart');
  container.innerHTML = '';
  cumChart = LightweightCharts.createChart(container, {
    ...CHART_OPTS,
    width: container.clientWidth,
    height: 350,
  });

  const dolFmt = { type: 'custom', formatter: v => {
    const sign = v >= 0 ? '+' : '-';
    const abs = Math.abs(v);
    return sign + '$' + (abs >= 1000 ? abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : abs.toFixed(2));
  }};

  cumFundingSeries = cumChart.addLineSeries({
    color: CUM_FUNDING_COLOR,
    lineWidth: 2,
    priceFormat: dolFmt,
    visible: state.cumVis.funding,
  });

  cumSpreadSeries = cumChart.addLineSeries({
    color: CUM_SPREAD_COLOR,
    lineWidth: 2,
    priceFormat: dolFmt,
    visible: state.cumVis.spread,
  });

  cumFeesSeries = cumChart.addLineSeries({
    color: CUM_FEES_COLOR,
    lineWidth: 2,
    lineStyle: 2, // dashed
    priceFormat: dolFmt,
    visible: state.cumVis.fees,
  });

  cumTotalSeries = cumChart.addLineSeries({
    color: CUM_TOTAL_COLOR,
    lineWidth: 3,
    priceFormat: dolFmt,
    visible: state.cumVis.total,
  });

  new ResizeObserver(entries => {
    const { width } = entries[0].contentRect;
    cumChart.applyOptions({ width });
  }).observe(container);
}

// ── Data processing ──

function buildFundingData(raw) {
  return raw.map(d => ({
    time: tsToUTC(d.time),
    value: parseFloat(d.fundingRate),
  }));
}

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

// ── Cumulative legend with checkboxes ──

function renderCumulativeLegend() {
  const items = [
    { key: 'funding', label: 'Cum. Funding', color: CUM_FUNDING_COLOR },
    { key: 'spread', label: 'Cum. Spread', color: CUM_SPREAD_COLOR },
    { key: 'fees', label: 'Fees', color: CUM_FEES_COLOR },
    { key: 'total', label: 'Total P&L', color: CUM_TOTAL_COLOR },
  ];

  $cumulativeLegend.innerHTML = items.map(it => `
    <label class="cum-legend-item">
      <input type="checkbox" data-key="${it.key}" ${state.cumVis[it.key] ? 'checked' : ''} />
      <span class="legend-dot" style="background:${it.color}"></span>
      ${it.label}
    </label>
  `).join('');

  $cumulativeLegend.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.key;
      state.cumVis[key] = cb.checked;
      if (cumChart) {
        const map = { funding: cumFundingSeries, spread: cumSpreadSeries, fees: cumFeesSeries, total: cumTotalSeries };
        map[key].applyOptions({ visible: cb.checked });
      }
    });
  });
}

// ── Spread chart markers for best entry/exit ──

function setSpreadMarkers(bestEntryT, bestExitT) {
  const markers = [];
  const times = [
    { t: tsToUTC(bestEntryT), type: 'entry' },
    { t: tsToUTC(bestExitT), type: 'exit' },
  ].sort((a, b) => a.t - b.t);

  for (const m of times) {
    if (m.type === 'entry') {
      markers.push({ time: m.t, position: 'belowBar', color: '#3fb950', shape: 'arrowUp', text: 'Best Entry' });
    } else {
      markers.push({ time: m.t, position: 'aboveBar', color: '#f85149', shape: 'arrowDown', text: 'Best Exit' });
    }
  }

  if (state.candleMode) {
    spreadCandleSeries.setMarkers(markers);
    spreadLineSeries.setMarkers([]);
  } else {
    spreadLineSeries.setMarkers(markers);
    spreadCandleSeries.setMarkers([]);
  }
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

  const aligned = getAlignedSpreadData();
  if (aligned.length >= 2) {
    let bestEntry = aligned[0], bestExit = aligned[0];
    for (const pt of aligned) {
      if (pt.spreadAbs < bestEntry.spreadAbs) bestEntry = pt;
      if (pt.spreadAbs > bestExit.spreadAbs) bestExit = pt;
    }
    setSpreadMarkers(bestEntry.t, bestExit.t);
  }

  spreadChart.timeScale().fitContent();
  updateLegends();
}

// ── Sync crosshairs across all charts ──

function syncCrosshair(src, targets, refSeries) {
  src.subscribeCrosshairMove(param => {
    for (const { chart, series } of targets) {
      if (!param || !param.time) {
        chart.clearCrosshairPosition();
      } else {
        chart.setCrosshairPosition(undefined, param.time, series);
      }
    }
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
    createCumulativeChart();

    const fd1 = buildFundingData(funding1);
    const fd2 = buildFundingData(funding2);
    fundingSeries1.setData(fd1);
    fundingSeries2.setData(fd2);
    fundingChart.timeScale().fitContent();

    renderSpread();
    renderCumulativeLegend();

    // Sync crosshairs across all 3 charts
    syncCrosshair(fundingChart, [
      { chart: spreadChart, series: spreadLineSeries },
      { chart: cumChart, series: cumTotalSeries },
    ]);
    syncCrosshair(spreadChart, [
      { chart: fundingChart, series: fundingSeries1 },
      { chart: cumChart, series: cumTotalSeries },
    ]);
    syncCrosshair(cumChart, [
      { chart: fundingChart, series: fundingSeries1 },
      { chart: spreadChart, series: spreadLineSeries },
    ]);

    $chartsSection.style.display = '';
    $pnlSection.style.display = '';
    $cumulativeSection.style.display = '';
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

function computeFundingPnl(posSize, longFundingData, shortFundingData) {
  let longTotal = 0;
  let shortTotal = 0;
  for (const d of longFundingData) {
    longTotal += -posSize * parseFloat(d.fundingRate);
  }
  for (const d of shortFundingData) {
    shortTotal += posSize * parseFloat(d.fundingRate);
  }
  return { total: longTotal + shortTotal, longTotal, shortTotal };
}

function calcSpreadPnl(posSize, longEntry, shortEntry, longExit, shortExit) {
  if (longEntry <= 0 || shortEntry <= 0 || posSize <= 0) return { dollar: 0, pct: 0 };
  const lPnl = posSize * (longExit / longEntry - 1);
  const sPnl = posSize * (1 - shortExit / shortEntry);
  const total = lPnl + sPnl;
  return { dollar: total, pct: (total / posSize) * 100 };
}

function getFeePcts() {
  const makerEl = document.getElementById('input-maker-fee');
  const takerEl = document.getElementById('input-taker-fee');
  const maker = makerEl ? parseFloat(makerEl.value) || 0 : 0.02;
  const taker = takerEl ? parseFloat(takerEl.value) || 0 : 0.07;
  return { maker: maker / 100, taker: taker / 100 };
}

// ── Cumulative P&L chart data ──

function renderCumulativeChart(longCoin, longCoin1) {
  const posSize = parseInt($positionSize.value) || 0;
  if (posSize <= 0 || !cumChart) return;

  const { fundingData1, fundingData2, candles1, candles2 } = state;
  const aligned = getAlignedSpreadData();
  if (aligned.length < 2) return;

  const { maker, taker } = getFeePcts();
  // Entry + exit: 2 legs each = 4 trades. Assume taker for all.
  const totalFeeCost = -(posSize * 2 * taker + posSize * 2 * taker);

  // ── Cumulative funding P&L over time ──
  // Align funding to candle timestamps via nearest-hour lookup
  const longFunding = longCoin1 ? fundingData1 : fundingData2;
  const shortFunding = longCoin1 ? fundingData2 : fundingData1;

  // Build cumulative funding by hour
  const fundingByTime = new Map();
  let cumFund = 0;
  // Merge and sort both funding arrays by time
  const allFunding = [];
  for (const d of longFunding) {
    allFunding.push({ t: d.time, long: parseFloat(d.fundingRate), short: 0 });
  }
  const shortMap = new Map();
  for (const d of shortFunding) {
    shortMap.set(d.time, parseFloat(d.fundingRate));
  }
  for (const f of allFunding) {
    const sr = shortMap.get(f.t) || 0;
    f.short = sr;
  }
  allFunding.sort((a, b) => a.t - b.t);

  const cumFundingData = [];
  cumFund = 0;
  for (const f of allFunding) {
    cumFund += -posSize * f.long + posSize * f.short;
    cumFundingData.push({ time: tsToUTC(f.t), value: cumFund });
  }

  // ── Cumulative spread P&L over time (unrealized, entry at first candle) ──
  const entry = aligned[0];
  function longP(pt) { return longCoin1 ? pt.p1 : pt.p2; }
  function shortP(pt) { return longCoin1 ? pt.p2 : pt.p1; }

  const le = longP(entry), se = shortP(entry);
  const cumSpreadData = aligned.map(pt => {
    const lPnl = posSize * (longP(pt) / le - 1);
    const sPnl = posSize * (1 - shortP(pt) / se);
    return { time: tsToUTC(pt.t), value: lPnl + sPnl };
  });

  // ── Fees: flat line ──
  const cumFeesData = aligned.map(pt => ({ time: tsToUTC(pt.t), value: totalFeeCost }));

  // ── Total P&L: cumulative funding + cumulative spread + fees ──
  // Need to align funding to candle timestamps
  const fundMap = new Map();
  for (const d of cumFundingData) fundMap.set(d.time, d.value);

  // Interpolate: at each candle time, use latest funding value
  let lastFundVal = 0;
  const cumTotalData = aligned.map(pt => {
    const t = tsToUTC(pt.t);
    if (fundMap.has(t)) lastFundVal = fundMap.get(t);
    // Find closest funding <= this time
    for (const fd of cumFundingData) {
      if (fd.time <= t) lastFundVal = fd.value;
    }
    const spreadPnl = cumSpreadData.find(d => d.time === t)?.value || 0;
    return { time: t, value: lastFundVal + spreadPnl + totalFeeCost };
  });

  cumFundingSeries.setData(cumFundingData);
  cumSpreadSeries.setData(cumSpreadData);
  cumFeesSeries.setData(cumFeesData);
  cumTotalSeries.setData(cumTotalData);
  cumChart.timeScale().fitContent();
}

function renderPnL() {
  const aligned = getAlignedSpreadData();
  if (aligned.length < 2) {
    $pnlBody.innerHTML = '<div style="padding:8px;color:#8b949e;font-size:12px;">Not enough data</div>';
    return;
  }

  const posSize = parseInt($positionSize.value) || 0;
  const { coin1, coin2, fundingData1, fundingData2 } = state;

  // coin1 is always LONG, coin2 is always SHORT (user controls via ↕ button)
  const longCoin = coin1;
  const shortCoin = coin2;
  function longP(pt) { return pt.p1; }
  function shortP(pt) { return pt.p2; }
  const funding = posSize > 0
    ? computeFundingPnl(posSize, fundingData1, fundingData2)
    : { total: 0, longTotal: 0, shortTotal: 0 };
  const fundingPct = posSize > 0 ? (funding.total / posSize) * 100 : 0;

  // APR = funding return annualized
  const periodDays = state.period;
  const fundingAPR = periodDays > 0 && posSize > 0 ? (funding.total / posSize) * (365 / periodDays) * 100 : 0;

  // Current Spread P&L
  const current = aligned[aligned.length - 1];
  let sumP1 = 0, sumP2 = 0;
  for (const pt of aligned) { sumP1 += pt.p1; sumP2 += pt.p2; }
  const midP1 = sumP1 / aligned.length;
  const midP2 = sumP2 / aligned.length;

  const midLongEntry = longCoin === coin1 ? midP1 : midP2;
  const midShortEntry = longCoin === coin1 ? midP2 : midP1;
  const currentLongExit = longP(current);
  const currentShortExit = shortP(current);

  const currentSpreadPnl = posSize > 0 ? calcSpreadPnl(posSize, midLongEntry, midShortEntry, currentLongExit, currentShortExit) : { dollar: 0, pct: 0 };

  const entrySpread = (longCoin === coin1) ? (midP1 - midP2) : (midP2 - midP1);
  const exitSpread = longP(current) - shortP(current);

  // Best Entry → Best Exit
  let bestEntry = aligned[0], bestExit = aligned[0];
  for (const pt of aligned) {
    if ((longP(pt) - shortP(pt)) < (longP(bestEntry) - shortP(bestEntry))) bestEntry = pt;
    if ((longP(pt) - shortP(pt)) > (longP(bestExit) - shortP(bestExit))) bestExit = pt;
  }

  const bestSpreadPnl = posSize > 0
    ? calcSpreadPnl(posSize, longP(bestEntry), shortP(bestEntry), longP(bestExit), shortP(bestExit))
    : { dollar: 0, pct: 0 };

  const bestEntrySpread = longP(bestEntry) - shortP(bestEntry);
  const bestExitSpread = longP(bestExit) - shortP(bestExit);

  if (spreadChart) setSpreadMarkers(bestEntry.t, bestExit.t);

  // Fees
  const { maker, taker } = getFeePcts();
  // Entry: 2 legs (LONG + SHORT), Exit: 2 legs
  const entryFee = posSize * 2 * taker;
  const exitFee = posSize * 2 * taker;
  const totalFees = entryFee + exitFee;

  const cls = v => v > 0.005 ? 'profit' : v < -0.005 ? 'loss' : 'neutral';
  const aprCls = cls(fundingAPR);

  function cardRow(label, val) {
    return `<div class="pnl-card-row"><span class="label">${label}</span><span class="value">${val}</span></div>`;
  }

  const fundingHours = fundingData1.length;

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

    <div class="pnl-grid-4">
      <!-- Box 1: Funding P&L -->
      <div class="pnl-card">
        <div class="pnl-card-label">Funding P&L</div>
        <div class="pnl-card-sublabel">${fundingHours} hourly snapshots · ${periodDays}d</div>
        <div class="pnl-big-value ${cls(funding.total)}">
          ${posSize > 0 ? fmtUSD(funding.total) : '—'}
        </div>
        <div class="pnl-big-pct ${cls(funding.total)}">
          ${posSize > 0 ? fmtPct(fundingPct) : ''}
        </div>
        <div class="pnl-apr">
          <div class="pnl-apr-label">Funding APR</div>
          <div class="pnl-apr-value ${aprCls}">${posSize > 0 ? fmtPct(fundingAPR) : '—'}</div>
        </div>
        ${cardRow('LONG ' + longCoin, posSize > 0 ? fmtUSD(funding.longTotal) : '—')}
        ${cardRow('SHORT ' + shortCoin, posSize > 0 ? fmtUSD(funding.shortTotal) : '—')}
        <div class="pnl-card-note">
          LONG pays funding (−rate)<br>
          SHORT receives funding (+rate)
        </div>
      </div>

      <!-- Box 2: Current Spread P&L -->
      <div class="pnl-card">
        <div class="pnl-card-label">Current Spread P&L</div>
        <div class="pnl-card-sublabel">Entry @ period avg → Exit @ current</div>
        <div class="pnl-big-value ${cls(currentSpreadPnl.dollar)}">
          ${posSize > 0 ? fmtUSD(currentSpreadPnl.dollar) : '—'}
        </div>
        <div class="pnl-big-pct ${cls(currentSpreadPnl.dollar)}">
          ${posSize > 0 ? fmtPct(currentSpreadPnl.pct) : ''}
        </div>
        ${cardRow('Entry ' + longCoin, fmtPrice(midLongEntry) + ' (avg)')}
        ${cardRow('Entry ' + shortCoin, fmtPrice(midShortEntry) + ' (avg)')}
        ${cardRow('Entry spread', fmtSpread$(entrySpread))}
        <div class="pnl-card-separator"></div>
        ${cardRow('Exit ' + longCoin, fmtPrice(currentLongExit))}
        ${cardRow('Exit ' + shortCoin, fmtPrice(currentShortExit))}
        ${cardRow('Exit spread', fmtSpread$(exitSpread))}
        <div class="pnl-card-separator"></div>
        ${cardRow('Spread change', fmtSpread$(exitSpread - entrySpread))}
      </div>

      <!-- Box 3: Best Entry → Best Exit P&L -->
      <div class="pnl-card">
        <div class="pnl-card-label">Best Spread P&L</div>
        <div class="pnl-card-sublabel">Best entry → Best exit</div>
        <div class="pnl-big-value ${cls(bestSpreadPnl.dollar)}">
          ${posSize > 0 ? fmtUSD(bestSpreadPnl.dollar) : '—'}
        </div>
        <div class="pnl-big-pct ${cls(bestSpreadPnl.dollar)}">
          ${posSize > 0 ? fmtPct(bestSpreadPnl.pct) : ''}
        </div>
        <div class="pnl-best-marker entry-marker">
          <span class="marker-arrow">&#9650;</span> Best Entry — ${fmtTime(bestEntry.t)}
        </div>
        ${cardRow(longCoin, fmtPrice(longP(bestEntry)))}
        ${cardRow(shortCoin, fmtPrice(shortP(bestEntry)))}
        ${cardRow('Spread', fmtSpread$(bestEntrySpread))}
        <div class="pnl-card-separator"></div>
        <div class="pnl-best-marker exit-marker">
          <span class="marker-arrow">&#9660;</span> Best Exit — ${fmtTime(bestExit.t)}
        </div>
        ${cardRow(longCoin, fmtPrice(longP(bestExit)))}
        ${cardRow(shortCoin, fmtPrice(shortP(bestExit)))}
        ${cardRow('Spread', fmtSpread$(bestExitSpread))}
        <div class="pnl-card-separator"></div>
        ${cardRow('Spread change', fmtSpread$(bestExitSpread - bestEntrySpread))}
      </div>

      <!-- Box 4: Trading Fees -->
      <div class="pnl-card">
        <div class="pnl-card-label">Trading Fees</div>
        <div class="pnl-card-sublabel">Entry + Exit commissions</div>
        <div class="pnl-big-value loss">
          ${posSize > 0 ? '-$' + totalFees.toFixed(2) : '—'}
        </div>
        <div class="pnl-big-pct loss">
          ${posSize > 0 ? '-' + ((totalFees / posSize) * 100).toFixed(4) + '%' : ''}
        </div>
        <div class="fee-inputs">
          <div class="fee-input-row">
            <span class="fee-label">Maker fee</span>
            <div class="fee-field">
              <input type="text" id="input-maker-fee" value="0.02" class="fee-input" />
              <span class="fee-unit">%</span>
            </div>
          </div>
          <div class="fee-input-row">
            <span class="fee-label">Taker fee</span>
            <div class="fee-field">
              <input type="text" id="input-taker-fee" value="0.07" class="fee-input" />
              <span class="fee-unit">%</span>
            </div>
          </div>
        </div>
        <div class="pnl-card-separator"></div>
        ${cardRow('Entry (2 legs)', posSize > 0 ? '-$' + entryFee.toFixed(2) : '—')}
        ${cardRow('Exit (2 legs)', posSize > 0 ? '-$' + exitFee.toFixed(2) : '—')}
        <div class="pnl-card-note">
          HIP-3 fees are 2× standard.<br>
          Using taker rate for all trades.
        </div>
      </div>
    </div>
  `;

  // Attach fee input listeners (re-created each render)
  const makerEl = document.getElementById('input-maker-fee');
  const takerEl = document.getElementById('input-taker-fee');
  if (makerEl) makerEl.addEventListener('input', () => renderPnL());
  if (takerEl) takerEl.addEventListener('input', () => renderPnL());

  // Render cumulative chart
  renderCumulativeChart(longCoin, true);
}

// ── Event listeners ──

$load.addEventListener('click', loadData);

$flipBtn.addEventListener('click', () => {
  // Swap the input field values
  const tmp = $asset1.value;
  $asset1.value = $asset2.value;
  $asset2.value = tmp;

  // If data is already loaded, swap state in-place and re-render without a reload
  if (state.candles1.length || state.candles2.length) {
    [state.coin1, state.coin2] = [state.coin2, state.coin1];
    [state.candles1, state.candles2] = [state.candles2, state.candles1];
    [state.fundingData1, state.fundingData2] = [state.fundingData2, state.fundingData1];
    state.spreadSwapped = false;
    $swapBtn.textContent = 'Swap A↔B';
    renderSpread();
    renderPnL();
  }
});

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

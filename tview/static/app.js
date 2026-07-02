const REFRESH_MS = 60_000;
const INTERVALS = ["1d", "1wk", "1mo"];

const SEC_DAY = 86400;
const DEFAULT_RANGES = {
  "1d": 30 * SEC_DAY,
  "1wk": 365 * SEC_DAY,
  "1mo": 10 * 365 * SEC_DAY,
};

const TV = {
  bg: "#000000",
  text: "#d1d4dc",
  grid: "#1c1f2b",
  border: "#2a2e39",
  up: "#089981",
  down: "#F23645",
  ema10: "#089981",
  sma100: "#2962FF",
  sma200: "#F23645",
};

const charts = {};
const series = {};
let currentSymbol = null;
let stocks = [];

function fmtMoney(value) {
  if (value == null) return "—";
  return `$${value.toFixed(2)}`;
}

function fmtPct(value) {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function pctClass(value) {
  if (value == null) return "neutral";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function rollingEma(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let ema = null;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;

    if (ema == null) {
      if (i < period - 1) continue;
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j];
      ema = sum / period;
      out[i] = ema;
      continue;
    }

    ema = v * k + ema * (1 - k);
    out[i] = ema;
  }

  return out;
}

function createChart(containerId) {
  const container = document.getElementById(containerId);
  const chart = LightweightCharts.createChart(container, {
    layout: {
      background: { color: TV.bg },
      textColor: TV.text,
      fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    },
    grid: {
      vertLines: { color: TV.grid },
      horzLines: { color: TV.grid },
    },
    rightPriceScale: {
      borderColor: TV.border,
      scaleMargins: { top: 0.05, bottom: 0.22 },
    },
    timeScale: {
      borderColor: TV.border,
      timeVisible: true,
      secondsVisible: false,
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });

  const volume = chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "volume",
  });

  chart.priceScale("volume").applyOptions({
    scaleMargins: { top: 0.82, bottom: 0 },
    borderVisible: false,
  });

  const candles = chart.addCandlestickSeries({
    upColor: TV.up,
    downColor: TV.down,
    borderUpColor: TV.up,
    borderDownColor: TV.down,
    wickUpColor: TV.up,
    wickDownColor: TV.down,
  });

  // No in-chart title/last-value tags — the shared legend bar covers naming.
  const ema10 = chart.addLineSeries({
    color: TV.ema10,
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  const sma100 = chart.addLineSeries({
    color: TV.sma100,
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  const sma200 = chart.addLineSeries({
    color: TV.sma200,
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  const resizeObserver = new ResizeObserver(() => {
    chart.applyOptions({
      width: container.clientWidth,
      height: container.clientHeight,
    });
  });
  resizeObserver.observe(container);

  return { chart, candles, volume, ema10, sma100, sma200 };
}

function initCharts() {
  INTERVALS.forEach((key) => {
    charts[key] = createChart(`chart-${key}`);
    series[key] = charts[key];
  });
}

function applyDefaultVisibleRange(key, rows) {
  if (!rows.length) return;

  const lastTime = rows[rows.length - 1].time;
  const firstTime = rows[0].time;
  let from = lastTime - DEFAULT_RANGES[key];
  if (from < firstTime) from = firstTime;

  charts[key].chart.timeScale().setVisibleRange({ from, to: lastTime });
}

function updateChart(key, rows) {
  const { candles, volume, ema10, sma100, sma200 } = series[key];
  const closes = rows.map((r) => r.close);
  const emaValues = rollingEma(closes, 10);

  candles.setData(
    rows.map((r) => ({
      time: r.time,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
    }))
  );

  volume.setData(
    rows.map((r) => ({
      time: r.time,
      value: r.volume ?? 0,
      color: r.close >= r.open ? "rgba(8, 153, 129, 0.55)" : "rgba(242, 54, 69, 0.55)",
    }))
  );

  ema10.setData(
    rows
      .map((r, i) => (emaValues[i] != null ? { time: r.time, value: emaValues[i] } : null))
      .filter(Boolean)
  );

  sma100.setData(
    rows.filter((r) => r.sma100 != null).map((r) => ({ time: r.time, value: r.sma100 }))
  );

  sma200.setData(
    rows.filter((r) => r.sma200 != null).map((r) => ({ time: r.time, value: r.sma200 }))
  );

  applyDefaultVisibleRange(key, rows);
}

function updateTable(comparison) {
  const tbody = document.getElementById("comparison-body");
  const order = ["1d", "1wk", "1mo"];

  tbody.innerHTML = order
    .map((key) => {
      const row = comparison[key];
      return `
        <tr>
          <td>${row.label}</td>
          <td>${fmtMoney(row.price)}</td>
          <td>${fmtMoney(row.sma100)}</td>
          <td class="${pctClass(row.vs_sma100_pct)}">${fmtPct(row.vs_sma100_pct)}</td>
          <td>${fmtMoney(row.sma200)}</td>
          <td class="${pctClass(row.vs_sma200_pct)}">${fmtPct(row.vs_sma200_pct)}</td>
        </tr>
      `;
    })
    .join("");
}

function setStatus(text, kind = "live") {
  const badge = document.getElementById("refresh-status");
  badge.textContent = text;
  badge.className = `badge ${kind}`;
}

function renderStockPicker() {
  const nav = document.getElementById("stock-picker");
  nav.innerHTML = stocks
    .map(
      (stock) => `
        <button
          type="button"
          class="stock-btn${stock.pinned ? " pinned" : ""}${stock.symbol === currentSymbol ? " active" : ""}"
          data-symbol="${stock.symbol}"
          title="${stock.name}${stock.pinned ? " (pinned)" : ""}"
        >
          ${stock.pinned ? "★ " : ""}${stock.symbol}
        </button>
      `
    )
    .join("");

  nav.querySelectorAll(".stock-btn").forEach((btn) => {
    btn.addEventListener("click", () => selectStock(btn.dataset.symbol));
  });
}

function updatePickerActive() {
  document.querySelectorAll(".stock-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.symbol === currentSymbol);
  });
}

async function loadStocks() {
  const res = await fetch("/api/stocks");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = await res.json();
  stocks = payload.stocks;
  currentSymbol = new URLSearchParams(window.location.search).get("symbol") || payload.default;
  renderStockPicker();
}

async function selectStock(symbol) {
  if (symbol === currentSymbol) return;
  currentSymbol = symbol;

  const url = new URL(window.location.href);
  url.searchParams.set("symbol", symbol);
  history.replaceState(null, "", url);

  updatePickerActive();
  setStatus("Loading…");
  await refresh();
}

async function refresh(attempt = 0) {
  try {
    const res = await fetch(`/api/stock?symbol=${encodeURIComponent(currentSymbol)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();

    document.getElementById("title").textContent =
      `${payload.symbol} · ${payload.name}`;
    document.getElementById("last-updated").textContent =
      `Updated ${new Date(payload.updated_at).toLocaleString()}`;

    INTERVALS.forEach((key) => updateChart(key, payload.charts[key].data));
    updateTable(payload.comparison);
    setStatus("Live", "live");
  } catch (err) {
    console.error(err);
    // A cold host (e.g. Render free tier waking up) can fail the first calls.
    // Retry with backoff so the charts fill in instead of staying blank.
    if (attempt < 5) {
      setStatus("Waking up…");
      setTimeout(() => refresh(attempt + 1), Math.min(1500 * 2 ** attempt, 15000));
    } else {
      setStatus("Error — retrying", "error");
      setTimeout(() => refresh(0), 20000);
    }
  }
}

async function boot() {
  initCharts();
  await loadStocks();
  await refresh();
  setInterval(() => refresh(), REFRESH_MS);
}

boot();

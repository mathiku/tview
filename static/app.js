const REFRESH_MS = 60_000;
const INTERVALS = ["1d", "1wk", "1mo"];

const SEC_DAY = 86400;
const DEFAULT_RANGES = {
  "1d": 30 * SEC_DAY,
  "1wk": 365 * SEC_DAY,
  "1mo": 10 * 365 * SEC_DAY,
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

function createChart(containerId) {
  const container = document.getElementById(containerId);
  const chart = LightweightCharts.createChart(container, {
    layout: {
      background: { color: "#171a22" },
      textColor: "#9aa0a6",
    },
    grid: {
      vertLines: { color: "#222733" },
      horzLines: { color: "#222733" },
    },
    rightPriceScale: { borderColor: "#2a2f3a" },
    timeScale: { borderColor: "#2a2f3a" },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });

  const price = chart.addLineSeries({
    color: "#ffffff",
    lineWidth: 2,
    title: "Price",
  });

  const sma100 = chart.addLineSeries({
    color: "#4da3ff",
    lineWidth: 2,
    title: "SMA 100",
  });

  const sma200 = chart.addLineSeries({
    color: "#ff5c5c",
    lineWidth: 2,
    title: "SMA 200",
  });

  const resizeObserver = new ResizeObserver(() => {
    chart.applyOptions({
      width: container.clientWidth,
      height: container.clientHeight,
    });
  });
  resizeObserver.observe(container);

  return { chart, price, sma100, sma200 };
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
  const { price, sma100, sma200 } = series[key];

  price.setData(rows.map((r) => ({ time: r.time, value: r.close })));
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
          class="stock-btn${stock.symbol === currentSymbol ? " active" : ""}"
          data-symbol="${stock.symbol}"
          title="${stock.name}"
        >
          ${stock.symbol}
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

async function refresh() {
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
    setStatus("Error", "error");
  }
}

async function boot() {
  initCharts();
  await loadStocks();
  await refresh();
  setInterval(refresh, REFRESH_MS);
}

boot();

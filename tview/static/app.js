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
let currentName = "";
let stocks = [];
let baseStocks = [];

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

  // Overlay for the double-bottom bounding box — a positioned DOM element the
  // lightweight-charts canvas can't draw natively (v4 has no rectangle shape).
  container.style.position = "relative";
  const box = document.createElement("div");
  box.className = "signal-box";
  box.style.display = "none";
  container.appendChild(box);

  const s = { chart, candles, volume, ema10, sma100, sma200, container, box };
  s.priceLines = [];
  s.boxData = null;

  // Re-place the box in pixel space whenever the visible range or size changes.
  s.reposition = () => {
    const d = s.boxData;
    if (!d) {
      box.style.display = "none";
      return;
    }
    const ts = chart.timeScale();
    const x1 = ts.timeToCoordinate(d.low1Time);
    const x2 = ts.timeToCoordinate(d.low2Time);
    const yTop = candles.priceToCoordinate(d.top);
    const yBottom = candles.priceToCoordinate(d.bottom);
    if (x1 == null || x2 == null || yTop == null || yBottom == null) {
      box.style.display = "none";
      return;
    }
    const left = Math.min(x1, x2);
    const top = Math.min(yTop, yBottom);
    box.style.display = "block";
    box.style.left = `${left}px`;
    box.style.width = `${Math.max(Math.abs(x2 - x1), 2)}px`;
    box.style.top = `${top}px`;
    box.style.height = `${Math.max(Math.abs(yBottom - yTop), 2)}px`;
  };
  chart.timeScale().subscribeVisibleLogicalRangeChange(s.reposition);

  const resizeObserver = new ResizeObserver(() => {
    chart.applyOptions({
      width: container.clientWidth,
      height: container.clientHeight,
    });
    s.reposition();
  });
  resizeObserver.observe(container);

  return s;
}

function initCharts() {
  INTERVALS.forEach((key) => {
    charts[key] = createChart(`chart-${key}`);
    series[key] = charts[key];
  });
}

function applyDefaultVisibleRange(key, rows, signal) {
  if (!rows.length) return;

  const lastTime = rows[rows.length - 1].time;
  const firstTime = rows[0].time;
  let from = lastTime - DEFAULT_RANGES[key];

  // Pull the daily view back far enough to frame a double bottom that formed
  // before the default window — otherwise its box would sit off-screen.
  const db = key === "1d" ? signal?.doubleBottom : null;
  if (db?.match) from = Math.min(from, db.low1Time - 12 * SEC_DAY);

  if (from < firstTime) from = firstTime;

  charts[key].chart.timeScale().setVisibleRange({ from, to: lastTime });
}

const HAMMER_HL = "#fbbf24";
const DB_HL = "#22d3ee";

// Draw the daily-bar signals (hammer, double bottom, trade levels) onto a chart.
function annotateSignals(key, rows, signal) {
  const s = series[key];
  s.priceLines.forEach((pl) => s.candles.removePriceLine(pl));
  s.priceLines = [];

  if (key !== "1d") {
    s.boxData = null;
    s.candles.setMarkers([]);
    s.reposition();
    return;
  }

  const db = signal?.doubleBottom;
  const lv = signal?.levels;
  const markers = [];

  if (signal?.patterns?.hammer && rows.length) {
    markers.push({
      time: rows[rows.length - 1].time,
      position: "belowBar",
      color: HAMMER_HL,
      shape: "arrowUp",
      text: "Hammer",
    });
  }

  if (db?.match) {
    markers.push({ time: db.low1Time, position: "belowBar", color: DB_HL, shape: "circle", text: "1" });
    markers.push({ time: db.low2Time, position: "belowBar", color: DB_HL, shape: "circle", text: "2" });
    s.priceLines.push(
      s.candles.createPriceLine({
        price: db.neckline,
        color: DB_HL,
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: "neckline",
      })
    );
    s.boxData = { low1Time: db.low1Time, low2Time: db.low2Time, top: db.neckline, bottom: db.lowPrice };
  } else {
    s.boxData = null;
  }

  if (lv) {
    s.priceLines.push(
      s.candles.createPriceLine({
        price: lv.stop,
        color: TV.down,
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dotted,
        axisLabelVisible: true,
        title: "stop",
      })
    );
    s.priceLines.push(
      s.candles.createPriceLine({
        price: lv.target,
        color: TV.up,
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dotted,
        axisLabelVisible: true,
        title: "target",
      })
    );
  }

  markers.sort((a, b) => a.time - b.time);
  s.candles.setMarkers(markers);
  s.reposition();
}

function updateChart(key, rows, signal) {
  const { candles, volume, ema10, sma100, sma200 } = series[key];
  const closes = rows.map((r) => r.close);
  const emaValues = rollingEma(closes, 10);

  // Highlight the hammer candle (latest daily bar) with an amber outline.
  const hammerTime =
    key === "1d" && signal?.patterns?.hammer && rows.length ? rows[rows.length - 1].time : null;

  candles.setData(
    rows.map((r) => {
      const bar = {
        time: r.time,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
      };
      if (r.time === hammerTime) {
        bar.color = r.close >= r.open ? TV.up : TV.down;
        bar.borderColor = HAMMER_HL;
        bar.wickColor = HAMMER_HL;
      }
      return bar;
    })
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

  applyDefaultVisibleRange(key, rows, signal);
  annotateSignals(key, rows, signal);
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

function mergedPicker() {
  const wl = Store.getWatchlist() || [];
  const wlSyms = new Set(wl.map((s) => s.symbol));
  const pinned = wl.map((s) => ({ symbol: s.symbol, name: s.name, pinned: true }));
  const rest = baseStocks
    .filter((s) => !wlSyms.has(s.symbol))
    .map((s) => ({ ...s, pinned: false }));
  return [...pinned, ...rest];
}

function rebuildPicker() {
  stocks = mergedPicker();
  renderStockPicker();
  updatePickerActive();
}

async function seedWatchlist() {
  if (Store.getWatchlist() != null) return;
  try {
    const res = await fetch("/api/pinned");
    const p = await res.json();
    Store.setWatchlist(p.stocks ?? []);
  } catch {
    Store.setWatchlist([]);
  }
}

async function loadStocks() {
  const res = await fetch("/api/stocks");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = await res.json();
  baseStocks = payload.stocks;
  await seedWatchlist();
  stocks = mergedPicker();
  currentSymbol = new URLSearchParams(window.location.search).get("symbol") || payload.default;
  renderStockPicker();
}

function setupItem(label, value, cls = "") {
  return `<div class="setup-item"><span class="setup-label">${label}</span><span class="setup-value ${cls}">${value}</span></div>`;
}

function renderSetup(signal) {
  const box = document.getElementById("setup-box");
  if (!box) return;
  const lv = signal?.levels;
  const db = signal?.doubleBottom;
  const parts = [];
  if (lv) {
    parts.push(setupItem("Entry", `$${lv.entry.toFixed(2)}`));
    parts.push(setupItem("Stop", `$${lv.stop.toFixed(2)} (−${lv.riskPct}%)`, "stop"));
    parts.push(setupItem("Target", `$${lv.target.toFixed(2)} (+${lv.rewardPct}%)`, "target"));
    parts.push(setupItem("Risk : reward", `1 : ${lv.rr}`));
  }
  const dbText = db?.match
    ? db.breakout
      ? `Broke out · neckline $${db.neckline}`
      : `Emerging · neckline $${db.neckline}`
    : "None";
  parts.push(setupItem("Double bottom", dbText, db?.match ? "target" : ""));
  box.innerHTML = parts.join("");
}

function updatePinButton() {
  const btn = document.getElementById("pin-btn");
  if (!btn) return;
  const on = Store.has(currentSymbol);
  btn.classList.toggle("on", on);
  btn.textContent = on ? "★ On watchlist" : "☆ Add to watchlist";
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

    currentName = payload.name;
    document.getElementById("title").textContent =
      `${payload.symbol} · ${payload.name}`;
    document.getElementById("last-updated").textContent =
      `Updated ${new Date(payload.updated_at).toLocaleString()}`;

    INTERVALS.forEach((key) => updateChart(key, payload.charts[key].data, payload.signal));
    updateTable(payload.comparison);
    renderSetup(payload.signal);
    updatePinButton();
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
  document.getElementById("pin-btn").addEventListener("click", () => {
    Store.toggle(currentSymbol, currentName);
    updatePinButton();
    rebuildPicker();
  });
  await loadStocks();
  await refresh();
  setInterval(() => refresh(), REFRESH_MS);
}

boot();

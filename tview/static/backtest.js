const TV = {
  bg: "#000000",
  text: "#d1d4dc",
  grid: "#1c1f2b",
  border: "#2a2e39",
  up: "#089981",
  down: "#F23645",
  sma100: "#2962FF",
  sma200: "#F23645",
  equity: "#22d3ee",
};

let equityChart, equitySeries;
let priceChart, priceCandles, priceSma100, priceSma200;

function el(id) {
  return document.getElementById(id);
}

function setStatus(text, kind = "live") {
  const badge = el("run-status");
  badge.textContent = text;
  badge.className = `badge ${kind}`;
}

function fmtMoney(v) {
  if (v == null || Number.isNaN(v)) return "—";
  return `$${Math.round(v).toLocaleString()}`;
}

function fmtPrice(v) {
  return v == null ? "—" : `$${v.toFixed(2)}`;
}

function fmtPct(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

function pctClass(v) {
  if (v == null) return "neutral";
  return v > 0 ? "positive" : v < 0 ? "negative" : "neutral";
}

function humanize(reason) {
  if (!reason) return "—";
  return reason.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function makeChart(containerId, extra = {}) {
  const container = el(containerId);
  const chart = LightweightCharts.createChart(container, {
    layout: { background: { color: TV.bg }, textColor: TV.text, fontFamily: "Inter, system-ui, sans-serif" },
    grid: { vertLines: { color: TV.grid }, horzLines: { color: TV.grid } },
    rightPriceScale: { borderColor: TV.border },
    timeScale: { borderColor: TV.border, timeVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    ...extra,
  });
  new ResizeObserver(() => {
    chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  }).observe(container);
  return chart;
}

function ensureCharts() {
  if (equityChart) return;
  equityChart = makeChart("chart-equity");
  equitySeries = equityChart.addAreaSeries({
    lineColor: TV.equity,
    topColor: "rgba(34, 211, 238, 0.25)",
    bottomColor: "rgba(34, 211, 238, 0.02)",
    lineWidth: 2,
    priceLineVisible: false,
  });

  priceChart = makeChart("chart-price");
  priceCandles = priceChart.addCandlestickSeries({
    upColor: TV.up,
    downColor: TV.down,
    borderUpColor: TV.up,
    borderDownColor: TV.down,
    wickUpColor: TV.up,
    wickDownColor: TV.down,
  });
  priceSma100 = priceChart.addLineSeries({ color: TV.sma100, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  priceSma200 = priceChart.addLineSeries({ color: TV.sma200, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
}

function tradeMarkers(trades) {
  // Arrows only — dense backtests would otherwise drown in overlapping text
  // labels; the trades table below is the full per-trade record. Entry arrows
  // point into the trade direction; exit arrows are coloured by win/loss.
  const markers = [];
  for (const t of trades) {
    const winColor = t.pnlUsd >= 0 ? TV.up : TV.down;
    if (t.side === "long") {
      markers.push({ time: t.entryDate, position: "belowBar", color: TV.up, shape: "arrowUp" });
      markers.push({ time: t.exitDate, position: "aboveBar", color: winColor, shape: "arrowDown" });
    } else {
      markers.push({ time: t.entryDate, position: "aboveBar", color: TV.down, shape: "arrowDown" });
      markers.push({ time: t.exitDate, position: "belowBar", color: winColor, shape: "arrowUp" });
    }
  }
  // Series markers must be sorted ascending by time (ISO strings sort correctly).
  markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return markers;
}

function tile(label, value, cls = "") {
  return `<div class="bt-tile"><span class="bt-tile-val ${cls}">${value}</span><span class="bt-tile-label">${label}</span></div>`;
}

function renderTiles(m) {
  const pf = m.profitFactor === Infinity || m.profitFactor == null ? "∞" : m.profitFactor.toFixed(2);
  el("bt-tiles").innerHTML = [
    tile("Total return", fmtPct(m.totalReturnPct), pctClass(m.totalReturnPct)),
    tile("Final equity", fmtMoney(m.finalEquity)),
    tile("CAGR", fmtPct(m.cagrPct), pctClass(m.cagrPct)),
    tile("Win rate", m.totalTrades ? `${m.winRate.toFixed(0)}%` : "—"),
    tile("Trades", String(m.totalTrades)),
    tile("Max drawdown", m.maxDrawdownPct ? `-${m.maxDrawdownPct.toFixed(1)}%` : "0%", m.maxDrawdownPct ? "negative" : "neutral"),
    tile("Profit factor", pf),
    tile("Avg hold", m.totalTrades ? `${Math.round(m.avgHoldDays)}d` : "—"),
  ].join("");
}

function renderTrades(trades) {
  el("bt-trade-count").textContent = trades.length ? `${trades.length} total` : "";
  if (!trades.length) {
    el("bt-trades-body").innerHTML = `<tr><td colspan="11" class="bt-notrades">No trades — the strategy never triggered in this window.</td></tr>`;
    return;
  }
  el("bt-trades-body").innerHTML = trades
    .map((t, i) => {
      const sideCls = t.side === "long" ? "bt-long" : "bt-short";
      return `<tr>
        <td>${i + 1}</td>
        <td><span class="bt-side ${sideCls}">${t.side}</span></td>
        <td>${t.entryDate}</td>
        <td>${t.exitDate}</td>
        <td>${fmtPrice(t.entryPrice)}</td>
        <td>${fmtPrice(t.exitPrice)}</td>
        <td>${t.holdDays}</td>
        <td class="${pctClass(t.pnlPct)}">${fmtPct(t.pnlPct, 1)}</td>
        <td class="${pctClass(t.pnlUsd)}">${t.pnlUsd >= 0 ? "+" : "−"}${fmtMoney(Math.abs(t.pnlUsd)).slice(1)}</td>
        <td>${humanize(t.exitReason)}</td>
        <td class="bt-signal">${t.signalLabel ?? "—"}</td>
      </tr>`;
    })
    .join("");
}

function resultSub(data) {
  const range = `${data.startDate} → ${data.endDate}`;
  if (data.mode === "custom") {
    return `${range} · entry: ${data.config.entry} · exit: ${data.config.exit}`;
  }
  return `${range} · stop ${data.config.stopLossPct}% · target ${data.config.takeProfitPct}% · max hold ${data.config.maxHoldDays}d`;
}

function renderResult(data) {
  el("bt-empty").hidden = true;
  el("bt-results").hidden = false;
  const modeTag = data.mode === "custom" ? " · custom rules" : "";
  el("bt-result-title").textContent =
    `${data.symbol} · ${data.direction === "both" ? "long + short" : data.direction}${modeTag}`;
  el("bt-result-sub").textContent = resultSub(data);

  renderTiles(data.metrics);
  renderTrades(data.trades);

  ensureCharts();
  // Two frames so the freshly-unhidden containers have a real size first.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      equitySeries.setData(data.equityCurve.map((p) => ({ time: p.date, value: p.equity })));
      equityChart.timeScale().fitContent();

      priceCandles.setData(
        data.candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }))
      );
      priceSma100.setData(data.candles.filter((c) => c.sma100 != null).map((c) => ({ time: c.time, value: c.sma100 })));
      priceSma200.setData(data.candles.filter((c) => c.sma200 != null).map((c) => ({ time: c.time, value: c.sma200 })));
      priceCandles.setMarkers(tradeMarkers(data.trades));
      priceChart.timeScale().fitContent();
    })
  );
}

let mode = "builtin";

function buildQuery() {
  const q = new URLSearchParams();
  q.set("symbol", el("bt-symbol").value.trim());
  q.set("start", el("bt-start").value);
  q.set("end", el("bt-end").value);
  q.set("direction", el("bt-direction").value);
  q.set("capital", el("bt-capital").value || "100000");
  q.set("size", el("bt-size").value || "100");

  if (mode === "custom") {
    q.set("mode", "custom");
    q.set("entry", el("bt-entry").value.trim());
    q.set("exit", el("bt-exit").value.trim());
    // Safety exits are optional — only send when the user set them.
    if (el("bt-c-stop").value) q.set("stop", el("bt-c-stop").value);
    if (el("bt-c-target").value) q.set("target", el("bt-c-target").value);
    if (el("bt-c-hold").value) q.set("hold", el("bt-c-hold").value);
    return q;
  }

  q.set("stop", el("bt-stop").value || "6");
  q.set("target", el("bt-target").value || "12");
  q.set("hold", el("bt-hold").value || "20");
  q.set("sma200", el("bt-sma200").checked ? "true" : "false");
  q.set("requirePattern", el("bt-pattern").checked ? "true" : "false");
  if (el("bt-rsi").value) q.set("rsiMax", el("bt-rsi").value);
  if (el("bt-adx").value) q.set("adxMin", el("bt-adx").value);
  return q;
}

function setMode(next) {
  mode = next;
  document.querySelectorAll(".bt-mode-tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === next));
  el("bt-builtin-section").hidden = next !== "builtin";
  el("bt-custom-section").hidden = next !== "custom";
  // "Both sides" only applies to the built-in strategy.
  const both = el("bt-direction").querySelector('option[value="both"]');
  if (both) {
    both.disabled = next === "custom";
    if (next === "custom" && el("bt-direction").value === "both") el("bt-direction").value = "long";
  }
}

async function runBacktest(e) {
  e.preventDefault();
  const symbol = el("bt-symbol").value.trim();
  if (!symbol) {
    setStatus("Enter a stock", "error");
    return;
  }
  if (mode === "custom" && (!el("bt-entry").value.trim() || !el("bt-exit").value.trim())) {
    setStatus("Enter both an entry and an exit rule", "error");
    return;
  }
  const btn = el("bt-run");
  btn.disabled = true;
  setStatus("Running…", "live");
  try {
    const res = await fetch(`/api/backtest?${buildQuery().toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderResult(data);
    setStatus(`Done · ${data.trades.length} trades`, "live");
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Error", "error");
  } finally {
    btn.disabled = false;
  }
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function boot() {
  el("bt-end").value = isoDaysAgo(0);
  el("bt-start").value = isoDaysAgo(365 * 3);
  el("bt-form").addEventListener("submit", runBacktest);
  document.querySelectorAll(".bt-mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  });
}

boot();

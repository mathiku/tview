const REFRESH_MS = 60_000;

function fmtMoney(value) {
  if (value == null) return "—";
  return `$${value.toFixed(2)}`;
}

function fmtPct(value) {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function pctClass(value) {
  if (value == null) return "neutral";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function signalClass(label) {
  if (label.startsWith("Pullback")) return "pullback";
  if (label.startsWith("Near 100")) return "near-100";
  if (label === "Trend OK") return "trend-ok";
  if (label === "Extended") return "extended";
  if (label === "Mixed") return "mixed";
  return "weak";
}

function checkMark(ok) {
  return `<span class="check ${ok ? "ok" : "no"}" title="${ok ? "Yes" : "No"}">${ok ? "✓" : "·"}</span>`;
}

function renderChecks(signal) {
  const c = signal.checks;
  return `
    <td class="check-cell" title="Trend OK (W+M above 200 SMA or 5+/6 bull)">${checkMark(c.trendOk)}</td>
    <td class="check-cell" title="Daily within ±3% of 100 SMA">${checkMark(c.at100Sma)}</td>
    <td class="check-cell" title="Was ≥5% above daily 100 SMA in last ~4 weeks">${checkMark(c.wasHigherRecently)}</td>
  `;
}

function smaCell(stock, timeframe, sma, pct) {
  const highlight =
    timeframe === "1d" &&
    sma === "100" &&
    (stock.signal.watch || stock.signal.checks.at100Sma);
  return `<td class="sma-cell ${pctClass(pct)}${highlight ? " pullback-focus" : ""}">${fmtPct(pct)}</td>`;
}

function renderPatternChecks(signal) {
  const p = signal.patterns ?? {};
  return `
    <td class="check-cell" title="Hammer candle on latest daily bar">${checkMark(p.hammer)}</td>
    <td class="check-cell" title="3 up days then 1–2 down days">${checkMark(p.pullbackStreak)}</td>
    <td class="check-cell" title="Pullback volume lighter than prior up days, or hammer on elevated volume">${checkMark(p.volumeOk)}</td>
  `;
}

function renderRow(stock) {
  const c = stock.comparison;
  const s = stock.signal;
  const rowClass = `${s.watch ? "stock-row watch-row" : "stock-row"}${stock.pinned ? " pinned-row" : ""}`;
  const pinMark = stock.pinned ? '<span class="pin-mark" title="Pinned — always scanned">★</span>' : "";
  return `
    <tr class="${rowClass}" data-href="/stock?symbol=${encodeURIComponent(stock.symbol)}">
      <td class="stock-name">
        <span class="sym">${stock.symbol}${pinMark}</span>
        <span class="name">${stock.name}</span>
      </td>
      <td>${fmtMoney(stock.price)}</td>
      ${smaCell(stock, "1d", "100", c["1d"].vs_sma100_pct)}
      ${smaCell(stock, "1d", "200", c["1d"].vs_sma200_pct)}
      ${smaCell(stock, "1wk", "100", c["1wk"].vs_sma100_pct)}
      ${smaCell(stock, "1wk", "200", c["1wk"].vs_sma200_pct)}
      ${smaCell(stock, "1mo", "100", c["1mo"].vs_sma100_pct)}
      ${smaCell(stock, "1mo", "200", c["1mo"].vs_sma200_pct)}
      <td class="score trend-score" title="Price above SMA count">${s.bull.above}/${s.bull.total}</td>
      ${renderChecks(s)}
      ${renderPatternChecks(s)}
      <td class="recent-high" title="Max % above daily 100 SMA in last ~4 weeks">${fmtPct(s.maxRecentAbove100)}</td>
      <td><span class="signal-pill ${signalClass(s.label)}">${s.label}</span></td>
    </tr>
  `;
}

function setStatus(text, kind = "live") {
  const badge = document.getElementById("refresh-status");
  badge.textContent = text;
  badge.className = `badge ${kind}`;
}

function wireRows() {
  document.querySelectorAll(".stock-row").forEach((row) => {
    row.addEventListener("click", () => {
      window.location.href = row.dataset.href;
    });
  });
}

async function refresh() {
  try {
    const res = await fetch("/api/overview");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();

    document.getElementById("last-updated").textContent =
      `Updated ${new Date(payload.updated_at).toLocaleString()}`;

    const watchCount = payload.stocks.filter((s) => s.signal.watch).length;
    document.getElementById("scan-scope").textContent =
      `${payload.pinnedCount ?? 0} pinned · ${payload.randomCount ?? 0} random large caps · pool of ${payload.poolSize ?? "?"}`;
    document.getElementById("watch-count").textContent =
      `${watchCount} on watch · ${payload.total} scanned today`;

    document.getElementById("overview-body").innerHTML =
      payload.stocks.map(renderRow).join("");

    wireRows();
    setStatus("Live", "live");
  } catch (err) {
    console.error(err);
    setStatus("Error", "error");
  }
}

refresh();
setInterval(refresh, REFRESH_MS);

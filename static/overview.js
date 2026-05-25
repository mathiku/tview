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
  switch (label) {
    case "Strong BUY": return "buy";
    case "Strong LONG": return "strong";
    case "LONG · Dip": return "long-dip";
    case "Dip BUY": return "dip-buy";
    case "LONG": return "long";
    case "Lean LONG": return "lean";
    case "Avoid LONG": return "avoid";
    default: return "neutral";
  }
}

function isDipCell(stock, timeframe, sma) {
  return stock.signal.dipChecks?.some(
    (c) => c.key === timeframe && c.sma === sma && c.dip
  );
}

function smaCell(stock, timeframe, sma, pct) {
  const dip = isDipCell(stock, timeframe, sma);
  const dipMark = dip ? '<span class="dip-mark" title="Closer than usual or below SMA">↓</span>' : "";
  return `<td class="sma-cell ${pctClass(pct)}${dip ? " is-dip" : ""}">${fmtPct(pct)}${dipMark}</td>`;
}

function renderRow(stock) {
  const c = stock.comparison;
  const s = stock.signal;
  return `
    <tr class="stock-row" data-href="/stock?symbol=${encodeURIComponent(stock.symbol)}">
      <td class="stock-name">
        <span class="sym">${stock.symbol}</span>
        <span class="name">${stock.name}</span>
      </td>
      <td>${fmtMoney(stock.price)}</td>
      ${smaCell(stock, "1d", "100", c["1d"].vs_sma100_pct)}
      ${smaCell(stock, "1d", "200", c["1d"].vs_sma200_pct)}
      ${smaCell(stock, "1wk", "100", c["1wk"].vs_sma100_pct)}
      ${smaCell(stock, "1wk", "200", c["1wk"].vs_sma200_pct)}
      ${smaCell(stock, "1mo", "100", c["1mo"].vs_sma100_pct)}
      ${smaCell(stock, "1mo", "200", c["1mo"].vs_sma200_pct)}
      <td class="score">${s.bull.above}/${s.bull.total}</td>
      <td class="score dip-score">${s.dip.above}/${s.dip.total}</td>
      <td class="score total-score">${s.total}/${s.maxTotal}</td>
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

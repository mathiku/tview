function fmtPct(n) {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtMoney(n) {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pctClass(n) {
  if (n == null) return "";
  if (n > 0) return "positive";
  if (n < 0) return "negative";
  return "";
}

function sidePill(side) {
  return `<span class="side-pill ${side}">${side === "short" ? "SHORT" : "LONG"}</span>`;
}

function renderSummary(s, period) {
  if (!s) return "";
  return `
    <div class="stat"><div class="stat-label">Total trades</div><div class="stat-value">${s.totalTrades}</div><div class="stat-sub">${s.tradesPerYear.toFixed(0)}/year · median ${s.medianHoldDays}d hold</div></div>
    <div class="stat"><div class="stat-label">CAGR</div><div class="stat-value ${pctClass(s.cagrPct)}">${s.cagrPct != null ? fmtPct(s.cagrPct) : "—"}</div><div class="stat-sub">${period ? `${period.start} → ${period.end}` : ""}</div></div>
    <div class="stat"><div class="stat-label">Win rate</div><div class="stat-value">${s.winRate.toFixed(1)}%</div><div class="stat-sub">Avg win ${fmtPct(s.avgWinPct)} · loss ${fmtPct(s.avgLossPct)}</div></div>
    <div class="stat"><div class="stat-label">Total return</div><div class="stat-value ${pctClass(s.totalReturnPct)}">${fmtPct(s.totalReturnPct)}</div><div class="stat-sub">Avg ${fmtPct(s.avgPnlPct)} per trade</div></div>
  `;
}

function renderTable(trades) {
  if (!trades.length) return `<p class="empty">No trades match these filters.</p>`;
  return `<table>
    <thead><tr><th>Side</th><th>Symbol</th><th>Entry</th><th>Exit</th><th>Hold</th><th>P/L</th><th>$ P/L</th><th>Exit</th><th>Signal</th></tr></thead>
    <tbody>
      ${trades
        .map(
          (t) => `<tr>
            <td>${sidePill(t.side ?? "long")}</td>
            <td><strong>${t.symbol}</strong></td>
            <td>${t.entryDate}<br><small>${fmtMoney(t.entryPrice)}</small></td>
            <td>${t.exitDate}<br><small>${fmtMoney(t.exitPrice)}</small></td>
            <td>${t.holdDays}d</td>
            <td class="${pctClass(t.pnlPct)}">${fmtPct(t.pnlPct)}</td>
            <td class="${pctClass(t.pnlUsd)}">${fmtMoney(t.pnlUsd)}</td>
            <td>${t.exitReason ?? "—"}</td>
            <td>${t.signalLabel ?? "—"}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

async function load() {
  const source = document.getElementById("filter-source").value;
  const side = document.getElementById("filter-side").value;
  const year = document.getElementById("filter-year").value;
  const res = await fetch(`/api/trades?source=${source}&side=${side}&year=${year}`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();

  document.getElementById("updated-at").textContent = `Updated ${new Date(data.updated_at).toLocaleString()}`;
  document.getElementById("page-subtitle").textContent = data.backtestFile
    ? `Backtest: ${data.backtestFile} · ${data.backtestCount} trades · ${data.paperCount} paper trades`
    : `${data.paperCount} paper trades`;

  document.getElementById("summary-stats").innerHTML = renderSummary(data.summary, data.period);
  document.getElementById("trade-count").textContent = `${data.filteredCount} shown`;

  const yearSelect = document.getElementById("filter-year");
  if (yearSelect.options.length === 1 && data.summary?.byYear) {
    for (const y of Object.keys(data.summary.byYear).sort()) {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = `${y} (${data.summary.byYear[y]})`;
      yearSelect.appendChild(opt);
    }
  }

  document.getElementById("trades-table").innerHTML = renderTable(data.trades);
}

for (const id of ["filter-source", "filter-side", "filter-year"]) {
  document.getElementById(id).addEventListener("change", () => load().catch(console.error));
}

load().catch((err) => {
  document.getElementById("page-subtitle").textContent = err.message;
});

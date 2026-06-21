function fmtMoney(n) {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtPct(n) {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function pctClass(n) {
  if (n == null) return "";
  if (n > 0) return "positive";
  if (n < 0) return "negative";
  return "";
}

function metricBox(label, value, sub) {
  return `<div class="metric-box">${label}<strong class="${pctClass(typeof value === "number" && label.includes("P/L") ? value : null)}">${value}</strong>${sub ? `<div style="color:var(--muted);margin-top:0.15rem">${sub}</div>` : ""}</div>`;
}

function renderStrategyCard(strategy, metrics, portfolio) {
  const sideClass = strategy.side === "short" ? "short" : "long";
  const m = metrics ?? {};

  return `
    <article class="strategy-card">
      <div class="${sideClass}">${strategy.side === "short" ? "↓ SHORT" : "↑ LONG"}</div>
      <h2>${strategy.name}</h2>
      <p class="tagline">${strategy.tagline}</p>

      <h3>Entry rules</h3>
      <ul>${strategy.entry.map((r) => `<li>${r}</li>`).join("")}</ul>

      <h3>Pattern confirms</h3>
      <ul>${strategy.patterns.map((p) => `<li><strong>${p.name}</strong> — ${p.rule}</li>`).join("")}</ul>

      <h3>Exit rules</h3>
      <ul>${strategy.exits.map((r) => `<li>${r}</li>`).join("")}</ul>

      <h3>Backtest results</h3>
      <div class="metrics-row">
        ${metricBox("Trades", m.totalTrades ?? 0, `win ${(m.winRate ?? 0).toFixed(1)}%`)}
        ${metricBox("Total P/L", fmtMoney(m.totalPnlUsd), fmtPct(m.avgPnlPct) + " avg")}
        ${metricBox("Profit factor", Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : "∞", `${(m.avgHoldDays ?? 0).toFixed(1)}d avg hold`)}
      </div>
    </article>
  `;
}

function renderTradeTable(trades) {
  if (!trades?.length) return `<p class="empty">No trades.</p>`;
  return `<table>
    <thead><tr><th>Side</th><th>Symbol</th><th>Dates</th><th>P/L</th><th>Signal</th></tr></thead>
    <tbody>
      ${trades
        .map(
          (t) => `<tr>
            <td><span class="side-pill ${t.side === "short" ? "short" : "long"}">${t.side === "short" ? "SHORT" : "LONG"}</span></td>
            <td><strong>${t.symbol}</strong></td>
            <td>${t.entryDate} → ${t.exitDate}</td>
            <td class="${pctClass(t.pnlPct)}">${fmtPct(t.pnlPct)}</td>
            <td>${t.signalLabel ?? "—"}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

function renderExitBars(breakdown) {
  if (!breakdown || !Object.keys(breakdown).length) {
    return `<p class="empty">No backtest data yet. Run <code>npm run backtest</code>.</p>`;
  }
  const max = Math.max(...Object.values(breakdown));
  return Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([reason, count]) => `<div class="bar-row">
        <span style="width:110px">${reason}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(count / max) * 100}%"></div></div>
        <span>${count}</span>
      </div>`
    )
    .join("");
}

async function load() {
  const res = await fetch("/api/strategies");
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  const bt = data.backtest;

  document.getElementById("updated-at").textContent = `Loaded ${new Date(data.updated_at).toLocaleString()}`;
  document.getElementById("backtest-file").textContent = bt ? bt.file : "No backtest file";
  document.getElementById("report-subtitle").textContent = bt
    ? `Backtest ${bt.period.start} → ${bt.period.end ?? "present"} · $${data.portfolio.initialCapital.toLocaleString()} start`
    : "Run npm run backtest to generate results";

  const c = bt?.combined;
  document.getElementById("combined-stats").innerHTML = c
    ? `
    <div class="stat"><div class="stat-label">Combined return</div><div class="stat-value ${pctClass(c.totalReturnPct)}">${fmtPct(c.totalReturnPct)}</div><div class="stat-sub">${fmtMoney(c.totalPnlUsd)} profit</div></div>
    <div class="stat"><div class="stat-label">Final equity</div><div class="stat-value">${fmtMoney(c.finalEquity)}</div><div class="stat-sub">Max DD ${fmtPct(-c.maxDrawdownPct)}</div></div>
    <div class="stat"><div class="stat-label">Total trades</div><div class="stat-value">${c.totalTrades}</div><div class="stat-sub">Win rate ${c.winRate.toFixed(1)}%</div></div>
    <div class="stat"><div class="stat-label">Profit factor</div><div class="stat-value">${Number.isFinite(c.profitFactor) ? c.profitFactor.toFixed(2) : "∞"}</div><div class="stat-sub">Avg hold ${c.avgHoldDays.toFixed(1)} days</div></div>
  `
    : `<div class="stat span2"><div class="stat-label">Backtest</div><div class="stat-value">—</div><div class="stat-sub">Run <code>npm run backtest</code> in bot-trader/</div></div>`;

  const longStrategy = data.strategies.find((s) => s.id === "long-pullback");
  const shortStrategy = data.strategies.find((s) => s.id === "short-rally");

  document.getElementById("strategy-cards").innerHTML = `
    ${renderStrategyCard(longStrategy, bt?.long, data.portfolio)}
    ${renderStrategyCard(shortStrategy, bt?.short, data.portfolio)}
  `;

  document.getElementById("exit-bars").innerHTML = renderExitBars(bt?.combined?.exitBreakdown);
  document.getElementById("winners-table").innerHTML = renderTradeTable(bt?.topWinners);
  document.getElementById("losers-table").innerHTML = renderTradeTable(bt?.topLosers);
}

load().catch((err) => {
  document.getElementById("report-subtitle").textContent = err.message;
});

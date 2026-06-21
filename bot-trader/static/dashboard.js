const REFRESH_MS = 15_000;

function fmtMoney(n) {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function sidePill(side) {
  return `<span class="side-pill ${side}">${side === "short" ? "SHORT" : "LONG"}</span>`;
}

function renderTable(headers, rows, emptyMsg) {
  if (!rows.length) return `<p class="empty">${emptyMsg}</p>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function renderEquityChart(history) {
  const el = document.getElementById("equity-chart");
  if (!history?.length) {
    el.innerHTML = `<p class="empty">No equity history yet — run a paper cycle to start.</p>`;
    return;
  }

  const w = 800;
  const h = 100;
  const pad = 4;
  const values = history.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = pad + (i / Math.max(values.length - 1, 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const start = history[0].date;
  const end = history[history.length - 1].date;
  document.getElementById("equity-range").textContent = `${start} → ${end}`;

  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="#4da3ff" stroke-width="2" points="${points}" /></svg>`;
}

function renderDashboard(data) {
  document.getElementById("updated-at").textContent = `Updated ${new Date(data.updated_at).toLocaleString()} · last session ${data.lastRunDate ?? "—"}`;

  document.getElementById("stats").innerHTML = `
    <div class="stat"><div class="stat-label">Equity</div><div class="stat-value">${fmtMoney(data.equity)}</div><div class="stat-sub ${pctClass(data.returnPct)}">${fmtPct(data.returnPct)} vs start</div></div>
    <div class="stat"><div class="stat-label">Cash</div><div class="stat-value">${fmtMoney(data.cash)}</div><div class="stat-sub">Available</div></div>
    <div class="stat"><div class="stat-label">Open</div><div class="stat-value">${data.openCount}</div><div class="stat-sub"><span class="long">${data.longCount} long</span> · <span class="short">${data.shortCount} short</span></div></div>
    <div class="stat"><div class="stat-label">Realized P/L</div><div class="stat-value ${pctClass(data.realizedPnl)}">${fmtMoney(data.realizedPnl)}</div><div class="stat-sub">${data.closedCount} closed trades</div></div>
  `;

  document.getElementById("open-count").textContent = String(data.openCount);
  document.getElementById("pending-count").textContent = String(data.pendingCount);
  document.getElementById("closed-count").textContent = String(data.closedCount);

  renderEquityChart(data.equityHistory);

  document.getElementById("positions-table").innerHTML = renderTable(
    ["Side", "Symbol", "Shares", "Entry", "Date", "Signal"],
    data.positions.map(
      (p) => `<tr>
        <td>${sidePill(p.side ?? "long")}</td>
        <td><strong>${p.symbol}</strong></td>
        <td>${p.shares}</td>
        <td>${fmtMoney(p.entryPrice)}</td>
        <td>${p.entryDate}</td>
        <td>${p.signalLabel ?? "—"}</td>
      </tr>`
    ),
    "No open positions."
  );

  document.getElementById("pending-table").innerHTML = renderTable(
    ["Side", "Symbol", "Score", "Signal", "Queued"],
    data.pendingEntries.map(
      (p) => `<tr>
        <td>${sidePill(p.side)}</td>
        <td><strong>${p.symbol}</strong></td>
        <td>${p.score?.toFixed?.(1) ?? p.score ?? "—"}</td>
        <td>${p.label ?? "—"}</td>
        <td>${p.signalDate ?? "—"}</td>
      </tr>`
    ),
    "Nothing queued — bot will scan at the next cycle."
  );

  document.getElementById("closed-table").innerHTML = renderTable(
    ["Side", "Symbol", "Entry → Exit", "P/L", "Reason", "Signal"],
    data.closedTrades.map(
      (t) => `<tr>
        <td>${sidePill(t.side ?? "long")}</td>
        <td><strong>${t.symbol}</strong></td>
        <td>${t.entryDate} → ${t.exitDate}</td>
        <td class="${pctClass(t.pnlUsd)}">${fmtPct(t.pnlPct)}</td>
        <td>${t.exitReason}</td>
        <td>${t.signalLabel ?? "—"}</td>
      </tr>`
    ),
    "No closed trades yet."
  );

  const activity = document.getElementById("activity");
  if (!data.activity?.length) {
    activity.innerHTML = `<li class="empty">No activity logged yet.</li>`;
  } else {
    activity.innerHTML = data.activity
      .map((a) => {
        if (a.type === "open") {
          return `<li><span class="msg">OPEN ${(a.side ?? "long").toUpperCase()} ${a.symbol}</span> · ${a.shares} sh @ ${fmtMoney(a.entryPrice)} · ${new Date(a.at).toLocaleString()}</li>`;
        }
        if (a.type === "close") {
          return `<li><span class="msg">CLOSE ${(a.side ?? "long").toUpperCase()} ${a.symbol}</span> · ${a.reason ?? ""} · ${new Date(a.at).toLocaleString()}</li>`;
        }
        return `<li>${a.msg ?? a.level} ${a.error ? `· ${a.error}` : ""} · ${new Date(a.at).toLocaleString()}</li>`;
      })
      .join("");
  }
}

async function load() {
  const res = await fetch("/api/dashboard");
  if (!res.ok) throw new Error(await res.text());
  renderDashboard(await res.json());
}

document.getElementById("run-btn").addEventListener("click", async () => {
  const btn = document.getElementById("run-btn");
  btn.disabled = true;
  btn.textContent = "Running…";
  try {
    const res = await fetch("/api/run-cycle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    renderDashboard(data.dashboard);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Run cycle now";
  }
});

load().catch((err) => {
  document.getElementById("status-badge").className = "badge error";
  document.getElementById("status-badge").textContent = "Error";
  document.getElementById("updated-at").textContent = err.message;
});

setInterval(() => load().catch(() => {}), REFRESH_MS);

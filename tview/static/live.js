const REFRESH_MS = 120_000; // 2 minutes

let liveData = null;
let lastRefreshAttempt = 0;

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

function setStatus(text, kind = "live") {
  const badge = document.getElementById("refresh-status");
  badge.textContent = text;
  badge.className = `badge ${kind}`;
}

function updateMarketStatus() {
  const now = new Date();
  const status = getMarketStatus(now);
  const badge = document.getElementById("market-status");
  
  if (status === "open") {
    badge.textContent = "Market Open";
    badge.className = "badge live";
  } else {
    badge.textContent = "Market Closed";
    badge.className = "badge error";
  }
}

// Simple market hours check (9:30 AM – 4:00 PM ET, Mon–Fri, no holidays)
function getMarketStatus(now) {
  const et = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  
  const parts = {};
  for (const p of et.formatToParts(now)) {
    parts[p.type] = p.value;
  }
  
  const weekday = parts.weekday;
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const minutes = hour * 60 + minute;
  
  const openMinute = 9 * 60 + 30;
  const closeMinute = 16 * 60;
  
  return (minutes >= openMinute && minutes < closeMinute) ? "open" : "closed";
}

function formatTimestamp(isoString) {
  try {
    const date = new Date(isoString);
    return date.toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
      timeZoneName: "short",
    });
  } catch {
    return "—";
  }
}

function formatApproach(direction) {
  if (direction === "falling") {
    return '<span class="approach-arrow falling" title="Falling toward 200 SMA">↓ Falling</span>';
  } else if (direction === "rising") {
    return '<span class="approach-arrow rising" title="Rising from 200 SMA">↑ Rising</span>';
  }
  return '<span class="approach-arrow neutral" title="Sideways or insufficient data">→ Neutral</span>';
}

function renderTable() {
  const tbody = document.getElementById("live-body");
  
  if (!liveData?.stocks?.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">No Trend OK stocks found or market data unavailable</td></tr>';
    return;
  }
  
  tbody.innerHTML = liveData.stocks
    .map((stock) => {
      const distanceClass = pctClass(stock.distancePct);
      const distanceDisplay = fmtPct(stock.distancePct);
      
      return `
        <tr class="stock-row">
          <td class="col-stock">
            <strong>${stock.symbol}</strong>
            <span class="stock-name">${stock.name}</span>
          </td>
          <td>${fmtMoney(stock.livePrice)}</td>
          <td>${fmtMoney(stock.daily200Sma)}</td>
          <td class="${distanceClass}">${distanceDisplay}</td>
          <td>${formatApproach(stock.direction)}</td>
          <td class="bar-time">${formatTimestamp(stock.barTimeISO)}</td>
          <td><a href="/stock?symbol=${stock.symbol}" class="view-btn">View →</a></td>
        </tr>
      `;
    })
    .join("");
}

function updateStats() {
  const stats = document.getElementById("live-stats");
  if (!liveData) {
    stats.textContent = "Loading…";
    return;
  }
  
  stats.textContent = `${liveData.total} stocks tracked (${liveData.candidates} Trend OK from ${liveData.scanned} scanned)`;
}

async function refresh(attempt = 0) {
  lastRefreshAttempt = Date.now();
  
  try {
    setStatus("Loading…");
    const res = await fetch("/api/live-tracker");
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    
    liveData = await res.json();
    
    document.getElementById("last-updated").textContent =
      `Updated ${new Date(liveData.updated_at).toLocaleString()}`;
    
    renderTable();
    updateStats();
    updateMarketStatus();
    setStatus("Live", "live");
  } catch (err) {
    console.error("Failed to fetch live tracker data:", err);
    
    // Retry with backoff for cold starts
    if (attempt < 5) {
      setStatus("Waking up…");
      setTimeout(() => refresh(attempt + 1), Math.min(1500 * 2 ** attempt, 15000));
    } else {
      setStatus("Error — retrying", "error");
      setTimeout(() => refresh(0), 30000);
    }
  }
}

async function boot() {
  updateMarketStatus();
  await refresh();
  
  // Auto-refresh every 2 minutes
  setInterval(() => {
    const elapsed = Date.now() - lastRefreshAttempt;
    // Only refresh if the last attempt was more than 90 seconds ago (prevents double refresh)
    if (elapsed > 90000) {
      refresh();
    }
  }, REFRESH_MS);
  
  // Update market status every minute
  setInterval(updateMarketStatus, 60000);
}

boot();

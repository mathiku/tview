const REFRESH_MS = 60_000;

function setStatus(text, kind = "live") {
  const badge = document.getElementById("refresh-status");
  badge.textContent = text;
  badge.className = `badge ${kind}`;
}

function fmtMoney(value) {
  if (value == null) return "—";
  return `$${value.toFixed(2)}`;
}

function fmtPct(value) {
  if (value == null) return "—";
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

function calculatePositionSize(accountSize, riskPct, entryPrice, stopPrice) {
  const riskAmount = accountSize * (riskPct / 100);
  const riskPerShare = Math.abs(entryPrice - stopPrice);
  if (riskPerShare === 0) return { shares: 0, capital: 0 };
  const shares = Math.floor(riskAmount / riskPerShare);
  const capital = shares * entryPrice;
  return { shares, capital: Math.round(capital) };
}

function renderBestPick(stock, timestamp) {
  const signal = stock.signal;
  const levels = signal.levels;
  
  if (!levels) {
    return `
      <div class="pick-empty">
        <h3>No qualifying setup right now</h3>
        <p>None of today's scanned stocks meet all the pullback criteria. Check back later or browse the <a href="/">Overview</a> for near-misses.</p>
      </div>
    `;
  }

  const accountSize = 1000;
  const riskPct = 1;
  const position = calculatePositionSize(accountSize, riskPct, levels.entry, levels.stop);
  
  // Extract pattern info for the "why" explanation
  const patterns = signal.patterns || {};
  const checks = signal.checks || {};
  const bull = signal.bull || {};
  
  let whyParts = [];
  whyParts.push(`${bull.above || 0}/${bull.total || 6} moving averages bullish`);
  
  if (checks.trendOk) {
    whyParts.push("healthy uptrend");
  }
  
  if (checks.at100Sma) {
    const dailyVs100 = signal.dailyVs100;
    if (dailyVs100 != null) {
      if (dailyVs100 < 0) {
        whyParts.push("price dipped below 100 SMA");
      } else if (dailyVs100 <= 1) {
        whyParts.push("price touching 100 SMA");
      } else {
        whyParts.push(`price near 100 SMA (${fmtPct(dailyVs100)})`);
      }
    }
  }
  
  if (patterns.hammer || patterns.hammerAt100) {
    whyParts.push("hammer candle showing rejection of lows");
  }
  
  if (patterns.pullbackStreak) {
    whyParts.push("orderly pullback pattern (3↑↓)");
  }
  
  if (patterns.volumeOk) {
    whyParts.push("volume confirms setup");
  }
  
  if (signal.doubleBottom?.state === "current") {
    whyParts.push("double bottom breaking neckline now");
  }
  
  const why = whyParts.join(", ") + ".";
  
  return `
    <div class="pick-hero">
      <div class="pick-symbol-block">
        <h2 class="pick-symbol">${stock.symbol}</h2>
        <p class="pick-name">${stock.name}</p>
        <a href="/stock?symbol=${encodeURIComponent(stock.symbol)}" class="pick-chart-link">View charts →</a>
      </div>
      
      <div class="pick-levels">
        <div class="pick-level pick-level-entry">
          <span class="pick-level-label">Buy at</span>
          <span class="pick-level-value">${fmtMoney(levels.entry)}</span>
          <span class="pick-level-meta">(Close as of ${timestamp})</span>
        </div>
        
        <div class="pick-level pick-level-stop">
          <span class="pick-level-label">Stop Loss</span>
          <span class="pick-level-value">${fmtMoney(levels.stop)}</span>
          <span class="pick-level-meta">${fmtPct(-levels.riskPct)} risk</span>
        </div>
        
        <div class="pick-level pick-level-target">
          <span class="pick-level-label">Take Profit</span>
          <span class="pick-level-value">${fmtMoney(levels.target)}</span>
          <span class="pick-level-meta">${fmtPct(levels.rewardPct)} gain</span>
        </div>
      </div>
    </div>
    
    <div class="pick-why">
      <h3>Why this pick?</h3>
      <p>${why}</p>
      <p class="pick-signal-label"><span class="signal-pill pullback">${signal.label}</span></p>
    </div>
    
    <div class="pick-sizing">
      <h3>Position sizing for ~$1,000 account</h3>
      <p class="pick-sizing-note">Risking ${riskPct}% of account ($${accountSize * (riskPct / 100)}) to stop:</p>
      <div class="pick-sizing-values">
        <div class="pick-sizing-item">
          <span class="pick-sizing-label">Shares</span>
          <span class="pick-sizing-value">${position.shares}</span>
        </div>
        <div class="pick-sizing-item">
          <span class="pick-sizing-label">Capital required</span>
          <span class="pick-sizing-value">${fmtMoney(position.capital)}</span>
        </div>
        <div class="pick-sizing-item">
          <span class="pick-sizing-label">Risk/Reward</span>
          <span class="pick-sizing-value">${levels.rr}×</span>
        </div>
      </div>
      <p class="pick-sizing-note small">Adjust share count based on your own account size and risk tolerance. This is illustrative only.</p>
    </div>
  `;
}

function renderNoPick(reason) {
  return `
    <div class="pick-empty">
      <h3>No qualifying setup right now</h3>
      <p>${reason || "None of today's scanned stocks meet all the pullback criteria."}</p>
      <p>Check back later or browse the <a href="/">Overview</a> to see all candidates.</p>
    </div>
  `;
}

async function refresh() {
  try {
    setStatus("Loading…", "loading");
    
    // Fetch the overview data (long direction, full view)
    const res = await fetch("/api/overview?direction=long&view=full");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    
    // Filter to stocks that pass all watchlist checks (watch = true)
    const candidates = data.stocks.filter(s => s.signal.watch === true);
    
    // Sort by score (highest first)
    candidates.sort((a, b) => (b.signal.score || 0) - (a.signal.score || 0));
    
    const content = document.getElementById("pick-content");
    const timestamp = document.getElementById("pick-timestamp");
    
    if (candidates.length === 0) {
      content.innerHTML = renderNoPick("No pullback setups meet all criteria right now.");
      timestamp.textContent = `As of ${new Date(data.updated_at).toLocaleString()}`;
      setStatus("Live", "live");
      return;
    }
    
    // Take the best one
    const best = candidates[0];
    
    content.innerHTML = renderBestPick(best, new Date(data.updated_at).toLocaleString());
    timestamp.textContent = `As of ${new Date(data.updated_at).toLocaleString()}`;
    setStatus("Live", "live");
    
  } catch (err) {
    console.error(err);
    const content = document.getElementById("pick-content");
    content.innerHTML = renderNoPick("Failed to load scan data. Please try again.");
    setStatus("Error", "error");
  }
}

// Initial load
refresh();

// Refresh every minute
setInterval(refresh, REFRESH_MS);

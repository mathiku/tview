const REFRESH_MS = 60_000;

let allStocks = [];
let meta = { randomCount: 0, poolSize: 0 };

function fmtMoney(value) {
  if (value == null) return "—";
  return `$${value.toFixed(2)}`;
}

function fmtPct(value) {
  if (value == null) return "—";
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
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

function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
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

function dbTitle(db) {
  if (!db?.match) return "No double bottom";
  return db.breakout
    ? `Double bottom — broke out above neckline ${db.neckline}`
    : `Double bottom — emerging toward neckline ${db.neckline}`;
}

function renderPatternChecks(signal) {
  const p = signal.patterns ?? {};
  const db = signal.doubleBottom;
  return `
    <td class="check-cell" title="Hammer candle on latest daily bar">${checkMark(p.hammer)}</td>
    <td class="check-cell" title="3 up days then 1–2 down days">${checkMark(p.pullbackStreak)}</td>
    <td class="check-cell" title="Pullback volume lighter than prior up days, or hammer on elevated volume">${checkMark(p.volumeOk)}</td>
    <td class="check-cell" title="${dbTitle(db)}">${checkMark(db?.match)}</td>
  `;
}

function levelCells(signal) {
  const lv = signal.levels;
  if (!lv) return `<td class="lvl">—</td><td class="lvl">—</td>`;
  const stopTitle = `Stop ${fmtMoney(lv.stop)} (−${lv.riskPct}%)`;
  const tgtTitle = `Target ${fmtMoney(lv.target)} (+${lv.rewardPct}%, ${lv.rr}× risk)`;
  return `<td class="lvl lvl-stop" title="${stopTitle}">${fmtMoney(lv.stop)}</td><td class="lvl lvl-target" title="${tgtTitle}">${fmtMoney(lv.target)}</td>`;
}

function renderRow(stock) {
  const c = stock.comparison;
  const s = stock.signal;
  const rowClass = `${s.watch ? "stock-row watch-row" : "stock-row"}${stock.pinned ? " pinned-row" : ""}`;
  const star = stock.pinned ? "★" : "☆";
  const pinTitle = stock.pinned ? "Remove from your watchlist" : "Add to your watchlist";
  return `
    <tr class="${rowClass}" data-href="/stock?symbol=${encodeURIComponent(stock.symbol)}">
      <td class="stock-name">
        <button class="pin-toggle ${stock.pinned ? "on" : ""}" data-symbol="${stock.symbol}" data-name="${escapeAttr(stock.name)}" title="${pinTitle}">${star}</button>
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
      <td class="score trend-score" title="Price above SMA count">${s.bull.above}/${s.bull.total}</td>
      ${renderChecks(s)}
      ${renderPatternChecks(s)}
      <td class="recent-high" title="Max % above daily 100 SMA in last ~4 weeks">${fmtPct(s.maxRecentAbove100)}</td>
      ${levelCells(s)}
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
  document.querySelectorAll(".pin-toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const sym = btn.dataset.symbol;
      Store.toggle(sym, btn.dataset.name);
      const st = allStocks.find((s) => s.symbol === sym);
      if (st) st.pinned = Store.has(sym);
      render();
    });
  });
}

function passesFilters(stock, f) {
  const c = stock.comparison;
  const s = stock.signal;

  const nums = {
    price: stock.price,
    d100: c["1d"].vs_sma100_pct,
    d200: c["1d"].vs_sma200_pct,
    w100: c["1wk"].vs_sma100_pct,
    w200: c["1wk"].vs_sma200_pct,
    m100: c["1mo"].vs_sma100_pct,
    m200: c["1mo"].vs_sma200_pct,
    smas: s.bull.above,
    recentHigh: s.maxRecentAbove100,
  };
  for (const k in nums) {
    if (f[k] != null && (nums[k] == null || nums[k] < f[k])) return false;
  }

  if (f.text) {
    const t = f.text.toLowerCase();
    if (!stock.symbol.toLowerCase().includes(t) && !(stock.name || "").toLowerCase().includes(t)) {
      return false;
    }
  }
  if (f.signalText && !(s.label || "").toLowerCase().includes(f.signalText.toLowerCase())) {
    return false;
  }

  const boolByKey = {
    trendOk: s.checks.trendOk,
    at100Sma: s.checks.at100Sma,
    wasHigherRecently: s.checks.wasHigherRecently,
    hammer: s.patterns?.hammer,
    pullbackStreak: s.patterns?.pullbackStreak,
    volumeOk: s.patterns?.volumeOk,
    doubleBottom: s.doubleBottom?.match,
  };
  for (const k in boolByKey) {
    if (f[`chk_${k}`] && !boolByKey[k]) return false;
  }

  if (f.watchOnly && !s.watch) return false;
  return true;
}

function render() {
  const f = Store.getFilters();
  // Watchlist rows always show; filters narrow the random scan.
  const rows = allStocks.filter((s) => s.pinned || passesFilters(s, f));
  document.getElementById("overview-body").innerHTML = rows.map(renderRow).join("");
  wireRows();

  const watchCount = rows.filter((s) => s.signal.watch).length;
  document.getElementById("scan-scope").textContent =
    `${Store.symbols().length} in your watchlist · ${meta.randomCount} random large caps · pool of ${meta.poolSize}`;
  document.getElementById("watch-count").textContent =
    `${watchCount} on watch · ${rows.length} shown`;
}

async function loadWatchlistStocks() {
  const syms = Store.symbols();
  if (!syms.length) return [];
  try {
    const res = await fetch(`/api/analyze?symbols=${encodeURIComponent(syms.join(","))}`);
    const p = await res.json();
    return (p.stocks ?? []).map((s) => ({ ...s, pinned: true }));
  } catch {
    return [];
  }
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

async function refresh() {
  try {
    await seedWatchlist();
    const [ov, pins] = await Promise.all([
      fetch("/api/overview").then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      loadWatchlistStocks(),
    ]);

    pins.sort(
      (a, b) =>
        Number(b.signal.watch) - Number(a.signal.watch) ||
        (b.signal.score ?? 0) - (a.signal.score ?? 0)
    );
    const pinned = new Set(pins.map((s) => s.symbol));
    const random = ov.stocks.filter((s) => !pinned.has(s.symbol));

    allStocks = [...pins, ...random];
    meta = { randomCount: random.length, poolSize: ov.poolSize ?? "?" };

    document.getElementById("last-updated").textContent =
      `Updated ${new Date(ov.updated_at).toLocaleString()}`;

    render();
    setStatus("Live", "live");
  } catch (err) {
    console.error(err);
    setStatus("Error", "error");
  }
}

function wireFilters() {
  const filters = Store.getFilters();

  // Inline value/text filters in each column header.
  document.querySelectorAll(".col-filter").forEach((inp) => {
    const k = inp.dataset.key;
    const isNum = inp.dataset.type === "num";
    if (filters[k] != null) inp.value = filters[k];
    inp.addEventListener("input", () => {
      const f = Store.getFilters();
      const v = inp.value.trim();
      if (v === "") delete f[k];
      else f[k] = isNum ? Number(v) : v;
      Store.setFilters(f);
      render();
    });
  });

  // "Only ✓" checkboxes under the boolean columns.
  document.querySelectorAll(".chk-filter input").forEach((box) => {
    const key = `chk_${box.dataset.check}`;
    box.checked = !!filters[key];
    box.addEventListener("change", () => {
      const f = Store.getFilters();
      if (box.checked) f[key] = true;
      else delete f[key];
      Store.setFilters(f);
      render();
    });
  });

  const watch = document.getElementById("filter-watch");
  watch.checked = !!filters.watchOnly;
  watch.addEventListener("change", () => {
    const f = Store.getFilters();
    if (watch.checked) f.watchOnly = true;
    else delete f.watchOnly;
    Store.setFilters(f);
    render();
  });

  document.getElementById("filter-clear").addEventListener("click", () => {
    Store.setFilters({});
    document.querySelectorAll(".col-filter").forEach((i) => (i.value = ""));
    document.querySelectorAll(".chk-filter input").forEach((b) => (b.checked = false));
    watch.checked = false;
    render();
  });
}

wireFilters();
refresh();
setInterval(refresh, REFRESH_MS);

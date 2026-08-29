const REFRESH_MS = 60_000;

let allStocks = [];
let meta = { randomCount: 0, poolSize: 0 };
let direction = Store.getDirection();
let simple = Store.getSimple();

const COPY = {
  long: {
    pageTitle: "Pullback Watch",
    scanScope: "Scanning large-cap US stocks for daily 100 SMA pullbacks",
    panelTitle: "Pullback candidates",
    setupGroup: "Pullback",
    smasHead: "SMAs+",
    smasTitle: "Price above SMA count",
    trendTitle: "W+M above 200 SMA or 5+/6 bull",
    atSmaHead: "At 100",
    atSmaTitle: "Daily within ±3% of 100 SMA",
    wasExtHead: "Was high",
    wasExtTitle: "Was ≥5% above daily 100 SMA in last ~4 weeks",
    patternAHead: "Hammer",
    patternATitle: "Hammer candle on latest bar",
    patternBHead: "3↑↓",
    patternBTitle: "3 up days then 1–2 down days",
    volTitle: "Light volume on pullback or heavy on hammer",
    recentExtHead: "Recent high",
    recentExtTitle: "Max % above daily 100 SMA in last ~4 weeks",
    stopTitle: "Suggested stop — below the recent swing low",
    gainTitle: "Gain if the target is hit",
    signalOptions: [
      ["", "All"],
      ["pullback", "Pullback"],
      ["near-100", "Near 100"],
      ["trend-ok", "Trend OK"],
      ["extended", "Extended"],
      ["mixed", "Mixed"],
      ["weak", "Weak trend"],
    ],
  },
  short: {
    pageTitle: "Rally Watch",
    scanScope: "Scanning large-cap US stocks for daily 100 SMA rallies in downtrends",
    panelTitle: "Rally candidates",
    setupGroup: "Rally",
    smasHead: "SMAs−",
    smasTitle: "Price below SMA count",
    trendTitle: "W+M below 200 SMA or 5+/6 bear",
    atSmaHead: "At 100",
    atSmaTitle: "Daily within ±3% of 100 SMA",
    wasExtHead: "Was low",
    wasExtTitle: "Was ≥5% below daily 100 SMA in last ~4 weeks",
    patternAHead: "Star",
    patternATitle: "Shooting star candle on latest bar",
    patternBHead: "3↓↑",
    patternBTitle: "3 down days then 1–2 up days",
    volTitle: "Light volume on rally or heavy on shooting star",
    recentExtHead: "Recent low",
    recentExtTitle: "Max % below daily 100 SMA in last ~4 weeks",
    stopTitle: "Suggested stop — above the recent swing high",
    gainTitle: "Gain if the target is hit (short)",
    signalOptions: [
      ["", "All"],
      ["rally", "Rally"],
      ["near-100", "Near 100"],
      ["trend-ok", "Trend OK"],
      ["extended", "Extended down"],
      ["mixed", "Mixed"],
      ["weak", "Weak trend"],
    ],
  },
  simple: {
    pageTitle: "Simple Watch",
    scanScope: "Bull trends dipping to the daily 200 SMA — about to bounce",
    panelTitle: "200 SMA bounces",
    setupGroup: "Setup",
    smasHead: "SMAs+",
    smasTitle: "Price above SMA count",
    trendTitle: "Weekly & monthly above 200 SMA, or 5+/6 SMAs bullish",
    atSmaHead: "At 200",
    atSmaTitle: "Daily within ±3% of 200 SMA",
    wasExtHead: "Was high",
    wasExtTitle: "Was ≥5% above daily 200 SMA in last ~4 weeks",
    patternAHead: "",
    patternATitle: "",
    patternBHead: "",
    patternBTitle: "",
    volTitle: "",
    recentExtHead: "",
    recentExtTitle: "",
    stopTitle: "",
    gainTitle: "",
    signalOptions: [
      ["", "All"],
      ["bounce", "Bounce"],
      ["near-200", "Near 200"],
      ["trend-ok", "Trend OK"],
      ["extended", "Extended"],
      ["mixed", "Mixed"],
      ["weak", "Weak trend"],
    ],
  },
};

function isShort() {
  return !simple && direction === "short";
}

function isSimple() {
  return simple;
}

function copy() {
  if (isSimple()) return COPY.simple;
  return COPY[direction];
}

function viewParam() {
  return isSimple() ? "simple" : "full";
}

function atSmaCheck(signal) {
  if (isSimple()) return !!signal.checks?.at200Sma;
  if (isShort()) return !!signal.checks?.at100Sma;
  return !!signal.checks?.at100Sma;
}

function signalMetrics(signal) {
  const p = signal.patterns ?? {};
  if (isSimple()) {
    return {
      smas: signal.bull?.above ?? 0,
      smasTotal: signal.bull?.total ?? 0,
      wasExtendedRecently: !!signal.checks?.wasHigherRecently,
      atSma: !!signal.checks?.at200Sma,
      patternA: false,
      patternB: false,
      volumeOk: false,
      recentExtreme: signal.maxRecentAbove200,
      doubleBottom: false,
    };
  }
  if (isShort()) {
    return {
      smas: signal.bear?.below ?? 0,
      smasTotal: signal.bear?.total ?? 0,
      wasExtendedRecently: !!signal.checks?.wasLowerRecently,
      atSma: !!signal.checks?.at100Sma,
      patternA: !!p.shootingStar,
      patternB: !!p.rallyStreak,
      volumeOk: !!p.volumeOk,
      recentExtreme: signal.minRecentBelow100,
      doubleBottom: false,
    };
  }
  return {
    smas: signal.bull?.above ?? 0,
    smasTotal: signal.bull?.total ?? 0,
    wasExtendedRecently: !!signal.checks?.wasHigherRecently,
    atSma: !!signal.checks?.at100Sma,
    patternA: !!p.hammer,
    patternB: !!p.pullbackStreak,
    volumeOk: !!p.volumeOk,
    recentExtreme: signal.maxRecentAbove100,
    doubleBottom: signal.doubleBottom?.state === "current",
  };
}

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
  if (isShort()) {
    if (value < 0) return "positive";
    if (value > 0) return "negative";
    return "neutral";
  }
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function signalClass(label) {
  if (label.startsWith("Pullback")) return "pullback";
  if (label.startsWith("Rally")) return "rally";
  if (label.startsWith("Bounce")) return "bounce";
  if (label.startsWith("Near 100")) return "near-100";
  if (label.startsWith("Near 200")) return "near-200";
  if (label === "Trend OK") return "trend-ok";
  if (label === "Extended") return "extended";
  if (label === "Extended down") return "extended-down";
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
  const cp = copy();
  const m = signalMetrics(signal);
  const wasExt = isShort() ? c.wasLowerRecently : c.wasHigherRecently;
  return `
    <td class="check-cell" title="${cp.trendTitle}">${checkMark(c.trendOk)}</td>
    <td class="check-cell" title="${cp.atSmaTitle}">${checkMark(m.atSma)}</td>
    <td class="check-cell" title="${cp.wasExtTitle}">${checkMark(wasExt)}</td>
  `;
}

function smaCell(stock, pct, focus = false) {
  const m = signalMetrics(stock.signal);
  const highlight = focus && (stock.signal.watch || m.atSma);
  return `<td class="sma-cell ${pctClass(pct)}${highlight ? " pullback-focus" : ""}${focus ? "" : " detail-col"}">${fmtPct(pct)}</td>`;
}

function dbTitle(db) {
  const state = db?.state ?? "false";
  if (state === "current") {
    return db.breakout
      ? `Double bottom — breaking out through the neckline ${db.neckline} now (on the last leg)`
      : `Double bottom — reclaiming the neckline ${db.neckline} now (on the last leg)`;
  }
  if (state === "occurred") {
    const n = db?.barsSinceBreakout;
    const ago = n === 0 ? "today" : `${n} bar${n === 1 ? "" : "s"} ago`;
    return `Double bottom — broke out ${ago} (neckline ${db.neckline}); no longer on the last leg`;
  }
  return "No double bottom on the last leg";
}

function dbMark(db) {
  const state = db?.state ?? "false";
  if (state === "current") return `<span class="check ok db-current">✓</span>`;
  if (state === "occurred") return `<span class="check db-occurred">●</span>`;
  return `<span class="check no">·</span>`;
}

function renderPatternChecks(signal) {
  if (isSimple()) return "";
  const cp = copy();
  const m = signalMetrics(signal);
  const db = signal.doubleBottom;
  const patternA = `<td class="check-cell detail-col" title="${cp.patternATitle}">${checkMark(m.patternA)}</td>`;
  const patternB = `<td class="check-cell detail-col" title="${cp.patternBTitle}">${checkMark(m.patternB)}</td>`;
  const vol = `<td class="check-cell detail-col" title="${cp.volTitle}">${checkMark(m.volumeOk)}</td>`;
  const dbCell = isShort()
    ? ""
    : `<td class="check-cell detail-col long-only-col" title="${dbTitle(db)}">${dbMark(db)}</td>`;
  return patternA + patternB + vol + dbCell;
}

function levelCells(signal) {
  if (isSimple()) return "";
  const lv = signal.levels;
  const cp = copy();
  if (!lv) {
    return `<td class="lvl detail-col">—</td><td class="lvl detail-col">—</td><td class="lvl detail-col">—</td>`;
  }
  const stopTitle = `Stop ${fmtMoney(lv.stop)} (${lv.riskPct}% risk)`;
  const tgtTitle = `Target ${fmtMoney(lv.target)} (${lv.rr}× risk)`;
  return (
    `<td class="lvl lvl-stop detail-col" title="${stopTitle}">${fmtMoney(lv.stop)}</td>` +
    `<td class="lvl lvl-target detail-col" title="${tgtTitle}">${fmtMoney(lv.target)}</td>` +
    `<td class="lvl lvl-gain detail-col" title="${cp.gainTitle}">+${lv.rewardPct.toFixed(1)}%</td>`
  );
}

function renderRow(stock) {
  const c = stock.comparison;
  const s = stock.signal;
  const m = signalMetrics(s);
  const cp = copy();
  const rowClass = `${s.watch ? "stock-row watch-row" : "stock-row"}${stock.pinned ? " pinned-row" : ""}`;
  const star = stock.pinned ? "★" : "☆";
  const pinTitle = stock.pinned ? "Remove from your watchlist" : "Add to your watchlist";
  const recentCell = isSimple()
    ? ""
    : `<td class="recent-high detail-col" title="${cp.recentExtTitle}">${fmtPct(m.recentExtreme)}</td>`;
  return `
    <tr class="${rowClass}" data-href="/stock?symbol=${encodeURIComponent(stock.symbol)}">
      <td class="stock-name">
        <button class="pin-toggle ${stock.pinned ? "on" : ""}" data-symbol="${stock.symbol}" data-name="${escapeAttr(stock.name)}" title="${pinTitle}">${star}</button>
        <span class="sym">${stock.symbol}</span>
        <span class="name">${stock.name}</span>
      </td>
      <td>${fmtMoney(stock.price)}</td>
      ${smaCell(stock, c["1d"].vs_sma100_pct, !isSimple())}
      ${smaCell(stock, c["1d"].vs_sma200_pct, isSimple())}
      ${smaCell(stock, c["1wk"].vs_sma100_pct)}
      ${smaCell(stock, c["1wk"].vs_sma200_pct)}
      ${smaCell(stock, c["1mo"].vs_sma100_pct)}
      ${smaCell(stock, c["1mo"].vs_sma200_pct)}
      <td class="score trend-score detail-col" title="${cp.smasTitle}">${m.smas}/${m.smasTotal}</td>
      ${renderChecks(s)}
      ${renderPatternChecks(s)}
      ${recentCell}
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

function updateViewUI() {
  const cp = copy();
  document.body.dataset.view = isSimple() ? "simple" : "full";
  document.body.dataset.direction = isSimple() ? "long" : direction;
  document.getElementById("page-title").textContent = cp.pageTitle;
  document.getElementById("scan-scope").textContent = cp.scanScope;
  document.getElementById("panel-title").textContent = cp.panelTitle;
  document.getElementById("setup-group-head").textContent = cp.setupGroup;
  document.getElementById("smas-head").textContent = cp.smasHead;
  document.getElementById("trend-head").title = cp.trendTitle;
  document.getElementById("at-sma-head").textContent = cp.atSmaHead;
  document.getElementById("at-sma-head").title = cp.atSmaTitle;
  document.getElementById("was-ext-head").textContent = cp.wasExtHead;
  document.getElementById("was-ext-head").title = cp.wasExtTitle;
  const volHead = document.querySelector('[data-sort="volumeOk"]');
  if (volHead) volHead.title = cp.volTitle;
  const recentHead = document.getElementById("recent-ext-head");
  if (recentHead) recentHead.textContent = cp.recentExtHead;
  const stopHead = document.getElementById("stop-head");
  if (stopHead) stopHead.title = cp.stopTitle;
  const gainHead = document.getElementById("gain-head");
  if (gainHead) gainHead.title = cp.gainTitle;

  const signalFilter = document.getElementById("signal-filter");
  const prev = signalFilter.value;
  signalFilter.innerHTML = cp.signalOptions
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
  if (cp.signalOptions.some(([value]) => value === prev)) signalFilter.value = prev;
  else signalFilter.value = "";

  document.getElementById("direction-toggle").hidden = isSimple();
  document.getElementById("filter-simple").checked = isSimple();
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
  const m = signalMetrics(s);

  const nums = {
    price: stock.price,
    d100: c["1d"].vs_sma100_pct,
    d200: c["1d"].vs_sma200_pct,
    w100: c["1wk"].vs_sma100_pct,
    w200: c["1wk"].vs_sma200_pct,
    m100: c["1mo"].vs_sma100_pct,
    m200: c["1mo"].vs_sma200_pct,
    smas: m.smas,
    recentExtreme: m.recentExtreme,
    gain: s.levels?.rewardPct,
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
  if (f.signal && signalClass(s.label) !== f.signal) {
    return false;
  }

  const boolByKey = {
    trendOk: s.checks.trendOk,
    atSma: m.atSma,
    wasExtendedRecently: m.wasExtendedRecently,
    patternA: m.patternA,
    patternB: m.patternB,
    volumeOk: m.volumeOk,
    doubleBottom: m.doubleBottom,
  };
  for (const k in boolByKey) {
    if (f[`chk_${k}`] && !boolByKey[k]) return false;
  }

  if (f.watchOnly && !s.watch) return false;
  return true;
}

function getSort() {
  return Store.getFilters().__sort || null;
}
function setSort(sort) {
  const f = Store.getFilters();
  if (sort) f.__sort = sort;
  else delete f.__sort;
  Store.setFilters(f);
}

function sortValue(stock, key) {
  const c = stock.comparison;
  const s = stock.signal;
  const m = signalMetrics(s);
  switch (key) {
    case "text": return stock.symbol;
    case "price": return stock.price;
    case "d100": return c["1d"].vs_sma100_pct;
    case "d200": return c["1d"].vs_sma200_pct;
    case "w100": return c["1wk"].vs_sma100_pct;
    case "w200": return c["1wk"].vs_sma200_pct;
    case "m100": return c["1mo"].vs_sma100_pct;
    case "m200": return c["1mo"].vs_sma200_pct;
    case "smas": return m.smas;
    case "recentExtreme": return m.recentExtreme;
    case "stop": return s.levels?.stop;
    case "target": return s.levels?.target;
    case "gain": return s.levels?.rewardPct;
    case "signal": return s.score;
    case "trendOk": return s.checks.trendOk ? 1 : 0;
    case "atSma":
    case "at100Sma":
    case "at200Sma":
      return m.atSma ? 1 : 0;
    case "wasExtendedRecently": return m.wasExtendedRecently ? 1 : 0;
    case "patternA": return m.patternA ? 1 : 0;
    case "patternB": return m.patternB ? 1 : 0;
    case "volumeOk": return m.volumeOk ? 1 : 0;
    case "doubleBottom": {
      const st = s.doubleBottom?.state;
      return st === "current" ? 2 : st === "occurred" ? 1 : 0;
    }
    default: return null;
  }
}

function compareBy(a, b, key, dir) {
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  const na = va == null || Number.isNaN(va);
  const nb = vb == null || Number.isNaN(vb);
  if (na && nb) return 0;
  if (na) return 1;
  if (nb) return -1;
  const r = typeof va === "string" ? va.localeCompare(vb) : va - vb;
  return dir === "asc" ? r : -r;
}

function updateSortIndicators() {
  const sort = getSort();
  document.querySelectorAll(".th-label[data-sort]").forEach((el) => {
    const active = sort && sort.key === el.dataset.sort;
    el.classList.toggle("sort-active", active);
    el.dataset.dir = active ? sort.dir : "";
  });
}

function wireSort() {
  document.querySelectorAll(".th-label[data-sort]").forEach((el) => {
    el.classList.add("sortable");
    el.addEventListener("click", () => {
      const key = el.dataset.sort;
      const cur = getSort();
      let next;
      if (!cur || cur.key !== key) next = { key, dir: "desc" };
      else if (cur.dir === "desc") next = { key, dir: "asc" };
      else next = null;
      setSort(next);
      render();
    });
  });
}

function render() {
  const f = Store.getFilters();
  let rows = allStocks.filter((s) => passesFilters(s, f));
  const sort = getSort();
  if (sort) rows = rows.slice().sort((a, b) => compareBy(a, b, sort.key, sort.dir));
  updateSortIndicators();
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
    const res = await fetch(
      `/api/analyze?symbols=${encodeURIComponent(syms.join(","))}&direction=${direction}&view=${viewParam()}`
    );
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
      fetch(`/api/overview?direction=${direction}&view=${viewParam()}`).then((r) => {
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

  document.querySelectorAll(".col-filter").forEach((inp) => {
    const k = inp.dataset.key;
    const isNum = inp.dataset.type === "num";
    if (filters[k] != null) inp.value = filters[k];
    const onChange = () => {
      const f = Store.getFilters();
      const v = String(inp.value).trim();
      if (v === "") delete f[k];
      else f[k] = isNum ? Number(v) : v;
      Store.setFilters(f);
      render();
    };
    inp.addEventListener("input", onChange);
    inp.addEventListener("change", onChange);
  });

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

function wireDirectionToggle() {
  document.querySelectorAll("#direction-toggle .dir-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.direction === "short" ? "short" : "long";
      if (next === direction) return;
      direction = next;
      Store.setDirection(direction);
      updateViewUI();
      setStatus("Loading…", "loading");
      refresh();
    });
  });
}

function wireSimpleToggle() {
  const box = document.getElementById("filter-simple");
  box.checked = simple;
  box.addEventListener("change", () => {
    simple = box.checked;
    Store.setSimple(simple);
    if (simple) direction = "long";
    updateViewUI();
    setStatus("Loading…", "loading");
    refresh();
  });
}

updateViewUI();
wireSimpleToggle();
wireDirectionToggle();
wireFilters();
wireSort();
refresh();
setInterval(refresh, REFRESH_MS);

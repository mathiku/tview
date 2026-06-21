/** Stock scanning, SMA analysis, and pullback scoring. */
import { analyzePatterns, analyzeShortPatterns, patternLabel, shortPatternLabel } from "./patterns.js";
import {
  BIG_STOCKS,
  BIG_STOCK_BY_SYMBOL,
  RANDOM_SCAN_COUNT,
  dailySeed,
  pickRandomBigStocks,
} from "./universe.js";
import { loadPinned, lookupName } from "./pinned.js";

export { BIG_STOCKS as TOP_STOCKS };

export const DEFAULT_SYMBOL = BIG_STOCKS[0].symbol;

export const INTERVALS = {
  "1d": { label: "Daily" },
  "1wk": { label: "Weekly" },
  "1mo": { label: "Monthly" },
};

export function rollingSma(values, window) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

export function pctVs(price, sma) {
  if (price == null || sma == null || sma === 0) return null;
  return round2((price / sma - 1) * 100);
}

export function withSmas(rows) {
  const closes = rows.map((r) => r.close);
  const sma100 = rollingSma(closes, 100);
  const sma200 = rollingSma(closes, 200);

  return rows.map((row, i) => {
    const point = { time: row.time, close: round2(row.close) };
    if (sma100[i] != null) point.sma100 = round2(sma100[i]);
    if (sma200[i] != null) point.sma200 = round2(sma200[i]);
    return point;
  });
}

function weekKey(unixSec) {
  const d = new Date(unixSec * 1000);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day - yearStart) / 86400000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthKey(unixSec) {
  const d = new Date(unixSec * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function resample(rows, mode) {
  const buckets = new Map();

  for (const row of rows) {
    const key = mode === "1wk" ? weekKey(row.time) : monthKey(row.time);
    buckets.set(key, row);
  }

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

export async function fetchSymbolMeta(symbol) {
  const period2 = Math.floor(Date.now() / 1000);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1d&period1=0&period2=${period2}&includePrePost=false`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);

  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`Unknown symbol: ${symbol}`);

  const meta = result.meta || {};
  return {
    symbol: (meta.symbol || symbol).toUpperCase(),
    name: meta.shortName || meta.longName || lookupName(symbol) || symbol,
  };
}

export async function fetchDailyRows(symbol, { period2 = Math.floor(Date.now() / 1000) } = {}) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1d&period1=0&period2=${period2}&includePrePost=false`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);

  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`No chart data returned for ${symbol}`);

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  const rows = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    const open = opens[i];
    const high = highs[i];
    const low = lows[i];
    if (close == null || Number.isNaN(close)) continue;
    if (open == null || high == null || low == null) continue;
    rows.push({
      time: timestamps[i],
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
      volume: volumes[i] ?? 0,
    });
  }
  return rows;
}

export function buildSeries(dailyRows, intervalKey) {
  let rows = dailyRows;
  if (intervalKey === "1wk") rows = resample(dailyRows, "1wk");
  if (intervalKey === "1mo") rows = resample(dailyRows, "1mo");
  return withSmas(rows);
}

function latestFromSeries(data) {
  if (!data.length) return { price: null, sma100: null, sma200: null };
  const last = data[data.length - 1];
  return {
    price: last.close,
    sma100: last.sma100 ?? null,
    sma200: last.sma200 ?? null,
  };
}

export function buildComparison(dailyRows) {
  const comparison = {};

  for (const [key, cfg] of Object.entries(INTERVALS)) {
    const data = buildSeries(dailyRows, key);
    const latest = latestFromSeries(data);

    comparison[key] = {
      label: cfg.label,
      price: latest.price,
      sma100: latest.sma100,
      sma200: latest.sma200,
      vs_sma100_pct: pctVs(latest.price, latest.sma100),
      vs_sma200_pct: pctVs(latest.price, latest.sma200),
    };
  }

  return comparison;
}

export const PULLBACK_NEAR_PCT = 3;
export const PULLBACK_RECENT_DAYS = 20;
export const PULLBACK_MIN_PRIOR_ABOVE_PCT = 5;
export const PULLBACK_MIN_BULL_CHECKS = 5;

function bullChecks(comparison) {
  const checks = [];
  for (const key of ["1d", "1wk", "1mo"]) {
    const row = comparison[key];
    if (row.vs_sma100_pct != null) {
      checks.push({ key, sma: "100", above: row.vs_sma100_pct > 0 });
    }
    if (row.vs_sma200_pct != null) {
      checks.push({ key, sma: "200", above: row.vs_sma200_pct > 0 });
    }
  }
  return checks;
}

function bearChecks(comparison) {
  const checks = [];
  for (const key of ["1d", "1wk", "1mo"]) {
    const row = comparison[key];
    if (row.vs_sma100_pct != null) {
      checks.push({ key, sma: "100", below: row.vs_sma100_pct < 0 });
    }
    if (row.vs_sma200_pct != null) {
      checks.push({ key, sma: "200", below: row.vs_sma200_pct < 0 });
    }
  }
  return checks;
}

/** Uptrend intact + daily tag of 100 SMA after a recent stretch higher. */
export function scorePullback(dailyRows, comparison) {
  const dailyData = buildSeries(dailyRows, "1d");
  const bullishChecks = bullChecks(comparison);
  const bullAbove = bullishChecks.filter((c) => c.above).length;
  const bullTotal = bullishChecks.length;

  const dailyVs100 = comparison["1d"].vs_sma100_pct;
  const wk200 = comparison["1wk"].vs_sma200_pct;
  const mo200 = comparison["1mo"].vs_sma200_pct;

  const trendOk =
    (wk200 != null && wk200 > 0 && mo200 != null && mo200 > 0) ||
    bullAbove >= PULLBACK_MIN_BULL_CHECKS;

  const at100Sma =
    dailyVs100 != null &&
    dailyVs100 <= PULLBACK_NEAR_PCT &&
    dailyVs100 >= -PULLBACK_NEAR_PCT;

  let maxRecentAbove100 = null;
  let wasHigherRecently = false;
  const recentSlice = dailyData.slice(-PULLBACK_RECENT_DAYS - 1, -1);

  for (const point of recentSlice) {
    const pct = pctVs(point.close, point.sma100);
    if (pct == null) continue;
    if (maxRecentAbove100 == null || pct > maxRecentAbove100) {
      maxRecentAbove100 = pct;
    }
    if (pct >= PULLBACK_MIN_PRIOR_ABOVE_PCT) wasHigherRecently = true;
  }

  const watch = trendOk && at100Sma && wasHigherRecently;
  const patterns = analyzePatterns(dailyRows, { at100Sma });

  let score = 0;
  if (watch) {
    score = 100 + bullAbove;
    if (dailyVs100 >= 0) score += 2;
    else if (dailyVs100 >= -1) score += 1;
    score += Math.max(0, PULLBACK_NEAR_PCT - Math.abs(dailyVs100));
    if (patterns.hammerAt100) score += 8;
    else if (patterns.hammer) score += 5;
    if (patterns.pullbackStreak) score += 6;
    if (patterns.volumeOk) score += 4;
  } else {
    if (trendOk) score += 30;
    if (at100Sma) score += 20;
    if (wasHigherRecently) score += 10;
    score += bullAbove;
    if (at100Sma && patterns.count) score += patterns.count * 2;
  }

  const patternTag = patternLabel(patterns);

  let label = "Weak trend";
  if (watch) {
    if (patternTag) {
      label = `Pullback · ${patternTag}`;
    } else if (dailyVs100 < 0) {
      label = "Pullback · at 100";
    } else if (dailyVs100 <= 1) {
      label = "Pullback · touch";
    } else {
      label = "Pullback · near 100";
    }
  } else if (trendOk && at100Sma) {
    label = patternTag ? `Near 100 · ${patternTag}` : "Near 100 · no dip";
  } else if (trendOk && wasHigherRecently) {
    label = "Trend OK";
  } else if (bullAbove >= PULLBACK_MIN_BULL_CHECKS) {
    label = "Extended";
  } else if (bullAbove >= 3) {
    label = "Mixed";
  }

  return {
    watch,
    score,
    label,
    bull: { above: bullAbove, total: bullTotal },
    dailyVs100,
    maxRecentAbove100: maxRecentAbove100 != null ? round2(maxRecentAbove100) : null,
    checks: {
      trendOk,
      at100Sma,
      wasHigherRecently,
    },
    patterns,
  };
}

/** Evaluate pullback setup as-of the latest bar in dailyRows (no look-ahead). */
export function evaluatePullback(dailyRows) {
  if (dailyRows.length < 200) return null;
  const comparison = buildComparison(dailyRows);
  const signal = scorePullback(dailyRows, comparison);
  return { ...signal, side: "long" };
}

/** Downtrend intact + daily tag of 100 SMA after a recent stretch lower. */
export function scoreRallyShort(dailyRows, comparison) {
  const dailyData = buildSeries(dailyRows, "1d");
  const bearishChecks = bearChecks(comparison);
  const bearBelow = bearishChecks.filter((c) => c.below).length;
  const bearTotal = bearishChecks.length;

  const dailyVs100 = comparison["1d"].vs_sma100_pct;
  const wk200 = comparison["1wk"].vs_sma200_pct;
  const mo200 = comparison["1mo"].vs_sma200_pct;

  const trendOk =
    (wk200 != null && wk200 < 0 && mo200 != null && mo200 < 0) ||
    bearBelow >= PULLBACK_MIN_BULL_CHECKS;

  const at100Sma =
    dailyVs100 != null &&
    dailyVs100 <= PULLBACK_NEAR_PCT &&
    dailyVs100 >= -PULLBACK_NEAR_PCT;

  let minRecentBelow100 = null;
  let wasLowerRecently = false;
  const recentSlice = dailyData.slice(-PULLBACK_RECENT_DAYS - 1, -1);

  for (const point of recentSlice) {
    const pct = pctVs(point.close, point.sma100);
    if (pct == null) continue;
    if (minRecentBelow100 == null || pct < minRecentBelow100) {
      minRecentBelow100 = pct;
    }
    if (pct <= -PULLBACK_MIN_PRIOR_ABOVE_PCT) wasLowerRecently = true;
  }

  const watch = trendOk && at100Sma && wasLowerRecently;
  const patterns = analyzeShortPatterns(dailyRows, { at100Sma });

  let score = 0;
  if (watch) {
    score = 100 + bearBelow;
    if (dailyVs100 <= 0) score += 2;
    else if (dailyVs100 <= 1) score += 1;
    score += Math.max(0, PULLBACK_NEAR_PCT - Math.abs(dailyVs100));
    if (patterns.shootingStarAt100) score += 8;
    else if (patterns.shootingStar) score += 5;
    if (patterns.rallyStreak) score += 6;
    if (patterns.volumeOk) score += 4;
  } else {
    if (trendOk) score += 30;
    if (at100Sma) score += 20;
    if (wasLowerRecently) score += 10;
    score += bearBelow;
    if (at100Sma && patterns.count) score += patterns.count * 2;
  }

  const patternTag = shortPatternLabel(patterns);

  let label = "Weak trend";
  if (watch) {
    if (patternTag) {
      label = `Rally · ${patternTag}`;
    } else if (dailyVs100 > 0) {
      label = "Rally · at 100";
    } else if (dailyVs100 >= -1) {
      label = "Rally · touch";
    } else {
      label = "Rally · near 100";
    }
  } else if (trendOk && at100Sma) {
    label = patternTag ? `Near 100 · ${patternTag}` : "Near 100 · no bounce";
  } else if (trendOk && wasLowerRecently) {
    label = "Trend OK";
  } else if (bearBelow >= PULLBACK_MIN_BULL_CHECKS) {
    label = "Extended down";
  } else if (bearBelow >= 3) {
    label = "Mixed";
  }

  return {
    watch,
    score,
    label,
    bear: { below: bearBelow, total: bearTotal },
    dailyVs100,
    minRecentBelow100: minRecentBelow100 != null ? round2(minRecentBelow100) : null,
    checks: {
      trendOk,
      at100Sma,
      wasLowerRecently,
    },
    patterns,
  };
}

/** Evaluate short rally setup as-of the latest bar (no look-ahead). */
export function evaluateRallyShort(dailyRows) {
  if (dailyRows.length < 200) return null;
  const comparison = buildComparison(dailyRows);
  const signal = scoreRallyShort(dailyRows, comparison);
  return { ...signal, side: "short" };
}

/** Back-compat helper when only comparison data is available. */
export function longSignal(comparison) {
  const checks = [];
  for (const key of ["1d", "1wk", "1mo"]) {
    const row = comparison[key];
    if (row.vs_sma100_pct != null) checks.push(row.vs_sma100_pct > 0);
    if (row.vs_sma200_pct != null) checks.push(row.vs_sma200_pct > 0);
  }
  const above = checks.filter(Boolean).length;
  const total = checks.length;
  let label = "Neutral";
  if (total > 0 && above === total) label = "Strong LONG";
  else if (above >= total - 1 && above >= 4) label = "LONG";
  else if (above >= Math.ceil(total / 2)) label = "Lean LONG";
  else if (above <= 1) label = "Avoid LONG";
  return { above, total, label };
}

const cache = new Map();
const overviewCache = { at: 0, payload: null, universeKey: null };
const CACHE_MS = 30_000;
const FETCH_CONCURRENCY = 6;

let activeUniverse = [];
let activeUniverseKey = "";
let pinnedSymbolsCache = new Set();

export function clearOverviewCache() {
  overviewCache.at = 0;
  overviewCache.payload = null;
  overviewCache.universeKey = null;
}

export async function buildScanUniverse() {
  const pinned = await loadPinned();
  pinnedSymbolsCache = new Set(pinned.map((s) => s.symbol));
  const pinnedSymbols = pinned.map((s) => s.symbol);
  const random = pickRandomBigStocks(pinnedSymbols, RANDOM_SCAN_COUNT, dailySeed());

  const seen = new Set();
  const universe = [];

  for (const stock of pinned) {
    if (seen.has(stock.symbol)) continue;
    seen.add(stock.symbol);
    universe.push({ ...stock, pinned: true });
  }

  for (const stock of random) {
    if (seen.has(stock.symbol)) continue;
    seen.add(stock.symbol);
    universe.push({ ...stock, pinned: false });
  }

  const key = `${dailySeed()}:${universe.map((s) => s.symbol).join(",")}`;
  activeUniverse = universe;
  activeUniverseKey = key;

  return {
    universe,
    pinnedCount: pinned.length,
    randomCount: universe.length - pinned.length,
    poolSize: BIG_STOCKS.length,
    scanDate: dailySeed(),
  };
}

async function getActiveUniverse() {
  const meta = await buildScanUniverse();
  return meta.universe;
}

export function isAllowedSymbol(symbol) {
  const upper = symbol.toUpperCase();
  if (pinnedSymbolsCache.has(upper)) return true;
  if (activeUniverse.some((s) => s.symbol === upper)) return true;
  if (BIG_STOCK_BY_SYMBOL.has(upper)) return true;
  return false;
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const idx = next++;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (err) {
        console.error(`Failed ${items[idx].symbol ?? items[idx]}:`, err.message);
        results[idx] = null;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results.filter(Boolean);
}

async function loadStockAnalysis(symbol) {
  const now = Date.now();
  const cached = cache.get(symbol);
  if (cached && now - cached.at < CACHE_MS) {
    return {
      comparison: cached.comparison,
      signal: cached.signal,
    };
  }

  const dailyRows = await fetchDailyRows(symbol);
  const comparison = buildComparison(dailyRows);
  const signal = scorePullback(dailyRows, comparison);

  cache.set(symbol, {
    at: now,
    comparison,
    dailyRows,
    signal,
  });

  return { comparison, signal };
}

export async function getPayload(symbol) {
  const now = Date.now();
  const cached = cache.get(symbol);
  if (cached?.payload && now - cached.at < CACHE_MS) return cached.payload;

  const dailyRows = cached?.dailyRows ?? (await fetchDailyRows(symbol));
  const comparison = buildComparison(dailyRows);
  const charts = {};

  for (const [key, cfg] of Object.entries(INTERVALS)) {
    charts[key] = {
      label: cfg.label,
      data: buildSeries(dailyRows, key),
    };
  }

  const stock =
    activeUniverse.find((s) => s.symbol === symbol) ?? BIG_STOCK_BY_SYMBOL.get(symbol);
  const payload = {
    symbol,
    name: stock?.name ?? symbol,
    updated_at: new Date().toISOString(),
    charts,
    comparison,
  };

  cache.set(symbol, { at: now, comparison, dailyRows, payload });
  return payload;
}

export async function getOverview() {
  const now = Date.now();
  const scanMeta = await buildScanUniverse();
  const { universe, pinnedCount, randomCount, poolSize } = scanMeta;

  if (
    overviewCache.payload &&
    now - overviewCache.at < CACHE_MS &&
    overviewCache.universeKey === activeUniverseKey
  ) {
    return overviewCache.payload;
  }

  const stocks = await mapPool(universe, FETCH_CONCURRENCY, async (stock) => {
    const { comparison, signal } = await loadStockAnalysis(stock.symbol);
    return {
      symbol: stock.symbol,
      name: stock.name,
      pinned: stock.pinned,
      price: comparison["1d"].price,
      comparison,
      signal,
    };
  });

  stocks.sort((a, b) => {
    if (Number(b.pinned) !== Number(a.pinned)) return Number(b.pinned) - Number(a.pinned);
    if (Number(b.signal.watch) !== Number(a.signal.watch)) {
      return Number(b.signal.watch) - Number(a.signal.watch);
    }
    const patDiff = (b.signal.patterns?.count ?? 0) - (a.signal.patterns?.count ?? 0);
    if (patDiff !== 0) return patDiff;
    if (b.signal.score !== a.signal.score) return b.signal.score - a.signal.score;
    return a.symbol.localeCompare(b.symbol);
  });

  const payload = {
    updated_at: new Date().toISOString(),
    total: stocks.length,
    scanned: universe.length,
    pinnedCount,
    randomCount,
    poolSize,
    stocks,
  };

  overviewCache.at = now;
  overviewCache.payload = payload;
  overviewCache.universeKey = activeUniverseKey;
  return payload;
}

export async function getStocksForPicker() {
  const universe = await getActiveUniverse();
  return universe.map(({ symbol, name, pinned }) => ({ symbol, name, pinned }));
}

export function resolveSymbol(raw) {
  const symbol = (raw || DEFAULT_SYMBOL).toUpperCase();
  if (isAllowedSymbol(symbol)) return symbol;
  if (activeUniverse.length) return activeUniverse[0].symbol;
  return DEFAULT_SYMBOL;
}

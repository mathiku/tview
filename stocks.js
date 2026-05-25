/** Top 15 US stocks by approximate market cap. */
export const TOP_STOCKS = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "AMZN", name: "Amazon" },
  { symbol: "META", name: "Meta" },
  { symbol: "BRK-B", name: "Berkshire" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "JPM", name: "JPMorgan" },
  { symbol: "V", name: "Visa" },
  { symbol: "UNH", name: "UnitedHealth" },
  { symbol: "WMT", name: "Walmart" },
  { symbol: "MA", name: "Mastercard" },
  { symbol: "XOM", name: "Exxon Mobil" },
  { symbol: "NFLX", name: "Netflix" },
];

export const DEFAULT_SYMBOL = TOP_STOCKS[0].symbol;

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

export async function fetchDailyRows(symbol) {
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
  if (!result) throw new Error(`No chart data returned for ${symbol}`);

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  const rows = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || Number.isNaN(close)) continue;
    rows.push({ time: timestamps[i], close });
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

const DIP_LOOKBACK = {
  "1d": 252,
  "1wk": 52,
  "1mo": 36,
};

function pctHistory(data, smaKey) {
  const history = [];
  for (const point of data) {
    const sma = point[smaKey];
    if (sma == null) continue;
    history.push(pctVs(point.close, sma));
  }
  return history;
}

/** Below SMA, or unusually close vs recent history → dip buy opportunity. */
function isDip(current, history, lookback) {
  if (current == null) return false;
  if (current < 0) return true;

  const recent = history.slice(-lookback).filter((p) => p != null);
  const above = recent.filter((p) => p > 0);
  if (above.length < 20) return false;

  above.sort((a, b) => a - b);
  const p25 = above[Math.floor(above.length * 0.25)];
  const median = above[Math.floor(above.length * 0.5)];

  return current <= p25 || current < median * 0.4;
}

function dipChecksForSeries(data, lookback) {
  const hist100 = pctHistory(data, "sma100");
  const hist200 = pctHistory(data, "sma200");
  const last = data[data.length - 1];
  const checks = [];

  if (last?.sma100 != null) {
    checks.push({
      key: "sma100",
      dip: isDip(pctVs(last.close, last.sma100), hist100, lookback),
    });
  }
  if (last?.sma200 != null) {
    checks.push({
      key: "sma200",
      dip: isDip(pctVs(last.close, last.sma200), hist200, lookback),
    });
  }

  return checks;
}

export function scoreSignal(dailyRows, comparison) {
  const bullishChecks = [];

  for (const key of ["1d", "1wk", "1mo"]) {
    const row = comparison[key];
    if (row.vs_sma100_pct != null) {
      bullishChecks.push({ key, sma: "100", above: row.vs_sma100_pct > 0 });
    }
    if (row.vs_sma200_pct != null) {
      bullishChecks.push({ key, sma: "200", above: row.vs_sma200_pct > 0 });
    }
  }

  const dipChecks = [];
  for (const key of ["1d", "1wk", "1mo"]) {
    const data = buildSeries(dailyRows, key);
    for (const check of dipChecksForSeries(data, DIP_LOOKBACK[key])) {
      dipChecks.push({ key, sma: check.key === "sma100" ? "100" : "200", dip: check.dip });
    }
  }

  const bullAbove = bullishChecks.filter((c) => c.above).length;
  const bullTotal = bullishChecks.length;
  const dipAbove = dipChecks.filter((c) => c.dip).length;
  const dipTotal = dipChecks.length;
  const total = bullAbove + dipAbove;
  const maxTotal = bullTotal + dipTotal;

  let label = "Neutral";
  if (bullAbove >= 5 && dipAbove >= 3) label = "Strong BUY";
  else if (bullAbove === bullTotal && dipAbove >= 2) label = "LONG · Dip";
  else if (bullAbove === bullTotal) label = "Strong LONG";
  else if (bullAbove >= 4 && dipAbove >= 3) label = "Dip BUY";
  else if (bullAbove >= 5) label = "LONG";
  else if (bullAbove >= Math.ceil(bullTotal / 2)) label = "Lean LONG";
  else if (bullAbove <= 1) label = "Avoid LONG";

  return {
    bull: { above: bullAbove, total: bullTotal },
    dip: { above: dipAbove, total: dipTotal },
    total,
    maxTotal,
    label,
    dipChecks,
    bullishChecks,
  };
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
const overviewCache = { at: 0, payload: null };
const CACHE_MS = 30_000;

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
  const signal = scoreSignal(dailyRows, comparison);

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

  const stock = TOP_STOCKS.find((s) => s.symbol === symbol);
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
  if (overviewCache.payload && now - overviewCache.at < CACHE_MS) {
    return overviewCache.payload;
  }

  const stocks = await Promise.all(
    TOP_STOCKS.map(async (stock) => {
      const { comparison, signal } = await loadStockAnalysis(stock.symbol);
      return {
        symbol: stock.symbol,
        name: stock.name,
        price: comparison["1d"].price,
        comparison,
        signal,
      };
    })
  );

  stocks.sort((a, b) => {
    if (b.signal.total !== a.signal.total) return b.signal.total - a.signal.total;
    if (b.signal.dip.above !== a.signal.dip.above) return b.signal.dip.above - a.signal.dip.above;
    if (b.signal.bull.above !== a.signal.bull.above) return b.signal.bull.above - a.signal.bull.above;
    return a.symbol.localeCompare(b.symbol);
  });

  const payload = {
    updated_at: new Date().toISOString(),
    stocks,
  };

  overviewCache.at = now;
  overviewCache.payload = payload;
  return payload;
}

export function resolveSymbol(raw) {
  const symbol = (raw || DEFAULT_SYMBOL).toUpperCase();
  const allowed = TOP_STOCKS.some((s) => s.symbol === symbol);
  return allowed ? symbol : DEFAULT_SYMBOL;
}

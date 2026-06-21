import { fetchDailyRows } from "../../tview/stocks.js";
import { readCached, writeCached } from "./cache.js";

const FETCH_CONCURRENCY = 4;

function unixToIso(unixSec) {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

export async function loadSymbolHistory(symbol, { refresh = false } = {}) {
  const upper = symbol.toUpperCase();
  const cached = await readCached(upper);

  if (!refresh && cached?.rows?.length) return cached.rows;

  try {
    const rows = await fetchDailyRows(upper);
    await writeCached(upper, {
      symbol: upper,
      fetchedAt: new Date().toISOString(),
      rows,
    });
    return rows;
  } catch (err) {
    if (cached?.rows?.length) return cached.rows;
    throw err;
  }
}

export async function loadUniverseHistory(symbols, { refresh = false, onProgress } = {}) {
  const results = new Map();
  let done = 0;

  async function loadOne(symbol) {
    try {
      const rows = await loadSymbolHistory(symbol, { refresh });
      results.set(symbol.toUpperCase(), rows);
    } catch (err) {
      console.error(`  skip ${symbol}: ${err.message}`);
    } finally {
      done++;
      onProgress?.({ done, total: symbols.length, symbol });
    }
  }

  let next = 0;
  async function worker() {
    while (next < symbols.length) {
      const idx = next++;
      await loadOne(symbols[idx]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, symbols.length) }, () => worker())
  );

  return results;
}

export function filterRowsByDate(rows, { startDate, endDate }) {
  const startUnix = startDate ? Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000) : null;
  const endUnix = endDate ? Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000) : null;

  return rows.filter((row) => {
    if (startUnix != null && row.time < startUnix) return false;
    if (endUnix != null && row.time > endUnix) return false;
    return true;
  });
}

export function rowDate(row) {
  return unixToIso(row.time);
}

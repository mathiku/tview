/**
 * Disk cache for the tview scanner.
 *
 * - overview.json  — the last computed overview payload + its sessionKey. Committed
 *   as a seed so a cold Render start (or a Yahoo outage) can serve instantly.
 * - history/<SYM>.json — per-symbol daily bars, built lazily and updated
 *   incrementally at runtime (git-ignored; rebuilt on demand).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CACHE_DIR = path.dirname(fileURLToPath(import.meta.url)) + "/cache";
const HISTORY_DIR = path.join(CACHE_DIR, "history");
const OVERVIEW_FILE = path.join(CACHE_DIR, "overview.json");

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data));
}

export async function readOverviewSnapshot() {
  const snap = await readJson(OVERVIEW_FILE);
  return snap?.sessionKey && snap.payload ? snap : null;
}

export async function writeOverviewSnapshot(sessionKey, payload) {
  await writeJson(OVERVIEW_FILE, { sessionKey, payload });
}

function historyPath(symbol) {
  return path.join(HISTORY_DIR, `${symbol.toUpperCase()}.json`);
}

export async function readHistory(symbol) {
  const data = await readJson(historyPath(symbol));
  return data?.rows?.length ? data.rows : null;
}

export async function writeHistory(symbol, rows) {
  await writeJson(historyPath(symbol), {
    symbol: symbol.toUpperCase(),
    updatedAt: new Date().toISOString(),
    rows,
  });
}

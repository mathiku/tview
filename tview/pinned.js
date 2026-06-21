import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { BIG_STOCK_BY_SYMBOL } from "./universe.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PINNED_PATH = path.join(__dirname, "data", "pinned.json");

async function ensureDataDir() {
  await fs.mkdir(path.dirname(PINNED_PATH), { recursive: true });
}

export async function loadPinned() {
  try {
    const raw = await fs.readFile(PINNED_PATH, "utf8");
    const json = JSON.parse(raw);
    const stocks = Array.isArray(json?.stocks) ? json.stocks : [];
    return normalizePinned(stocks);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

function normalizePinned(stocks) {
  const seen = new Set();
  const out = [];
  for (const row of stocks) {
    const symbol = String(row?.symbol ?? "")
      .trim()
      .toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({
      symbol,
      name: row?.name ? String(row.name).trim() : symbol,
    });
  }
  return out;
}

async function savePinned(stocks) {
  await ensureDataDir();
  await fs.writeFile(PINNED_PATH, `${JSON.stringify({ stocks }, null, 2)}\n`, "utf8");
}

export async function addPinned(stock) {
  const pinned = await loadPinned();
  if (pinned.some((s) => s.symbol === stock.symbol)) {
    return pinned;
  }
  const next = [...pinned, stock];
  await savePinned(next);
  return next;
}

export async function removePinned(symbol) {
  const upper = symbol.toUpperCase();
  const next = (await loadPinned()).filter((s) => s.symbol !== upper);
  await savePinned(next);
  return next;
}

export function lookupName(symbol) {
  return BIG_STOCK_BY_SYMBOL.get(symbol)?.name ?? symbol;
}

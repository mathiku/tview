import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAPER } from "../config.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolvePath(rel) {
  return path.join(ROOT, rel);
}

export function emptyState() {
  return {
    startedAt: new Date().toISOString(),
    lastRunDate: null,
    cash: PAPER.initialCapital,
    positions: [],
    pendingEntries: [],
    closedTrades: [],
    equityHistory: [],
  };
}

export async function loadState() {
  const file = resolvePath(PAPER.stateFile);
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return emptyState();
  }
}

export async function saveState(state) {
  const file = resolvePath(PAPER.stateFile);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(state, null, 2));
}

export async function appendLog(entry) {
  const dir = resolvePath(PAPER.logDir);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  await fs.appendFile(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

export function positionKey(symbol, side) {
  return `${symbol}:${side}`;
}

export function countBySide(positions, side) {
  return positions.filter((p) => p.side === side).length;
}

export function markToMarket(state, priceBySymbol) {
  let value = 0;
  for (const pos of state.positions) {
    const price = priceBySymbol.get(pos.symbol) ?? pos.entryPrice;
    if (pos.side === "long") value += pos.shares * price;
    else value += pos.shares * (pos.entryPrice - price);
  }
  return state.cash + value;
}

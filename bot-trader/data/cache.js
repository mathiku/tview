import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "cache");

export async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

export function cachePath(symbol) {
  return path.join(CACHE_DIR, `${symbol.toUpperCase()}.json`);
}

export async function readCached(symbol) {
  try {
    const raw = await fs.readFile(cachePath(symbol), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeCached(symbol, payload) {
  await ensureCacheDir();
  await fs.writeFile(cachePath(symbol), JSON.stringify(payload, null, 2));
}

export async function listCachedSymbols() {
  await ensureCacheDir();
  const files = await fs.readdir(CACHE_DIR);
  return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
}

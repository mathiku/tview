import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sma,
  ema,
  rsi,
  trueRange,
  atr,
  adx,
  bollinger,
  obv,
  latestIndicators,
} from "./indicators.js";

/** Build synthetic OHLC rows from a close series (small fixed range). */
function rowsFrom(closes, volume = 1000) {
  return closes.map((c, i) => ({
    open: i === 0 ? c : closes[i - 1],
    high: c + 1,
    low: c - 1,
    close: c,
    volume,
  }));
}

test("sma matches a hand-computed window", () => {
  const out = sma([1, 2, 3, 4, 5], 3);
  assert.deepEqual(out.slice(0, 2), [null, null]);
  assert.equal(out[2], 2); // (1+2+3)/3
  assert.equal(out[3], 3);
  assert.equal(out[4], 4);
});

test("ema is null before seed and tracks toward price", () => {
  const out = ema([1, 2, 3, 4, 5, 6], 3);
  assert.equal(out[0], null);
  assert.equal(out[1], null);
  assert.equal(out[2], 2); // seed = SMA(1,2,3)
  assert.ok(out[5] > out[2] && out[5] < 6);
});

test("rsi is 100 for a monotonically rising series and within [0,100]", () => {
  const rising = Array.from({ length: 30 }, (_, i) => i + 1);
  const r = rsi(rising, 14);
  assert.equal(r[14], 100);
  for (const v of r.filter((x) => x != null)) {
    assert.ok(v >= 0 && v <= 100);
  }
  // A falling series pins RSI near 0.
  const falling = Array.from({ length: 30 }, (_, i) => 100 - i);
  const rf = rsi(falling, 14);
  assert.equal(rf[14], 0);
});

test("trueRange and atr are non-negative and defined after warmup", () => {
  const rows = rowsFrom(Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i)));
  const tr = trueRange(rows);
  assert.ok(tr.every((v) => v >= 0));
  const a = atr(rows, 14);
  assert.equal(a[13], null);
  assert.ok(a[14] > 0);
});

test("adx and DI stay within [0,100] and seed at the right indices", () => {
  const rows = rowsFrom(Array.from({ length: 60 }, (_, i) => 100 + i * 0.5));
  const { adx: a, plusDI, minusDI } = adx(rows, 14);
  assert.equal(a[2 * 14 - 2], null);
  assert.ok(a[2 * 14 - 1] != null);
  for (const arr of [a, plusDI, minusDI]) {
    for (const v of arr.filter((x) => x != null)) assert.ok(v >= 0 && v <= 100);
  }
  // Strong uptrend → +DI dominates.
  const i = rows.length - 1;
  assert.ok(plusDI[i] > minusDI[i]);
});

test("bollinger %B ≈ 1 at upper band, 0 at lower", () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1));
  const { upper, lower, percentB } = bollinger(closes, 20, 2);
  const i = closes.length - 1;
  assert.ok(upper[i] > lower[i]);
  assert.ok(percentB[i] >= 0 && percentB[i] <= 1.5);
});

test("obv accumulates up-volume and sheds down-volume", () => {
  const rows = rowsFrom([10, 11, 12, 11, 13]);
  const o = obv(rows);
  assert.equal(o[0], 0);
  assert.equal(o[1], 1000); // up
  assert.equal(o[2], 2000); // up
  assert.equal(o[3], 1000); // down
  assert.equal(o[4], 2000); // up
});

test("latestIndicators returns rounded, null-safe readings", () => {
  const rows = rowsFrom(Array.from({ length: 250 }, (_, i) => 100 + i * 0.1));
  const ind = latestIndicators(rows);
  for (const key of ["rsi", "atr", "atrPct", "adx", "percentB", "ema", "smaFast"]) {
    assert.ok(key in ind, `missing ${key}`);
  }
  assert.ok(ind.rsi >= 0 && ind.rsi <= 100);
  assert.equal(ind.aboveSmaFast, true); // rising series sits above its SMA
});

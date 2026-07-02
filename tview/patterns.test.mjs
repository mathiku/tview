import { test } from "node:test";
import assert from "node:assert/strict";
import { detectDoubleBottom } from "./patterns.js";

function rowsFrom(closes) {
  return closes.map((c, i) => ({
    time: 1_700_000_000 + i * 86400,
    open: c,
    high: c + 0.2,
    low: c - 0.2,
    close: c,
    volume: 1000,
  }));
}

test("detects a W that breaks out above the neckline", () => {
  // decline → low1(100) → neckline(112) → low2(101) → breakout(115)
  const closes = [
    120, 118, 116, 114, 112, 110, 108, 106, 104, 102, 100,
    102, 104, 106, 108, 110, 112, 110, 108, 106, 104, 103, 102, 102, 101,
    103, 106, 110, 113, 115,
  ];
  const db = detectDoubleBottom(rowsFrom(closes));
  assert.equal(db.match, true);
  assert.equal(db.breakout, true);
  assert.ok(Math.abs(db.lowPrice - 99.8) < 1); // ~low with the -0.2 wick
  assert.ok(db.neckline > db.lowPrice);
});

test("no match on a straight uptrend", () => {
  const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
  assert.equal(detectDoubleBottom(rowsFrom(closes)).match, false);
});

test("no match on a single V-bottom (only one low)", () => {
  const closes = [120, 115, 110, 105, 100, 105, 110, 115, 120, 125, 130, 135];
  assert.equal(detectDoubleBottom(rowsFrom(closes)).match, false);
});

test("forms but has not broken out yet → match false while below neckline", () => {
  // Same W but price stalls just under the neckline (108 < 112).
  const closes = [
    120, 118, 116, 114, 112, 110, 108, 106, 104, 102, 100,
    102, 104, 106, 108, 110, 112, 110, 108, 106, 104, 103, 102, 102, 101,
    103, 105, 106, 107, 108,
  ];
  const db = detectDoubleBottom(rowsFrom(closes));
  assert.equal(db.breakout, false);
});

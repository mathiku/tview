import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "./strategy-dsl.js";

test("comparison and boolean logic", () => {
  const r = compile("rsi < 30 and close < sma100");
  assert.equal(r.evaluate({ rsi: 25, close: 90, sma100: 100 }), true);
  assert.equal(r.evaluate({ rsi: 35, close: 90, sma100: 100 }), false);
  assert.equal(r.evaluate({ rsi: 25, close: 110, sma100: 100 }), false);
});

test("or / not / parentheses / arithmetic", () => {
  assert.equal(compile("profit >= 10 or profit <= -5").evaluate({ profit: 12 }), true);
  assert.equal(compile("profit >= 10 or profit <= -5").evaluate({ profit: 0 }), false);
  assert.equal(compile("not (rsi > 70)").evaluate({ rsi: 50 }), true);
  assert.equal(compile("close > sma100 * 1.05").evaluate({ close: 106, sma100: 100 }), true);
  assert.equal(compile("close > sma100 * 1.05").evaluate({ close: 104, sma100: 100 }), false);
});

test("percent literals are cosmetic", () => {
  assert.equal(compile("profit >= 10%").evaluate({ profit: 10 }), true);
  assert.equal(compile("profit >= 10%").evaluate({ profit: 9 }), false);
});

test("null/warming indicators make the rule false, not crash", () => {
  const r = compile("close < sma200");
  assert.equal(r.evaluate({ close: 100, sma200: null }), false);
  assert.equal(r.evaluate({ close: 100, sma200: undefined }), false);
});

test("crossabove needs the previous bar and a genuine flip", () => {
  const r = compile("crossabove(close, sma50)");
  // below → above: cross
  assert.equal(r.evaluate({ close: 101, sma50: 100 }, { close: 99, sma50: 100 }), true);
  // already above both bars: no cross
  assert.equal(r.evaluate({ close: 102, sma50: 100 }, { close: 101, sma50: 100 }), false);
  // no previous bar: no cross
  assert.equal(r.evaluate({ close: 101, sma50: 100 }, null), false);
});

test("crossbelow mirrors crossabove", () => {
  const r = compile("crossbelow(close, sma50)");
  assert.equal(r.evaluate({ close: 99, sma50: 100 }, { close: 101, sma50: 100 }), true);
  assert.equal(r.evaluate({ close: 98, sma50: 100 }, { close: 99, sma50: 100 }), false);
});

test("syntax errors are reported, not thrown as crashes", () => {
  assert.throws(() => compile("rsi <"), /Unexpected|Expected/);
  assert.throws(() => compile("frobnicate > 3"), /Unknown name/);
  assert.throws(() => compile("wobble(1, 2)"), /Unknown function/);
  assert.throws(() => compile("(rsi < 30"), /Expected/);
  assert.throws(() => compile(""), /empty/);
});

test("operator precedence: and binds looser than comparison", () => {
  // Parsed as (close > open) and (rsi < 40)
  const r = compile("close > open and rsi < 40");
  assert.equal(r.evaluate({ close: 10, open: 9, rsi: 30 }), true);
  assert.equal(r.evaluate({ close: 10, open: 9, rsi: 50 }), false);
});

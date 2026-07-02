import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionKey, marketStatus, isTradingDay, isHoliday } from "./market.js";

// EST = UTC-5 (Feb), EDT = UTC-4 (Apr).

test("after close on a normal weekday → that day", () => {
  // Wed 2026-02-11 21:30 UTC = 16:30 ET (exactly close+buffer)
  assert.equal(sessionKey(new Date("2026-02-11T21:30:00Z")), "2026-02-11");
});

test("before close on a weekday → previous session", () => {
  // Wed 2026-02-11 15:00 UTC = 10:00 ET
  assert.equal(sessionKey(new Date("2026-02-11T15:00:00Z")), "2026-02-10");
});

test("weekend → preceding Friday", () => {
  // Sun 2026-02-15 12:00 UTC = 07:00 ET
  assert.equal(sessionKey(new Date("2026-02-15T12:00:00Z")), "2026-02-13");
});

test("holiday (Presidents Day) after close → previous trading day", () => {
  // Mon 2026-02-16 22:00 UTC = 17:00 ET, but 02-16 is a holiday
  assert.equal(isHoliday("2026-02-16"), true);
  assert.equal(sessionKey(new Date("2026-02-16T22:00:00Z")), "2026-02-13");
});

test("Good Friday (market closed) → previous trading day", () => {
  // Fri 2026-04-03 20:00 UTC = 16:00 ET, holiday
  assert.equal(sessionKey(new Date("2026-04-03T20:00:00Z")), "2026-04-02");
});

test("marketStatus open during RTH, closed otherwise", () => {
  assert.equal(marketStatus(new Date("2026-02-11T15:00:00Z")), "open"); // 10:00 ET Wed
  assert.equal(marketStatus(new Date("2026-02-11T21:30:00Z")), "closed"); // 16:30 ET Wed
  assert.equal(marketStatus(new Date("2026-02-15T15:00:00Z")), "closed"); // Sunday
});

test("isTradingDay respects weekends and holidays", () => {
  assert.equal(isTradingDay("2026-02-11", "Wed"), true);
  assert.equal(isTradingDay("2026-02-14", "Sat"), false);
  assert.equal(isTradingDay("2026-12-25", "Fri"), false); // Christmas
});

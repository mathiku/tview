function r2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Double-bottom ("W"): two similar swing lows separated by a peak (the
 * neckline), with price now emerging up through that neckline. Scans the recent
 * window and returns the most recent valid formation.
 *
 * state = "false"    — no valid double bottom in the window.
 *         "current"  — price has just reclaimed the neckline (within the last
 *                      `currentMaxBars` bars): we are on the pattern's last leg
 *                      right now. This is the actionable one.
 *         "occurred" — a double bottom broke out earlier and price has moved on;
 *                      informational only (see `barsSinceBreakout`).
 *
 * match   = price has climbed back to/through the neckline ("on the way out").
 * breakout = price is strictly above the neckline (confirmed).
 * barsSinceBreakout = trading bars since the neckline was reclaimed (0 = today),
 *                     or null while price is still below the neckline.
 */
export function detectDoubleBottom(
  rows,
  {
    window = 90,
    swingK = 4,
    similarPct = 3,
    minDepthPct = 5,
    minSeparation = 8,
    breakoutBufferPct = 1,
    currentMaxBars = 3,
    currentMaxProgress = 1,
  } = {}
) {
  const none = { state: "false", match: false, breakout: false, barsSinceBreakout: null };
  const n = rows.length;
  if (n < 30) return none;

  const win = rows.slice(Math.max(0, n - window));
  const m = win.length;

  // Swing lows: local minima of `low` within ±swingK bars.
  const lows = [];
  for (let i = swingK; i < m - swingK; i++) {
    let isLow = true;
    for (let j = i - swingK; j <= i + swingK; j++) {
      if (win[j].low < win[i].low) {
        isLow = false;
        break;
      }
    }
    if (isLow) lows.push(i);
  }
  if (lows.length < 2) return none;

  // Most recent valid pair: latest second-low first, earliest matching first-low.
  let best = null;
  for (let b = lows.length - 1; b >= 1 && !best; b--) {
    for (let a = b - 1; a >= 0; a--) {
      const iA = lows[a];
      const iB = lows[b];
      if (iB - iA < minSeparation) continue;
      const lowA = win[iA].low;
      const lowB = win[iB].low;
      const base = Math.min(lowA, lowB);
      if ((Math.abs(lowA - lowB) / base) * 100 > similarPct) continue;

      let neck = -Infinity;
      for (let k = iA; k <= iB; k++) if (win[k].high > neck) neck = win[k].high;
      if (((neck - base) / base) * 100 < minDepthPct) continue;

      best = { iA, iB, base, neck };
      break;
    }
  }
  if (!best) return none;

  const price = win[m - 1].close;
  const thresh = best.neck * (1 - breakoutBufferPct / 100);
  const match = price >= thresh;

  // How long we've held above the neckline: walk back over the trailing run of
  // closes that are still above it. 0 = the neckline was reclaimed today.
  let runAbove = 0;
  for (let i = m - 1; i >= 0 && win[i].close >= thresh; i--) runAbove++;
  const barsSinceBreakout = match ? Math.max(0, runAbove - 1) : null;

  // Progress along the measured move (0 at the neckline, 1 at the target).
  const depth = best.neck - best.base;
  const progressAboveNeck = depth > 0 ? (price - best.neck) / depth : 0;

  // "current" = we're on the last leg now: just reclaimed the neckline and not
  // yet run away toward the target. Anything else that formed is "occurred".
  let state = "false";
  if (match) {
    const fresh = barsSinceBreakout <= currentMaxBars && progressAboveNeck <= currentMaxProgress;
    state = fresh ? "current" : "occurred";
  }

  return {
    state,
    match,
    breakout: price > best.neck,
    barsSinceBreakout,
    lowPrice: r2(best.base),
    neckline: r2(best.neck),
    // Classic measured-move target (informational).
    target: r2(best.neck + (best.neck - best.base)),
    low1Time: win[best.iA].time,
    low2Time: win[best.iB].time,
  };
}

export function isUpDay(rows, i) {
  return i >= 1 && rows[i].close > rows[i - 1].close;
}

export function isDownDay(rows, i) {
  return i >= 1 && rows[i].close < rows[i - 1].close;
}

/** Lower wick ≥ 2× body, small upper wick. */
export function isHammer(candle) {
  if (candle?.open == null || candle?.high == null || candle?.low == null || candle?.close == null) {
    return false;
  }

  const range = candle.high - candle.low;
  if (range <= 0) return false;

  const body = Math.abs(candle.close - candle.open);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const effectiveBody = Math.max(body, range * 0.1);

  return lowerWick >= 2 * effectiveBody && upperWick <= effectiveBody;
}

/** Three consecutive up days, then 1–2 down days ending on the latest bar. */
export function detectPullbackStreak(rows) {
  const n = rows.length;
  if (n < 6) return { match: false, downDays: 0 };

  let downDays = 0;
  let i = n - 1;
  while (i >= 1 && isDownDay(rows, i) && downDays < 2) {
    downDays++;
    i--;
  }
  if (downDays < 1 || downDays > 2) return { match: false, downDays: 0 };

  let upDays = 0;
  while (i >= 1 && isUpDay(rows, i) && upDays < 3) {
    upDays++;
    i--;
  }
  if (upDays !== 3) return { match: false, downDays: 0 };

  return { match: true, downDays };
}

function avgVolumeAt(rows, indices) {
  const vols = indices.map((idx) => rows[idx]?.volume).filter((v) => v != null && v > 0);
  if (!vols.length) return null;
  return vols.reduce((sum, v) => sum + v, 0) / vols.length;
}

function recentAvgVolume(rows, days, skipLast = 1) {
  const n = rows.length;
  const indices = [];
  for (let j = skipLast; j < skipLast + days && n - 1 - j >= 0; j++) {
    indices.push(n - 1 - j);
  }
  return avgVolumeAt(rows, indices);
}

/** Lighter volume on pullback days, or elevated volume on a hammer. */
export function volumeConfirms(rows, { hammer, streak }) {
  const n = rows.length;
  if (n < 21) return false;

  const avg20 = recentAvgVolume(rows, 20, 1);
  const last = rows[n - 1];

  if (hammer && avg20 != null && last.volume > avg20) return true;

  if (streak?.match) {
    const downIdx = [];
    for (let idx = n - 1; idx >= 1 && downIdx.length < streak.downDays; idx--) {
      if (isDownDay(rows, idx)) downIdx.push(idx);
    }

    const upEnd = n - 1 - streak.downDays;
    const upIdx = [upEnd - 2, upEnd - 1, upEnd].filter((idx) => idx >= 1);

    const downVol = avgVolumeAt(rows, downIdx);
    const upVol = avgVolumeAt(rows, upIdx);
    if (downVol != null && upVol != null && downVol < upVol) return true;
  }

  return false;
}

export function analyzePatterns(dailyRows, { at100Sma = false } = {}) {
  if (!dailyRows.length) {
    return {
      hammer: false,
      hammerAt100: false,
      pullbackStreak: false,
      streakDownDays: null,
      volumeOk: false,
      count: 0,
    };
  }

  const last = dailyRows[dailyRows.length - 1];
  const hammer = isHammer(last);
  const streak = detectPullbackStreak(dailyRows);
  const volumeOk = volumeConfirms(dailyRows, { hammer, streak });

  const checks = {
    hammer,
    hammerAt100: hammer && at100Sma,
    pullbackStreak: streak.match,
    streakDownDays: streak.match ? streak.downDays : null,
    volumeOk,
  };

  return {
    ...checks,
    count: [checks.hammer, checks.pullbackStreak, checks.volumeOk].filter(Boolean).length,
  };
}

export function patternLabel(patterns) {
  if (!patterns.count) return null;
  const parts = [];
  if (patterns.hammerAt100) parts.push("hammer");
  else if (patterns.hammer) parts.push("hammer");
  if (patterns.pullbackStreak) {
    parts.push(patterns.streakDownDays === 2 ? "3↑2↓" : "3↑1↓");
  }
  if (patterns.volumeOk) parts.push("vol");
  return parts.join(" · ");
}

/** Upper wick ≥ 2× body, small lower wick — mirror of hammer. */
export function isShootingStar(candle) {
  if (candle?.open == null || candle?.high == null || candle?.low == null || candle?.close == null) {
    return false;
  }

  const range = candle.high - candle.low;
  if (range <= 0) return false;

  const body = Math.abs(candle.close - candle.open);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const effectiveBody = Math.max(body, range * 0.1);

  return upperWick >= 2 * effectiveBody && lowerWick <= effectiveBody;
}

/** Three consecutive down days, then 1–2 up days ending on the latest bar. */
export function detectRallyStreak(rows) {
  const n = rows.length;
  if (n < 6) return { match: false, upDays: 0 };

  let upDays = 0;
  let i = n - 1;
  while (i >= 1 && isUpDay(rows, i) && upDays < 2) {
    upDays++;
    i--;
  }
  if (upDays < 1 || upDays > 2) return { match: false, upDays: 0 };

  let downDays = 0;
  while (i >= 1 && isDownDay(rows, i) && downDays < 3) {
    downDays++;
    i--;
  }
  if (downDays !== 3) return { match: false, upDays: 0 };

  return { match: true, upDays };
}

/** Lighter volume on rally days, or elevated volume on a shooting star. */
export function volumeConfirmsShort(rows, { shootingStar, streak }) {
  const n = rows.length;
  if (n < 21) return false;

  const avg20 = recentAvgVolume(rows, 20, 1);
  const last = rows[n - 1];

  if (shootingStar && avg20 != null && last.volume > avg20) return true;

  if (streak?.match) {
    const upIdx = [];
    for (let idx = n - 1; idx >= 1 && upIdx.length < streak.upDays; idx--) {
      if (isUpDay(rows, idx)) upIdx.push(idx);
    }

    const downEnd = n - 1 - streak.upDays;
    const downIdx = [downEnd - 2, downEnd - 1, downEnd].filter((idx) => idx >= 1);

    const upVol = avgVolumeAt(rows, upIdx);
    const downVol = avgVolumeAt(rows, downIdx);
    if (upVol != null && downVol != null && upVol < downVol) return true;
  }

  return false;
}

export function analyzeShortPatterns(dailyRows, { at100Sma = false } = {}) {
  if (!dailyRows.length) {
    return {
      shootingStar: false,
      shootingStarAt100: false,
      rallyStreak: false,
      streakUpDays: null,
      volumeOk: false,
      count: 0,
    };
  }

  const last = dailyRows[dailyRows.length - 1];
  const shootingStar = isShootingStar(last);
  const streak = detectRallyStreak(dailyRows);
  const volumeOk = volumeConfirmsShort(dailyRows, { shootingStar, streak });

  const checks = {
    shootingStar,
    shootingStarAt100: shootingStar && at100Sma,
    rallyStreak: streak.match,
    streakUpDays: streak.match ? streak.upDays : null,
    volumeOk,
  };

  return {
    ...checks,
    count: [checks.shootingStar, checks.rallyStreak, checks.volumeOk].filter(Boolean).length,
  };
}

export function shortPatternLabel(patterns) {
  if (!patterns.count) return null;
  const parts = [];
  if (patterns.shootingStarAt100) parts.push("star");
  else if (patterns.shootingStar) parts.push("star");
  if (patterns.rallyStreak) {
    parts.push(patterns.streakUpDays === 2 ? "3↓2↑" : "3↓1↑");
  }
  if (patterns.volumeOk) parts.push("vol");
  return parts.join(" · ");
}

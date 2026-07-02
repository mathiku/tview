/**
 * Technical indicators for pullback / rally analysis.
 *
 * All functions are pure and self-contained (no imports) so this module can be
 * shared by the tview scanner and the bot-trader backtest without import cycles.
 * Each returns a full-length array aligned to `rows`/`values`, with `null` in the
 * warm-up region where the indicator is not yet defined.
 *
 * Row shape: { open, high, low, close, volume }.
 */

function round2n(n) {
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

/** Simple moving average (mirrors tview/stocks.js rollingSma). */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first `period` values. */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI. First value lands at index `period`. */
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i] - values[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** True range per bar (index 0 uses high-low). */
export function trueRange(rows) {
  const out = new Array(rows.length).fill(null);
  for (let i = 0; i < rows.length; i++) {
    if (i === 0) {
      out[i] = rows[i].high - rows[i].low;
      continue;
    }
    const h = rows[i].high;
    const l = rows[i].low;
    const pc = rows[i - 1].close;
    out[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return out;
}

/** Wilder's ATR. First value lands at index `period`. */
export function atr(rows, period = 14) {
  const tr = trueRange(rows);
  const out = new Array(rows.length).fill(null);
  if (rows.length < period + 1) return out;

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < rows.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/**
 * Wilder's ADX with +DI / -DI. +DI/-DI start at index `period`; ADX at
 * index `2*period - 1`. Measures trend strength (ADX) and direction (DI spread).
 */
export function adx(rows, period = 14) {
  const n = rows.length;
  const plusDI = new Array(n).fill(null);
  const minusDI = new Array(n).fill(null);
  const adxOut = new Array(n).fill(null);
  if (n < 2 * period + 1) return { adx: adxOut, plusDI, minusDI };

  const tr = new Array(n).fill(0);
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const up = rows[i].high - rows[i - 1].high;
    const down = rows[i - 1].low - rows[i].low;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    const h = rows[i].high;
    const l = rows[i].low;
    const pc = rows[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }

  let trS = 0;
  let pS = 0;
  let mS = 0;
  for (let i = 1; i <= period; i++) {
    trS += tr[i];
    pS += plusDM[i];
    mS += minusDM[i];
  }

  const dx = new Array(n).fill(null);
  const setDi = (i) => {
    plusDI[i] = trS === 0 ? 0 : (100 * pS) / trS;
    minusDI[i] = trS === 0 ? 0 : (100 * mS) / trS;
    const sum = plusDI[i] + minusDI[i];
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(plusDI[i] - minusDI[i])) / sum;
  };
  setDi(period);
  for (let i = period + 1; i < n; i++) {
    trS = trS - trS / period + tr[i];
    pS = pS - pS / period + plusDM[i];
    mS = mS - mS / period + minusDM[i];
    setDi(i);
  }

  let dxSum = 0;
  for (let i = period; i < 2 * period; i++) dxSum += dx[i];
  let prev = dxSum / period;
  adxOut[2 * period - 1] = prev;
  for (let i = 2 * period; i < n; i++) {
    prev = (prev * (period - 1) + dx[i]) / period;
    adxOut[i] = prev;
  }

  return { adx: adxOut, plusDI, minusDI };
}

/**
 * Bollinger Bands + %B. %B = (price - lower) / (upper - lower):
 * 0 = at lower band, 1 = at upper band. Uses population stdev (÷period).
 */
export function bollinger(values, period = 20, mult = 2) {
  const n = values.length;
  const mid = new Array(n).fill(null);
  const upper = new Array(n).fill(null);
  const lower = new Array(n).fill(null);
  const percentB = new Array(n).fill(null);

  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    const m = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - m;
      sq += d * d;
    }
    const sd = Math.sqrt(sq / period);
    mid[i] = m;
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
    const width = upper[i] - lower[i];
    percentB[i] = width === 0 ? 0.5 : (values[i] - lower[i]) / width;
  }

  return { mid, upper, lower, percentB };
}

/** On-balance volume (cumulative). */
export function obv(rows) {
  const out = new Array(rows.length).fill(0);
  for (let i = 1; i < rows.length; i++) {
    const v = rows[i].volume ?? 0;
    if (rows[i].close > rows[i - 1].close) out[i] = out[i - 1] + v;
    else if (rows[i].close < rows[i - 1].close) out[i] = out[i - 1] - v;
    else out[i] = out[i - 1];
  }
  return out;
}

export const DEFAULT_INDICATOR_CFG = {
  rsiPeriod: 14,
  atrPeriod: 14,
  adxPeriod: 14,
  bollingerPeriod: 20,
  bollingerMult: 2,
  emaPeriod: 21,
  smaFast: 50,
};

/**
 * Compute the latest reading of every indicator for a rows array.
 * Returns null-safe, rounded values suitable for display and gating.
 */
export function latestIndicators(rows, cfg = {}) {
  const c = { ...DEFAULT_INDICATOR_CFG, ...cfg };
  const closes = rows.map((r) => r.close);
  const i = rows.length - 1;
  if (i < 0) return null;

  const rsiArr = rsi(closes, c.rsiPeriod);
  const atrArr = atr(rows, c.atrPeriod);
  const { adx: adxArr, plusDI, minusDI } = adx(rows, c.adxPeriod);
  const boll = bollinger(closes, c.bollingerPeriod, c.bollingerMult);
  const emaArr = ema(closes, c.emaPeriod);
  const smaArr = sma(closes, c.smaFast);
  const obvArr = obv(rows);

  const price = closes[i];
  const atrVal = atrArr[i];
  const pctB = boll.percentB[i];

  return {
    rsi: round2n(rsiArr[i]),
    atr: round2n(atrVal),
    atrPct: atrVal != null && price ? round2n((atrVal / price) * 100) : null,
    adx: round2n(adxArr[i]),
    plusDI: round2n(plusDI[i]),
    minusDI: round2n(minusDI[i]),
    percentB: pctB != null ? round2n(pctB * 100) : null,
    bollUpper: round2n(boll.upper[i]),
    bollLower: round2n(boll.lower[i]),
    ema: round2n(emaArr[i]),
    smaFast: round2n(smaArr[i]),
    aboveEma: emaArr[i] != null ? price > emaArr[i] : null,
    aboveSmaFast: smaArr[i] != null ? price > smaArr[i] : null,
    obvRising: i >= 5 ? obvArr[i] > obvArr[i - 5] : null,
  };
}

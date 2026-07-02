/** Paper-trading and backtest rules — mirrors the tview pullback strategy. */
export const BACKTEST = {
  startDate: "2020-01-01",
  endDate: null,
  /** Skip this many leading *trading rows* (not calendar days) before trading,
   *  so SMA-200 and friends are warm. ~220 rows ≈ 10.5 months. */
  warmupDays: 220,
  initialCapital: 100_000,
  maxPositions: 5,
  maxLongPositions: 3,
  maxShortPositions: 3,
  positionSizePct: 0.18,
  commissionPerTrade: 1.0,
  slippagePct: 0.05,
  enableLongs: true,
  enableShorts: false,

  /** Optional broad-market regime gate (off by default). When enabled, longs
   *  only fire while `symbol` is above its own SMA, shorts only while below.
   *  Requires `symbol` to be present in the backtest universe. */
  regimeFilter: {
    enabled: false,
    symbol: "SPY",
    smaPeriod: 200,
  },
};

/** Indicator periods shared by the scanner and backtest gates. */
export const INDICATORS = {
  rsiPeriod: 14,
  atrPeriod: 14,
  adxPeriod: 14,
  bollingerPeriod: 20,
  bollingerMult: 2,
  emaPeriod: 21,
  smaFast: 50,
};

export const ENTRY = {
  requireWatch: true,
  requirePattern: false,
  minPatternCount: 1,
  timing: "next_open",

  /** Optional indicator gates. `null` = disabled (legacy behaviour). These add
   *  to the existing watch/pattern rules — every non-null gate must pass. */
  filters: {
    rsiMax: null, // long: enter only if RSI(14) <= this (oversold dip)
    rsiMinShort: null, // short: enter only if RSI(14) >= this (overbought bounce)
    adxMin: null, // require ADX(14) >= this (trend strength) on both sides
    percentBMax: null, // long: require Bollinger %B <= this (near/below lower band)
    percentBMin: null, // short: require Bollinger %B >= this (near/above upper band)
    /** If set, the "near 100 SMA" band becomes ±(atrBandMult × ATR%) instead of
     *  the fixed ±3%, so volatility scales the entry zone. */
    atrBandMult: null,
  },
};

export const EXIT = {
  stopLossPct: 6,
  takeProfitPct: 12,
  /** Long: exit when close falls below 200 SMA. Short: exit when close rises above. */
  stopOn200Sma: true,
  /** Time stop in *calendar* days from entry (≈14 trading days for 20). */
  maxHoldDays: 20,

  /** Optional ATR-based stop / target (off by default). When enabled, an
   *  additional stop fires at stopMult×ATR below entry and a target at
   *  targetMult×ATR above (set targetMult null to only add the stop). */
  atrStop: {
    enabled: false,
    period: 14,
    stopMult: 2.5,
    targetMult: 4,
  },

  /** Take profit early when the trade thesis plays out or momentum fades. */
  earlyProfit: {
    enabled: true,
    minProfitPct: 2.5,
    longBounceAbove100Pct: 3,
    shortRejectBelow100Pct: -4,
    oppositePattern: true,
    oppositePatternMinProfitPct: 2,
    trailAfterPct: 3,
    trailDistancePct: 1.5,
  },
};

export const IBKR = {
  host: "127.0.0.1",
  /** TWS paper: 7497 · TWS live: 7496 · IB Gateway paper: 4002 */
  port: 7497,
  clientId: 7,
  /** Leave empty to auto-detect the paper account (DU…). */
  account: "",
};

export const PAPER = {
  initialCapital: 100_000,
  stateFile: "paper/state.json",
  logDir: "paper/logs",
};

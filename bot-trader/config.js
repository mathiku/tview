/** Paper-trading and backtest rules — mirrors the tview pullback strategy. */
export const BACKTEST = {
  startDate: "2020-01-01",
  endDate: null,
  warmupDays: 220,
  initialCapital: 100_000,
  maxPositions: 5,
  maxLongPositions: 3,
  maxShortPositions: 3,
  positionSizePct: 0.18,
  commissionPerTrade: 1.0,
  slippagePct: 0.05,
  enableLongs: true,
  enableShorts: true,
};

export const ENTRY = {
  requireWatch: true,
  requirePattern: false,
  minPatternCount: 1,
  timing: "next_open",
};

export const EXIT = {
  stopLossPct: 8,
  takeProfitPct: 15,
  /** Long: exit when close falls below 200 SMA. Short: exit when close rises above. */
  stopOn200Sma: true,
  maxHoldDays: 30,

  /** Take profit early when the trade thesis plays out or momentum fades. */
  earlyProfit: {
    enabled: true,
    /** Minimum open profit before any early exit fires. */
    minProfitPct: 2.5,
    /** Long: bounce worked — price reclaimed ~4%+ above the 100 SMA. */
    longBounceAbove100Pct: 4,
    /** Short: fade worked — price rejected ~4%+ below the 100 SMA. */
    shortRejectBelow100Pct: -4,
    /** Exit on opposite candle (star on long, hammer on short) while in profit. */
    oppositePattern: true,
    oppositePatternMinProfitPct: 2,
    /** Trailing stop once peak profit reaches this level. */
    trailAfterPct: 5,
    trailDistancePct: 2.5,
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

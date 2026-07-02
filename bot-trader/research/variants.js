import { BACKTEST, ENTRY, EXIT } from "../config.js";

export function mergeRules(overrides = {}) {
  return {
    backtest: { ...BACKTEST, ...overrides.backtest },
    entry: { ...ENTRY, ...overrides.entry },
    exit: {
      ...EXIT,
      ...overrides.exit,
      earlyProfit: {
        ...EXIT.earlyProfit,
        ...overrides.exit?.earlyProfit,
      },
    },
  };
}

/** Strategy variants to compare against index benchmarks. */
export const VARIANTS = [
  {
    id: "baseline",
    name: "Current (long + short)",
    desc: "Today's default rules",
  },
  {
    id: "long-only",
    name: "Long only",
    desc: "Drop shorts — they dragged in backtests",
    backtest: { enableShorts: false, maxLongPositions: 5 },
  },
  {
    id: "long-pattern",
    name: "Long + pattern filter",
    desc: "Only enter with hammer/streak/volume confirm",
    backtest: { enableShorts: false, maxLongPositions: 5 },
    entry: { requirePattern: true },
  },
  {
    id: "long-fast-exit",
    name: "Long fast exits",
    desc: "Shorter holds, tighter trail, lower take-profit",
    backtest: { enableShorts: false, maxLongPositions: 5 },
    exit: {
      takeProfitPct: 10,
      maxHoldDays: 15,
      earlyProfit: {
        minProfitPct: 2,
        longBounceAbove100Pct: 3,
        trailAfterPct: 3,
        trailDistancePct: 1.5,
      },
    },
  },
  {
    id: "long-deploy",
    name: "Long full deploy",
    desc: "More slots, smaller size — keep capital working",
    backtest: {
      enableShorts: false,
      maxPositions: 8,
      maxLongPositions: 8,
      positionSizePct: 0.11,
    },
  },
  {
    id: "long-snipe",
    name: "Long snipe",
    desc: "Strict pattern, fewer bigger bets",
    backtest: { enableShorts: false, maxPositions: 4, positionSizePct: 0.22 },
    entry: { requirePattern: true, minPatternCount: 2 },
  },
  {
    id: "long-trail",
    name: "Long tight trail",
    desc: "Lock gains quickly once up 3%+",
    backtest: { enableShorts: false },
    exit: {
      maxHoldDays: 20,
      takeProfitPct: 12,
      earlyProfit: {
        trailAfterPct: 3,
        trailDistancePct: 1.5,
        longBounceAbove100Pct: 3,
      },
    },
  },
  {
    id: "long-tight-stop",
    name: "Long 6% stop",
    desc: "Cut losers faster",
    backtest: { enableShorts: false },
    exit: { stopLossPct: 6 },
  },
  {
    id: "long-pattern-fast",
    name: "Long pattern + fast exit",
    desc: "Best-of-both-worlds candidate",
    backtest: { enableShorts: false, maxPositions: 6, positionSizePct: 0.15 },
    entry: { requirePattern: true },
    exit: {
      takeProfitPct: 10,
      maxHoldDays: 15,
      stopLossPct: 6,
      earlyProfit: {
        minProfitPct: 2,
        longBounceAbove100Pct: 3,
        trailAfterPct: 3,
        trailDistancePct: 1.5,
      },
    },
  },
  {
    id: "long-compound",
    name: "Long compound focus",
    desc: "6 positions, fast recycle, pattern optional off",
    backtest: {
      enableShorts: false,
      maxPositions: 6,
      maxLongPositions: 6,
      positionSizePct: 0.15,
    },
    exit: {
      takeProfitPct: 8,
      maxHoldDays: 12,
      stopLossPct: 5,
      earlyProfit: {
        minProfitPct: 1.5,
        longBounceAbove100Pct: 2.5,
        trailAfterPct: 2.5,
        trailDistancePct: 1.2,
        oppositePatternMinProfitPct: 1.5,
      },
    },
  },
];

export function resolveVariant(variant) {
  const { id, name, desc, backtest, entry, exit } = variant;
  const rules = mergeRules({ backtest, entry, exit });
  return { id, name, desc, ...rules };
}

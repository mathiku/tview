import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeMetrics } from "../backtest/metrics.js";
import { BACKTEST, ENTRY, EXIT, PAPER } from "../config.js";
import { loadState, countBySide } from "../paper/state.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const EP = EXIT.earlyProfit;

function earlyExitLines(side) {
  if (!EP?.enabled) return [];
  const lines = [
    "Early profit — sell when the thesis plays out or momentum fades:",
    `  · Min ${EP.minProfitPct}% open profit before early exits`,
  ];
  if (side === "long") {
    lines.push(`  · Bounce complete — price ≥${EP.longBounceAbove100Pct}% above 100 SMA`);
    lines.push(`  · Reversal candle (shooting star) while in profit`);
  } else {
    lines.push(`  · Fade complete — price ≤${EP.shortRejectBelow100Pct}% below 100 SMA`);
    lines.push(`  · Reversal candle (hammer) while in profit`);
  }
  lines.push(`  · Trail stop — after +${EP.trailAfterPct}% peak, exit on ${EP.trailDistancePct}% giveback`);
  return lines;
}

export const STRATEGIES = [
  {
    id: "long-pullback",
    side: "long",
    name: "Long Pullback",
    tagline: "Buy the dip to the 100 SMA in an uptrend",
    entry: [
      "Trend OK — weekly & monthly above 200 SMA, or 5+/6 SMAs bullish",
      "At 100 SMA — daily price within ±3% of the 100 SMA",
      "Was higher — ≥5% above daily 100 SMA in the last ~20 days",
    ],
    patterns: [
      { name: "Hammer", rule: "Lower wick ≥ 2× body, small upper wick" },
      { name: "3↑↓", rule: "3 up days, then 1–2 down into the signal bar" },
      { name: "Volume", rule: "Light pullback volume or elevated hammer volume" },
    ],
    exits: [
      `${EXIT.stopLossPct}% stop loss`,
      `${EXIT.takeProfitPct}% take profit (max target)`,
      "Exit if close falls below 200 SMA",
      ...earlyExitLines("long"),
      `${EXIT.maxHoldDays}-day time stop (fallback)`,
    ],
  },
  {
    id: "short-rally",
    side: "short",
    name: "Short Rally",
    tagline: "Fade the bounce to the 100 SMA in a downtrend",
    entry: [
      "Trend bearish — weekly & monthly below 200 SMA, or 5+/6 SMAs bearish",
      "At 100 SMA — daily price within ±3% of the 100 SMA",
      "Was lower — ≥5% below daily 100 SMA in the last ~20 days",
    ],
    patterns: [
      { name: "Shooting star", rule: "Upper wick ≥ 2× body, small lower wick" },
      { name: "3↓↑", rule: "3 down days, then 1–2 up into the signal bar" },
      { name: "Volume", rule: "Light rally volume or elevated star volume" },
    ],
    exits: [
      `${EXIT.stopLossPct}% stop loss (price rises)`,
      `${EXIT.takeProfitPct}% take profit (max target)`,
      "Exit if close rises above 200 SMA",
      ...earlyExitLines("short"),
      `${EXIT.maxHoldDays}-day time stop (fallback)`,
    ],
  },
];

async function latestBacktestFile() {
  const dir = path.join(ROOT, "results");
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith("backtest-") && f.endsWith(".json"));
    if (!files.length) return null;
    files.sort();
    return path.join(dir, files[files.length - 1]);
  } catch {
    return null;
  }
}

function metricsForTrades(trades) {
  if (!trades.length) {
    return {
      totalTrades: 0,
      winRate: 0,
      avgPnlPct: 0,
      totalPnlUsd: 0,
      profitFactor: 0,
      avgHoldDays: 0,
      exitBreakdown: {},
    };
  }
  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
  const exitBreakdown = {};
  for (const t of trades) {
    exitBreakdown[t.exitReason] = (exitBreakdown[t.exitReason] ?? 0) + 1;
  }
  return {
    totalTrades: trades.length,
    winRate: (wins.length / trades.length) * 100,
    avgPnlPct: trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length,
    totalPnlUsd: trades.reduce((s, t) => s + t.pnlUsd, 0),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgHoldDays: trades.reduce((s, t) => s + t.holdDays, 0) / trades.length,
    exitBreakdown,
  };
}

export async function loadBacktestSummary() {
  const file = await latestBacktestFile();
  if (!file) return null;

  const raw = await fs.readFile(file, "utf8");
  const data = JSON.parse(raw);
  const trades = data.trades ?? [];
  const longTrades = trades.filter((t) => (t.side ?? "long") === "long");
  const shortTrades = trades.filter((t) => t.side === "short");

  return {
    file: path.basename(file),
    period: {
      start: data.config?.backtest?.startDate ?? BACKTEST.startDate,
      end: data.config?.backtest?.endDate ?? null,
    },
    config: data.config ?? { backtest: BACKTEST, entry: ENTRY, exit: EXIT },
    combined: data.metrics ?? summarizeMetrics(trades, data.equityCurve ?? [], BACKTEST.initialCapital),
    long: data.metricsLong ?? metricsForTrades(longTrades),
    short: data.metricsShort ?? metricsForTrades(shortTrades),
    hasShortTrades: shortTrades.length > 0,
    topWinners: [...trades].sort((a, b) => b.pnlPct - a.pnlPct).slice(0, 8),
    topLosers: [...trades].sort((a, b) => a.pnlPct - b.pnlPct).slice(0, 8),
    equityCurve: (data.equityCurve ?? []).slice(-120),
  };
}

export async function loadRecentLogs(limit = 40) {
  const dir = path.join(ROOT, PAPER.logDir);
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl")).sort().reverse();
    const lines = [];
    for (const file of files) {
      if (lines.length >= limit) break;
      const raw = await fs.readFile(path.join(dir, file), "utf8");
      const fileLines = raw.trim().split("\n").filter(Boolean).reverse();
      for (const line of fileLines) {
        if (lines.length >= limit) break;
        try {
          lines.push(JSON.parse(line));
        } catch {
          /* skip */
        }
      }
    }
    return lines.filter((l) => l.type === "open" || l.type === "close" || l.level === "warn").slice(0, limit);
  } catch {
    return [];
  }
}

export async function getDashboardPayload() {
  const state = await loadState();
  const equityHistory = (state.equityHistory ?? []).filter((p) => p.date && p.date !== "1970-01-01");
  const latest = equityHistory[equityHistory.length - 1] ?? {
    equity: state.cash ?? PAPER.initialCapital,
    cash: state.cash ?? PAPER.initialCapital,
    positions: state.positions?.length ?? 0,
    longs: countBySide(state.positions ?? [], "long"),
    shorts: countBySide(state.positions ?? [], "short"),
    date: state.lastRunDate,
  };

  const closed = state.closedTrades ?? [];
  const realizedPnl = closed.reduce((s, t) => s + (t.pnlUsd ?? 0), 0);

  return {
    updated_at: new Date().toISOString(),
    startedAt: state.startedAt,
    lastRunDate: state.lastRunDate,
    equity: latest.equity,
    cash: latest.cash ?? state.cash,
    initialCapital: PAPER.initialCapital,
    returnPct: ((latest.equity - PAPER.initialCapital) / PAPER.initialCapital) * 100,
    realizedPnl,
    openCount: state.positions?.length ?? 0,
    longCount: countBySide(state.positions ?? [], "long"),
    shortCount: countBySide(state.positions ?? [], "short"),
    pendingCount: state.pendingEntries?.length ?? 0,
    closedCount: closed.length,
    positions: state.positions ?? [],
    pendingEntries: (state.pendingEntries ?? []).map((p) => ({
      symbol: p.symbol,
      side: p.side,
      score: p.signal?.score,
      label: p.signal?.label,
      signalDate: p.signalDate,
    })),
    closedTrades: closed.slice(-20).reverse(),
    equityHistory,
    config: { backtest: BACKTEST, entry: ENTRY, exit: EXIT },
    activity: await loadRecentLogs(30),
  };
}

export async function getStrategiesPayload() {
  const backtest = await loadBacktestSummary();
  return {
    updated_at: new Date().toISOString(),
    strategies: STRATEGIES,
    portfolio: {
      initialCapital: BACKTEST.initialCapital,
      maxPositions: BACKTEST.maxPositions,
      maxLongPositions: BACKTEST.maxLongPositions,
      maxShortPositions: BACKTEST.maxShortPositions,
      positionSizePct: BACKTEST.positionSizePct,
      enableLongs: BACKTEST.enableLongs,
      enableShorts: BACKTEST.enableShorts,
    },
    backtest,
  };
}

import { BACKTEST, EXIT, PAPER } from "../config.js";
import { loadSymbolHistory, rowDate } from "../data/fetch.js";
import { scanEntries, shouldExit, sma200At, positionPnlPct } from "../backtest/signals.js";
import { BIG_STOCKS } from "../../tview/universe.js";
import { appendLog, countBySide, loadState, markToMarket, positionKey, saveState } from "./state.js";

const cfg = {
  ...BACKTEST,
  initialCapital: PAPER.initialCapital,
};

function applySlippage(price, action, slippagePct) {
  const factor = action === "buy" ? 1 + slippagePct / 100 : 1 - slippagePct / 100;
  return price * factor;
}

function daysBetween(startIso, endIso) {
  return Math.floor((new Date(endIso).getTime() - new Date(startIso).getTime()) / 86400000);
}

function canOpen(state, side) {
  if (state.positions.length >= cfg.maxPositions) return false;
  if (side === "long") {
    return cfg.enableLongs && countBySide(state.positions, "long") < cfg.maxLongPositions;
  }
  return cfg.enableShorts && countBySide(state.positions, "short") < cfg.maxShortPositions;
}

function openLong(state, { symbol, bar, date, signal }) {
  const entryPrice = applySlippage(bar.open, "buy", cfg.slippagePct);
  const budget = state.cash * cfg.positionSizePct;
  const shares = Math.floor((budget - cfg.commissionPerTrade) / entryPrice);
  if (shares <= 0) return null;
  const cost = shares * entryPrice + cfg.commissionPerTrade;
  if (cost > state.cash) return null;
  state.cash -= cost;
  const pos = {
    symbol,
    side: "long",
    shares,
    entryDate: date,
    entryPrice,
    costBasis: cost,
    signalLabel: signal?.label ?? null,
  };
  state.positions.push(pos);
  return pos;
}

function openShort(state, { symbol, bar, date, signal }) {
  const entryPrice = applySlippage(bar.open, "sell", cfg.slippagePct);
  const budget = state.cash * cfg.positionSizePct;
  const shares = Math.floor((budget - cfg.commissionPerTrade) / entryPrice);
  if (shares <= 0) return null;
  const proceeds = shares * entryPrice - cfg.commissionPerTrade;
  state.cash += proceeds;
  const pos = {
    symbol,
    side: "short",
    shares,
    entryDate: date,
    entryPrice,
    costBasis: proceeds,
    signalLabel: signal?.label ?? null,
  };
  state.positions.push(pos);
  return pos;
}

function closePosition(state, pos, bar, date, exitReason) {
  const holdDays = daysBetween(pos.entryDate, date);

  if (pos.side === "long") {
    const exitPrice = applySlippage(bar.close, "sell", cfg.slippagePct);
    const proceeds = pos.shares * exitPrice - cfg.commissionPerTrade;
    state.cash += proceeds;
    state.closedTrades.push({
      side: "long",
      symbol: pos.symbol,
      entryDate: pos.entryDate,
      exitDate: date,
      entryPrice: pos.entryPrice,
      exitPrice,
      shares: pos.shares,
      holdDays,
      pnlUsd: proceeds - pos.costBasis,
      pnlPct: ((proceeds - pos.costBasis) / pos.costBasis) * 100,
      exitReason,
      signalLabel: pos.signalLabel,
    });
  } else {
    const exitPrice = applySlippage(bar.close, "buy", cfg.slippagePct);
    const coverCost = pos.shares * exitPrice + cfg.commissionPerTrade;
    state.cash -= coverCost;
    state.closedTrades.push({
      side: "short",
      symbol: pos.symbol,
      entryDate: pos.entryDate,
      exitDate: date,
      entryPrice: pos.entryPrice,
      exitPrice,
      shares: pos.shares,
      holdDays,
      pnlUsd: pos.costBasis - coverCost,
      pnlPct: ((pos.costBasis - coverCost) / pos.costBasis) * 100,
      exitReason,
      signalLabel: pos.signalLabel,
    });
  }
}

export async function loadUniverseLatest({ refresh = false, maxAgeDays = 2 } = {}) {
  const symbols = BIG_STOCKS.map((s) => s.symbol);
  const latest = new Map();
  const now = Math.floor(Date.now() / 1000);
  const maxAgeSec = maxAgeDays * 86400;

  for (const symbol of symbols) {
    try {
      let rows = await loadSymbolHistory(symbol);
      const lastTime = rows[rows.length - 1]?.time ?? 0;
      if (refresh || now - lastTime > maxAgeSec) {
        rows = await loadSymbolHistory(symbol, { refresh: true });
      }
      if (rows.length >= 200) latest.set(symbol.toUpperCase(), rows);
    } catch (err) {
      await appendLog({ level: "warn", msg: `skip ${symbol}`, error: err.message });
    }
  }

  return latest;
}

function latestBarDate(universe) {
  let max = 0;
  for (const rows of universe.values()) {
    const last = rows[rows.length - 1];
    if (last.time > max) max = last.time;
  }
  return rowDate({ time: max });
}

function barOnDate(rows, isoDate) {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rowDate(rows[i]) === isoDate) {
      return { bar: rows[i], index: i, rows };
    }
  }
  return null;
}

export async function runPaperCycle({ force = false, refresh = false } = {}) {
  const state = await loadState();
  const universe = await loadUniverseLatest({ refresh });
  const today = latestBarDate(universe);

  if (!force && state.lastRunDate === today) {
    return { state, skipped: true, reason: `Already ran for ${today}` };
  }

  const actions = [];

  // Fill pending entries at today's open.
  for (const pending of state.pendingEntries.splice(0)) {
    const hit = barOnDate(universe.get(pending.symbol), today);
    if (!hit || !canOpen(state, pending.side)) continue;

    const pos =
      pending.side === "long"
        ? openLong(state, { symbol: pending.symbol, bar: hit.bar, date: today, signal: pending.signal })
        : openShort(state, { symbol: pending.symbol, bar: hit.bar, date: today, signal: pending.signal });

    if (pos) {
      actions.push({ type: "open", side: pending.side, symbol: pending.symbol, shares: pos.shares, price: pos.entryPrice });
      await appendLog({ type: "open", ...pos });
    }
  }

  // Manage exits on today's close.
  for (let i = state.positions.length - 1; i >= 0; i--) {
    const pos = state.positions[i];
    const hit = barOnDate(universe.get(pos.symbol), today);
    if (!hit) continue;

    const holdDays = daysBetween(pos.entryDate, today);
    const pnlPct = positionPnlPct(pos.side, pos.entryPrice, hit.bar.close);
    pos.peakPnlPct = Math.max(pos.peakPnlPct ?? pnlPct, pnlPct);

    const exitReason = shouldExit(pos.side, {
      entryPrice: pos.entryPrice,
      bar: hit.bar,
      sma200: sma200At(hit.rows, hit.index),
      holdDays,
      exitCfg: EXIT,
      dailyRows: hit.rows,
      barIndex: hit.index,
      peakPnlPct: pos.peakPnlPct,
    });

    if (!exitReason) continue;

    closePosition(state, pos, hit.bar, today, exitReason);
    actions.push({ type: "close", side: pos.side, symbol: pos.symbol, reason: exitReason });
    await appendLog({ type: "close", symbol: pos.symbol, side: pos.side, reason: exitReason });
    state.positions.splice(i, 1);
  }

  // Scan for signals at today's close; queue for next session.
  const held = new Set(state.positions.map((p) => positionKey(p.symbol, p.side)));
  const queued = new Set(state.pendingEntries.map((p) => positionKey(p.symbol, p.side)));
  const slots = cfg.maxPositions - state.positions.length - state.pendingEntries.length;
  const candidates = [];

  if (slots > 0) {
    for (const [symbol, rows] of universe) {
      const hit = barOnDate(rows, today);
      if (!hit) continue;

      const entries = scanEntries(rows.slice(0, hit.index + 1), {
        enableLongs: cfg.enableLongs,
        enableShorts: cfg.enableShorts,
      });

      for (const entry of entries) {
        const key = positionKey(symbol, entry.side);
        if (held.has(key) || queued.has(key)) continue;
        candidates.push({
          symbol,
          side: entry.side,
          signal: entry.signal,
          signalDate: today,
        });
      }
    }

    candidates.sort((a, b) => (b.signal?.score ?? 0) - (a.signal?.score ?? 0));
    const picked = candidates.slice(0, slots);
    state.pendingEntries.push(...picked);
    for (const c of picked) {
      actions.push({
        type: "queue",
        side: c.side,
        symbol: c.symbol,
        score: c.signal?.score,
        label: c.signal?.label,
      });
    }
  }

  const priceBySymbol = new Map();
  for (const [symbol, rows] of universe) {
    priceBySymbol.set(symbol, rows[rows.length - 1].close);
  }

  state.lastRunDate = today;
  state.equityHistory.push({
    date: today,
    equity: markToMarket(state, priceBySymbol),
    positions: state.positions.length,
    longs: countBySide(state.positions, "long"),
    shorts: countBySide(state.positions, "short"),
    cash: state.cash,
  });

  await saveState(state);
  return { state, skipped: false, today, actions };
}

export function formatPaperStatus(result) {
  const { state, skipped, today, actions } = result;
  if (skipped) return `\nPaper bot: ${result.reason}\n`;

  const last = state.equityHistory[state.equityHistory.length - 1];
  const lines = [
    "",
    "═══════════════════════════════════════════════════════",
    "  BOT-TRADER PAPER — daily cycle",
    "═══════════════════════════════════════════════════════",
    "",
    `Session date:  ${today}`,
    `Equity:        $${last.equity.toFixed(2)}`,
    `Cash:          $${state.cash.toFixed(2)}`,
    `Open:          ${state.positions.length} (${countBySide(state.positions, "long")} long · ${countBySide(state.positions, "short")} short)`,
    `Pending:       ${state.pendingEntries.length} queued for next open`,
    `Closed trades: ${state.closedTrades.length}`,
    "",
  ];

  if (state.positions.length) {
    lines.push("── Open positions ────────────────────────────────────");
    for (const p of state.positions) {
      lines.push(
        `  ${p.side === "short" ? "↓" : "↑"} ${p.symbol.padEnd(6)} ${p.shares} sh @ $${p.entryPrice.toFixed(2)}  (${p.entryDate})  ${p.signalLabel ?? ""}`
      );
    }
    lines.push("");
  }

  if (state.pendingEntries.length) {
    lines.push("── Queued for next open ──────────────────────────────");
    for (const p of state.pendingEntries) {
      lines.push(
        `  ${p.side === "short" ? "↓" : "↑"} ${p.symbol.padEnd(6)} score ${p.signal?.score ?? "?"}  ${p.signal?.label ?? ""}`
      );
    }
    lines.push("");
  }

  if (actions.length) {
    lines.push("── Actions this cycle ────────────────────────────────");
    for (const a of actions) {
      if (a.type === "open") {
        lines.push(`  OPEN ${a.side.toUpperCase()} ${a.symbol} ${a.shares} @ $${a.price.toFixed(2)}`);
      } else if (a.type === "close") {
        lines.push(`  CLOSE ${a.side.toUpperCase()} ${a.symbol} (${a.reason})`);
      } else if (a.type === "queue") {
        lines.push(`  QUEUE ${a.side.toUpperCase()} ${a.symbol}  ${a.label ?? ""}`);
      }
    }
    lines.push("");
  }

  lines.push("═══════════════════════════════════════════════════════", "");
  return lines.join("\n");
}

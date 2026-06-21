/**
 * Optional IBKR bridge — requires TWS or IB Gateway with API enabled.
 * Install: npm install ib
 * Enable in TWS: File → Global Configuration → API → Settings → Enable ActiveX and Socket Clients
 */
import { IBKR } from "../config.js";

let ibModule = null;

async function loadIb() {
  if (ibModule) return ibModule;
  try {
    const mod = await import("ib");
    ibModule = mod.default ?? mod;
    return ibModule;
  } catch {
    throw new Error("IBKR package not installed. Run: npm install ib");
  }
}

function contract(symbol) {
  return {
    symbol: symbol.toUpperCase(),
    secType: "STK",
    exchange: "SMART",
    currency: "USD",
  };
}

function marketOrder(action, quantity) {
  return {
    action,
    orderType: "MKT",
    totalQuantity: quantity,
    tif: "DAY",
    transmit: true,
  };
}

export async function connectIbkr() {
  const IB = await loadIb();
  const ib = new IB({ clientId: IBKR.clientId, host: IBKR.host, port: IBKR.port });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("IBKR connection timeout")), 15000);
    ib.on("connected", () => {
      clearTimeout(timer);
      resolve();
    });
    ib.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ib.connect();
  });

  return ib;
}

export async function getIbkrAccount(ib) {
  if (IBKR.account) return IBKR.account;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("account timeout")), 10000);
    ib.reqManagedAccts();
    ib.on("managedAccounts", (accounts) => {
      clearTimeout(timer);
      const list = accounts.split(",").filter(Boolean);
      const paper = list.find((a) => a.startsWith("DU")) ?? list[0];
      resolve(paper);
    });
  });
}

let nextOrderId = 1;

export function placeStockOrder(ib, { symbol, action, quantity, account }) {
  const id = nextOrderId++;
  ib.placeOrder(id, contract(symbol), { ...marketOrder(action, quantity), account });
  return id;
}

/** Sync paper signals to IBKR — opens and closes to match local state deltas. */
export async function syncOrdersToIbkr({ opens = [], closes = [] }) {
  const ib = await connectIbkr();
  const account = await getIbkrAccount(ib);
  const placed = [];

  for (const item of closes) {
    const action = item.side === "long" ? "SELL" : "BUY";
    const id = placeStockOrder(ib, { symbol: item.symbol, action, quantity: item.shares, account });
    placed.push({ type: "close", orderId: id, ...item });
  }

  for (const item of opens) {
    const action = item.side === "long" ? "BUY" : "SELL";
    const id = placeStockOrder(ib, { symbol: item.symbol, action, quantity: item.shares, account });
    placed.push({ type: "open", orderId: id, ...item });
  }

  ib.disconnect();
  return { account, placed };
}

export async function checkIbkrAvailable() {
  try {
    const ib = await connectIbkr();
    ib.disconnect();
    return true;
  } catch {
    return false;
  }
}

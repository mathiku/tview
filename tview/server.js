import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { addPinned, loadPinned, removePinned } from "./pinned.js";
import {
  DEFAULT_SYMBOL,
  analyzeSymbols,
  buildScanUniverse,
  clearOverviewCache,
  fetchSymbolMeta,
  getOverview,
  getPayload,
  getStocksForPicker,
  resolveSymbol,
} from "./stocks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Cloud hosts inject PORT and require binding all interfaces; default to local.
const PORT = process.env.PORT ?? 5050;
const HOST = process.env.BIND_HOST ?? "0.0.0.0";

app.use(express.json());
app.use("/static", express.static(path.join(__dirname, "static")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "static", "overview.html"));
});

app.get("/stock", (_req, res) => {
  res.sendFile(path.join(__dirname, "static", "stock.html"));
});

app.get("/watchlist", (_req, res) => {
  res.sendFile(path.join(__dirname, "static", "watchlist.html"));
});

app.get("/api/stocks", async (_req, res) => {
  try {
    res.json({
      default: DEFAULT_SYMBOL,
      stocks: await getStocksForPicker(),
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/pinned", async (_req, res) => {
  try {
    res.json({ stocks: await loadPinned() });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/pinned", async (req, res) => {
  try {
    const raw = String(req.body?.symbol ?? "").trim().toUpperCase();
    if (!raw) {
      res.status(400).json({ error: "Symbol is required" });
      return;
    }

    const meta = await fetchSymbolMeta(raw);
    const stocks = await addPinned(meta);
    clearOverviewCache();
    res.json({ stocks });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/pinned/:symbol", async (req, res) => {
  try {
    const stocks = await removePinned(req.params.symbol);
    clearOverviewCache();
    res.json({ stocks });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/overview", async (_req, res) => {
  try {
    res.json(await getOverview());
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/analyze", async (req, res) => {
  try {
    const raw = String(req.query.symbols ?? "").trim();
    if (!raw) return res.json({ stocks: [] });
    const symbols = raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 40);
    res.json({ stocks: await analyzeSymbols(symbols) });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/stock", async (req, res) => {
  try {
    const symbol = resolveSymbol(req.query.symbol);
    res.json(await getPayload(symbol));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, HOST, async () => {
  try {
    await buildScanUniverse();
  } catch (err) {
    console.error("Failed to build initial scan universe:", err);
  }
  console.log(`Dashboard running at http://${HOST}:${PORT}`);
});

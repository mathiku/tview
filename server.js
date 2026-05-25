import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  DEFAULT_SYMBOL,
  TOP_STOCKS,
  getOverview,
  getPayload,
  resolveSymbol,
} from "./stocks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 5050;

app.use("/static", express.static(path.join(__dirname, "static")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "static", "overview.html"));
});

app.get("/stock", (_req, res) => {
  res.sendFile(path.join(__dirname, "static", "stock.html"));
});

app.get("/api/stocks", (_req, res) => {
  res.json({ default: DEFAULT_SYMBOL, stocks: TOP_STOCKS });
});

app.get("/api/overview", async (_req, res) => {
  try {
    res.json(await getOverview());
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

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Dashboard running at http://127.0.0.1:${PORT}`);
});

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDashboardPayload, getStrategiesPayload, getTradesPayload } from "./api/data.js";
import { runPaperCycle } from "./paper/runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 5051;
const HOST = process.env.BIND_HOST ?? "127.0.0.1";

app.use(express.json());
app.use("/static", express.static(path.join(__dirname, "static")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "static", "index.html"));
});

app.get("/strategies", (_req, res) => {
  res.sendFile(path.join(__dirname, "static", "strategies.html"));
});

app.get("/trades", (_req, res) => {
  res.sendFile(path.join(__dirname, "static", "trades.html"));
});

app.get("/api/dashboard", async (_req, res) => {
  try {
    res.json(await getDashboardPayload());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/strategies", async (_req, res) => {
  try {
    res.json(await getStrategiesPayload());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/trades", async (req, res) => {
  try {
    res.json(
      await getTradesPayload({
        source: req.query.source ?? "backtest",
        side: req.query.side ?? "all",
        year: req.query.year ?? "all",
      })
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/run-cycle", async (req, res) => {
  try {
    const force = Boolean(req.body?.force);
    const result = await runPaperCycle({ force });
    res.json({
      ok: true,
      skipped: result.skipped,
      today: result.today,
      actions: result.actions ?? [],
      dashboard: await getDashboardPayload(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Bot dashboard at http://${HOST}:${PORT}`);
  console.log(`Strategy report at http://${HOST}:${PORT}/strategies`);
  console.log(`All trades at http://${HOST}:${PORT}/trades`);
});

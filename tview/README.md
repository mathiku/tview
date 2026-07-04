# NFLX Stock Dashboard

A simple local dashboard showing Netflix (NFLX) stock price with 100/200 period simple moving averages across daily, weekly, and monthly charts, plus a comparison table.

## Setup

```bash
cd /home/mk/Documents/tview
npm install
```

## Run

```bash
npm start
```

Open [http://127.0.0.1:5050](http://127.0.0.1:5050) for the **Pullback Watch** overview.

**Watchlist** ([http://127.0.0.1:5050/watchlist](http://127.0.0.1:5050/watchlist)) — pin stocks that are always scanned. Each day ~55 random large caps are added from a pool of ~170.

Individual chart views are at [http://127.0.0.1:5050/stock](http://127.0.0.1:5050/stock). The scanner covers ~70 large-cap US names. Click any row on the overview to jump to that stock's charts.

Chart defaults:
- Daily: last 1 month
- Weekly: last 1 year
- Monthly: last 10 years (or all available history if shorter)

## Backtest

**Backtest** ([http://127.0.0.1:5050/backtest](http://127.0.0.1:5050/backtest)) — pick one stock, a date range, and either the built-in pullback/rally strategy (tunable stop/target/hold/filters) or **Custom rules** written in a small expression language (e.g. `rsi < 30 and close > sma200`). Shows an equity curve, a price chart with entry/exit markers, summary metrics, and every trade.

### Natural-language rules (optional)

The Custom-rules tab has a "Describe it in plain English" box that uses a small LLM to fill in the entry/exit rules for you to review. It's off unless you configure a provider via environment variables (the rest of the app works without it):

```bash
# Google Gemini (free tier) — the default provider
export GEMINI_API_KEY=...            # from aistudio.google.com
# export LLM_MODEL=gemini-2.0-flash  # optional override

# OR any OpenAI-compatible endpoint (Groq, OpenAI, local Ollama, …)
export LLM_PROVIDER=openai
export LLM_BASE_URL=https://api.groq.com/openai/v1
export LLM_MODEL=llama-3.3-70b-versatile
export LLM_API_KEY=...
```

The model only translates English into the rule language; the generated rules are validated by the same parser the backtest uses, so a bad translation surfaces as an error rather than a broken run.

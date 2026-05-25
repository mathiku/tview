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

Open [http://127.0.0.1:5050](http://127.0.0.1:5050) for the **LONG overview** — a table of all 15 stocks vs their 6 SMAs with a signal score.

Individual chart views are at [http://127.0.0.1:5050/stock](http://127.0.0.1:5050/stock). Click any row on the overview to jump to that stock's charts.

Chart defaults:
- Daily: last 1 month
- Weekly: last 1 year
- Monthly: last 10 years (or all available history if shorter)

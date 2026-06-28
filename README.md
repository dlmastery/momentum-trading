# SimpleTrade — Momentum ETF Backtester

A web app that takes an ETF/index (Nasdaq-100, S&P 500, Dow 30), fetches and
**caches** the daily price history of every constituent, then **backtests** a
daily end-of-day momentum strategy over a configurable window (default: last
6 months) spreading a **$10,000** budget.

## The strategy

**Entry signal** (all must hold on the same day):
- **4 consecutive up days** (close higher than prior close, 4 days running)
- **4 consecutive up weeks** (4 rising weekly closes in a row)
- **Analysts bullish** — Yahoo analyst consensus is Buy or Strong Buy

**Ranking / "return potential" score** — eligible stocks are scored on exactly
**three factors, equal-weighted**, all expressed as percentages:

```
score = ( 4-day price growth
        + 4-week price growth
        + analyst mean price-target upside ) / 3
```

The candidates are sorted by score (highest first) and the **top ranks** are
bought into 20 equal **$500 slots** ($10,000 ÷ 20).

**Position management** — re-evaluated every end-of-day. A position is **exited**
when either:
- **2 consecutive down days**, or
- a **rapid drop** of ≥ 20% in a single day.

A single down day does **not** sell — you hold through it and only exit on two
in a row (or the rapid drop). Freed capital is redeployed into the
next-highest-scoring new signals.

A **benchmark** (equal-weight buy & hold of the whole universe over the window)
is plotted alongside the strategy equity curve for comparison.

All thresholds live in `lib/strategy.ts` (`PARAMS`) and are easy to tune.

## What the UI shows (full audit trail)

Everything is laid out as an auditable, day-by-day ledger:

- **Summary cards** — final equity, strategy vs benchmark return, max drawdown,
  win rate, etc.
- **Equity curve** vs the benchmark.
- **Day picker** — a heatmap grid (every stock × every day, green/red by daily
  move, with B/S/hold markers), plus a slider and First/Prev/Next/Last controls.
  Click any column to inspect that day.
- **Per-day inspector** for the selected day:
  - Portfolio totals (equity, cash, invested, that day's P&L, cumulative).
  - **Entering / Exiting / Holding** blocks — exactly what was bought, sold
    (with realised P&L and reason), and carried over.
  - A **qualification funnel** — e.g. `95 stocks → 42 up → 6 with 4 up-days →
    1 with 4 up-weeks → 1 analyst-Buy → 1 eligible` — so it's obvious why so
    few names trade on a given day (it's the strict gate, not a bug).
  - A **full-index scan**: *every* stock ranked by score, with its last 4 days
    and last 4 weeks as 🟩/🟥 squares, the up-day/up-week streak counts, analyst
    rating, the three factor values, an **In-trade** flag, and the exact reason
    it was or wasn't traded.
- **Full trade log** of every round trip.

## Data & the "analyst ratings" approximation

- **Prices**: [Yahoo Finance](https://finance.yahoo.com) split/dividend-adjusted
  daily bars, fetched with limited concurrency and **cached on disk** under
  `.cache/prices/` (12-hour TTL). The first run for a universe fills the cache;
  subsequent runs are near-instant.
- **Analyst ratings**: **real** Yahoo Finance analyst consensus (`recommendationKey`)
  and **mean price targets**, fetched via the crumb/cookie handshake in
  `lib/analyst.ts` and cached on disk. One honest limitation: these are *current*
  values (Yahoo doesn't expose historical targets for free), so the same rating is
  applied across the backtest window — a mild look-ahead on factor 3.
- **Constituents**: bundled recent snapshots in `lib/etfs.ts` (live, point-in-time
  index membership requires a paid provider).

> Research/education tool only. Not investment advice. Past performance — even
> simulated — does not predict future results.

## Limitations a skeptical analyst should know

This is a teaching scaffold, not a demonstrated edge. Known weaknesses:

- **Survivorship bias** — the constituent lists are *current* index members, so
  delisted/dropped names are absent, which flatters results.
- **Look-ahead on analyst data** — current analyst ratings/targets are applied
  across the whole backtest (no free historical feed).
- **Same-close execution** — the signal is computed on a day's close and the
  trade is filled at that same close; a realistic test would trade next open.
- **No costs** — no commissions, spread, or slippage; fractional shares assumed.
- **Short-horizon signals** — "4 up days / 4 up weeks" sit in the window where
  the literature documents *short-term reversal* (mean reversion); classic
  momentum uses 6–12 month returns. Analyst rating *levels* are also weaker
  signals than *revisions*.
- **Tiny sample** — a 6-month window with a few dozen trades is not statistically
  meaningful.

## Fully static — runs in your browser, deploys to GitHub Pages

All data is **pre-fetched into static JSON** and the **entire backtest runs
client-side** — there is no server. That means you can host it on GitHub Pages
(or any static host) and still get a fully interactive dashboard, including
**tunable parameters** that re-run instantly.

### 1. Generate the data (one-time / when refreshing)

```bash
node scripts/fetch-data.mjs
# behind a TLS-intercepting corporate proxy:
ALLOW_INSECURE_TLS=1 node scripts/fetch-data.mjs
```

This writes `public/data/{etf}.json` (prices + real Yahoo analyst ratings) and
`public/data/etfs.json`. These files are committed to the repo.

### 2. Develop / preview

```bash
npm install
npm run dev          # http://localhost:3000
```

### 3. Build the static site

```bash
npm run build        # emits ./out (static export)
BASE_PATH="" npm run build   # if serving from the domain root instead of /momentum-trading
```

### Deploy to GitHub Pages

`.github/workflows/deploy.yml` builds and deploys `./out` on every push to
`main`. In the repo, set **Settings → Pages → Source = GitHub Actions**. The
site publishes at `https://<user>.github.io/momentum-trading/` (the `basePath`
in `next.config.mjs` matches the repo name).

## How it's built

- **Next.js (App Router, static export)** + React, TypeScript.
- `lib/types.ts` — pure, dependency-free types + `isBullish` (browser-safe).
- `lib/strategy.ts` — indicators, entry/exit signals, scoring, the daily
  backtest engine, the per-day universe scan/funnel. **Runs in the browser.**
- `lib/etfs.json` / `lib/etfs.ts` — constituent lists (single source of truth).
- `lib/loadData.ts` — loads the static JSON and runs the backtest client-side.
- `scripts/fetch-data.mjs` — Node build script that pre-fetches all data.
- `lib/prices.ts` / `lib/analyst.ts` — Node-only fetchers used by the script.
- `app/page.tsx` — the whole dashboard: methodology doc, controls + tunable
  parameters, summary, equity curve, day inspector, universe scan, trade log,
  and the per-ticker chart modal.

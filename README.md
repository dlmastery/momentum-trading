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

## Run it

```bash
npm install
npm run dev
# open http://localhost:3000
```

Pick an ETF, set the history depth and backtest window, and click **Run backtest**.

### Behind a TLS-intercepting (corporate) proxy

If price fetches fail with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, your network is
intercepting TLS. Opt into relaxed verification for local dev only:

```powershell
$env:ALLOW_INSECURE_TLS = "1"; npm run dev    # PowerShell
```

```bash
ALLOW_INSECURE_TLS=1 npm run dev              # bash
```

## How it's built

- **Next.js (App Router)** + React, TypeScript.
- `lib/etfs.ts` — constituent lists.
- `lib/prices.ts` — price data fetching + on-disk cache.
- `lib/analyst.ts` — Yahoo analyst ratings/targets (crumb handshake) + cache.
- `lib/strategy.ts` — indicators, entry/exit signals, scoring, the daily
  backtest engine, and the per-day universe scan/funnel.
- `app/api/backtest` — runs a backtest for a requested ETF/window.
- `app/page.tsx` — UI: controls, summary, equity curve, day inspector, trade log.

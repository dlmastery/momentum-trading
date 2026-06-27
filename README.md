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
- a **rapid drop** of ≥ 7% in a single day.

Freed capital is redeployed into the next-highest-scoring new signals.

A **benchmark** (equal-weight buy & hold of the whole universe over the window)
is plotted alongside the strategy equity curve for comparison.

All thresholds live in `lib/strategy.ts` (`PARAMS`) and are easy to tune.

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
- `lib/prices.ts` — data fetching + on-disk cache.
- `lib/strategy.ts` — indicators, entry/exit signals, scoring, and the
  lookahead-free daily backtest engine.
- `app/api/backtest` — runs a backtest for a requested ETF/window.
- `app/page.tsx` — UI: controls, summary cards, equity curve, trade log.
```

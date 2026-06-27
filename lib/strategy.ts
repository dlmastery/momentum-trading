import { Bar } from "./prices";

// ---- Tunable strategy parameters -------------------------------------------
export const PARAMS = {
  consecutiveUpDays: 4, // "four consecutive days increase"
  consecutiveUpWeeks: 4, // "four consecutive weeks increase"
  rapidDropPct: 0.07, // single-day drop that forces an exit (7%)
  consecutiveDownDays: 2, // "two consecutive downs" forces an exit
  maxPositions: 20, // "pick top 20 stocks to trade"
  budget: 10000, // "$10,000 budget"
  smaPeriod: 200, // long-term trend for fundamentals proxy
  ret6mDays: 126, // ~6 months of trading days
  ret1mDays: 21, // ~1 month of trading days
};

// ---------------------------------------------------------------------------

function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return `${d.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

export interface TickerSeries {
  ticker: string;
  bars: Bar[];
  dateToIdx: Map<string, number>;
  upDays: number[];
  downDays: number[];
  weekUpStreak: number[];
  sma200: (number | null)[];
  ret6m: (number | null)[];
  ret1m: (number | null)[];
  dayReturn: (number | null)[];
}

export function buildSeries(ticker: string, bars: Bar[]): TickerSeries {
  const n = bars.length;
  const close = bars.map((b) => b.close);
  const upDays = new Array<number>(n).fill(0);
  const downDays = new Array<number>(n).fill(0);
  const weekUpStreak = new Array<number>(n).fill(0);
  const sma200 = new Array<number | null>(n).fill(null);
  const ret6m = new Array<number | null>(n).fill(null);
  const ret1m = new Array<number | null>(n).fill(null);
  const dayReturn = new Array<number | null>(n).fill(null);
  const dateToIdx = new Map<string, number>();

  const completedWeekCloses: number[] = [];
  let curWeekKey = n > 0 ? isoWeekKey(bars[0].date) : "";
  let curWeekClose = n > 0 ? close[0] : 0;
  let smaSum = 0;

  for (let i = 0; i < n; i++) {
    dateToIdx.set(bars[i].date, i);

    if (i > 0) {
      dayReturn[i] = close[i] / close[i - 1] - 1;
      if (close[i] > close[i - 1]) {
        upDays[i] = upDays[i - 1] + 1;
        downDays[i] = 0;
      } else if (close[i] < close[i - 1]) {
        downDays[i] = downDays[i - 1] + 1;
        upDays[i] = 0;
      }
    }

    const wk = isoWeekKey(bars[i].date);
    if (wk !== curWeekKey) {
      completedWeekCloses.push(curWeekClose);
      curWeekKey = wk;
    }
    curWeekClose = close[i];
    let ws = 0;
    for (let k = completedWeekCloses.length - 1; k > 0; k--) {
      if (completedWeekCloses[k] > completedWeekCloses[k - 1]) ws++;
      else break;
    }
    weekUpStreak[i] = ws;

    smaSum += close[i];
    if (i >= PARAMS.smaPeriod) smaSum -= close[i - PARAMS.smaPeriod];
    if (i >= PARAMS.smaPeriod - 1) sma200[i] = smaSum / PARAMS.smaPeriod;

    if (i >= PARAMS.ret6mDays) ret6m[i] = close[i] / close[i - PARAMS.ret6mDays] - 1;
    if (i >= PARAMS.ret1mDays) ret1m[i] = close[i] / close[i - PARAMS.ret1mDays] - 1;
  }

  return { ticker, bars, dateToIdx, upDays, downDays, weekUpStreak, sma200, ret6m, ret1m, dayReturn };
}

/** Fundamentals/analyst-bullish proxy: durable uptrend + positive 6m return. */
export function bullishFundamentals(s: TickerSeries, i: number): boolean {
  const sma = s.sma200[i];
  const r6 = s.ret6m[i];
  if (sma === null || r6 === null) return false;
  return s.bars[i].close > sma && r6 > 0;
}

/** Entry signal: 4 up days AND 4 up weeks AND bullish fundamentals proxy. */
export function buySignal(s: TickerSeries, i: number): boolean {
  return (
    s.upDays[i] >= PARAMS.consecutiveUpDays &&
    s.weekUpStreak[i] >= PARAMS.consecutiveUpWeeks &&
    bullishFundamentals(s, i)
  );
}

/** Composite momentum score ranking "return potential". Higher = better. */
export function momentumScore(s: TickerSeries, i: number): number {
  const sma = s.sma200[i];
  const r6 = s.ret6m[i] ?? 0;
  const r1 = s.ret1m[i] ?? 0;
  const aboveSma = sma ? s.bars[i].close / sma - 1 : 0;
  return 0.5 * r6 + 0.3 * aboveSma + 0.2 * r1;
}

/** Exit signal: two consecutive down days OR a rapid single-day drop. */
export function exitSignal(s: TickerSeries, i: number): string | null {
  const dr = s.dayReturn[i];
  if (dr !== null && dr <= -PARAMS.rapidDropPct) return `Rapid drop ${(dr * 100).toFixed(1)}%`;
  if (s.downDays[i] >= PARAMS.consecutiveDownDays) return `${s.downDays[i]} down days`;
  return null;
}

// ---- Result types ----------------------------------------------------------

export interface Trade {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string | null;
  exitPrice: number | null;
  shares: number;
  returnPct: number | null;
  pnl: number | null;
  exitReason: string | null;
  scoreAtEntry: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
  cash: number;
  positions: number;
  benchmark: number;
}

/** One row in a day's ranking of buy-signal candidates. */
export interface RankedRow {
  ticker: string;
  rank: number;
  score: number;
  dayReturnPct: number | null;
  upDays: number;
  upWeeks: number;
  allocated: number; // $ put to work this day (0 if not bought)
  status: "BUY" | "HELD" | "SKIPPED"; // SKIPPED = signalled but no slot/cash
}

export interface DayAction {
  ticker: string;
  type: "BUY" | "SELL" | "HOLD";
  shares: number;
  price: number;
  allocated: number; // cost basis put to work (BUY) or current value
  pnl: number | null; // realised (SELL) or unrealised (HOLD)
  returnPct: number | null;
  reason: string | null;
}

export interface HoldingRow {
  ticker: string;
  shares: number;
  entryDate: string;
  entryPrice: number;
  price: number;
  value: number;
  unrealizedPct: number;
}

export interface DailyRecord {
  date: string;
  ranked: RankedRow[]; // every stock that fired the entry signal today, ranked
  actions: DayAction[]; // BUY / SELL / HOLD decisions made today
  holdings: HoldingRow[]; // portfolio at end of day
  cash: number;
  invested: number;
  equity: number;
  dayPnl: number;
  cumReturnPct: number;
}

export interface BacktestResult {
  startDate: string;
  endDate: string;
  startEquity: number;
  endEquity: number;
  totalReturnPct: number;
  benchmarkReturnPct: number;
  maxDrawdownPct: number;
  numTrades: number;
  winRate: number;
  avgTradeReturnPct: number;
  bestTrade: Trade | null;
  worstTrade: Trade | null;
  trades: Trade[];
  equityCurve: EquityPoint[];
  openPositionsAtEnd: HoldingRow[];
  universeSize: number;
  tickersWithData: number;
  // ---- detailed ledger for the spreadsheet view ----
  dates: string[];
  tickers: string[]; // universe rows (those ever signalled or held), sorted
  returnsMatrix: (number | null)[][]; // [tickerIdx][dateIdx] daily % change
  statusMatrix: number[][]; // 0 none, 1 held, 2 buy, 3 sell, 4 signalled-not-bought
  days: DailyRecord[];
}

interface OpenPos {
  ticker: string;
  shares: number;
  entryPrice: number;
  entryDate: string;
  scoreAtEntry: number;
}

/**
 * Daily end-of-day backtest. Signals on day d use only data through d
 * (no lookahead); trades execute at day d's close.
 */
export function backtest(seriesMap: Record<string, TickerSeries>, monthsBack = 6): BacktestResult {
  const allSeries = Object.values(seriesMap).filter((s) => s.bars.length > PARAMS.smaPeriod);

  const dateSet = new Set<string>();
  let latest = "";
  for (const s of allSeries) {
    for (const b of s.bars) {
      dateSet.add(b.date);
      if (b.date > latest) latest = b.date;
    }
  }
  const allDates = Array.from(dateSet).sort();

  const endD = new Date(latest + "T00:00:00Z");
  const startD = new Date(endD);
  startD.setUTCMonth(startD.getUTCMonth() - monthsBack);
  const startStr = startD.toISOString().slice(0, 10);
  const windowDates = allDates.filter((d) => d >= startStr && d <= latest);

  const slotSize = PARAMS.budget / PARAMS.maxPositions;
  let cash = PARAMS.budget;
  const open = new Map<string, OpenPos>();
  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];
  const days: DailyRecord[] = [];

  // Benchmark: equal-weight buy & hold of all data-bearing tickers.
  let benchInit: { ticker: string; shares: number }[] | null = null;

  let peakEquity = PARAMS.budget;
  let maxDrawdown = 0;
  let prevEquity = PARAMS.budget;

  // Track which tickers ever participate (for compact matrix rows).
  const involved = new Set<string>();

  function priceOn(s: TickerSeries, date: string): number | null {
    const i = s.dateToIdx.get(date);
    return i === undefined ? null : s.bars[i].close;
  }

  for (const date of windowDates) {
    const soldToday = new Set<string>();
    const boughtToday = new Set<string>();
    const actions: DayAction[] = [];

    // 1) Exits (sells) at today's close.
    for (const [ticker, pos] of Array.from(open.entries())) {
      const s = seriesMap[ticker];
      const i = s.dateToIdx.get(date);
      if (i === undefined) continue;
      const reason = exitSignal(s, i);
      if (reason) {
        const px = s.bars[i].close;
        cash += pos.shares * px;
        const ret = px / pos.entryPrice - 1;
        const pnl = pos.shares * (px - pos.entryPrice);
        trades.push({
          ticker,
          entryDate: pos.entryDate,
          entryPrice: pos.entryPrice,
          exitDate: date,
          exitPrice: px,
          shares: pos.shares,
          returnPct: ret,
          pnl,
          exitReason: reason,
          scoreAtEntry: pos.scoreAtEntry,
        });
        actions.push({ ticker, type: "SELL", shares: pos.shares, price: px, allocated: pos.shares * px, pnl, returnPct: ret, reason });
        open.delete(ticker);
        soldToday.add(ticker);
        involved.add(ticker);
      }
    }

    // 2) Rank all of today's buy-signal candidates, then fill open slots.
    const ranked: RankedRow[] = [];
    const candidates: { s: TickerSeries; i: number; score: number; price: number }[] = [];
    for (const s of allSeries) {
      const i = s.dateToIdx.get(date);
      if (i === undefined) continue;
      if (buySignal(s, i)) candidates.push({ s, i, score: momentumScore(s, i), price: s.bars[i].close });
    }
    candidates.sort((a, b) => b.score - a.score);

    candidates.forEach((c, idx) => {
      const ticker = c.s.ticker;
      involved.add(ticker);
      let status: RankedRow["status"];
      let allocated = 0;
      const alreadyHeld = open.has(ticker);
      if (alreadyHeld) {
        status = "HELD";
      } else if (!soldToday.has(ticker) && open.size < PARAMS.maxPositions && cash >= slotSize && c.price > 0) {
        // Buy this rank.
        const shares = slotSize / c.price;
        cash -= slotSize;
        open.set(ticker, { ticker, shares, entryPrice: c.price, entryDate: date, scoreAtEntry: c.score });
        boughtToday.add(ticker);
        allocated = slotSize;
        status = "BUY";
        actions.push({ ticker, type: "BUY", shares, price: c.price, allocated: slotSize, pnl: null, returnPct: null, reason: `Rank #${idx + 1}` });
      } else {
        status = "SKIPPED"; // signalled but no slot / no cash / sold today
      }
      ranked.push({
        ticker,
        rank: idx + 1,
        score: c.score,
        dayReturnPct: c.s.dayReturn[c.i],
        upDays: c.s.upDays[c.i],
        upWeeks: c.s.weekUpStreak[c.i],
        allocated,
        status,
      });
    });

    // 3) HOLD actions for positions carried over (not bought/sold today).
    for (const [ticker, pos] of open.entries()) {
      if (boughtToday.has(ticker)) continue;
      const s = seriesMap[ticker];
      const i = s.dateToIdx.get(date);
      const px = i !== undefined ? s.bars[i].close : pos.entryPrice;
      involved.add(ticker);
      actions.push({ ticker, type: "HOLD", shares: pos.shares, price: px, allocated: pos.shares * px, pnl: pos.shares * (px - pos.entryPrice), returnPct: px / pos.entryPrice - 1, reason: null });
    }

    // 4) Holdings snapshot + portfolio totals.
    const holdings: HoldingRow[] = [];
    let invested = 0;
    for (const pos of open.values()) {
      const s = seriesMap[pos.ticker];
      const i = s.dateToIdx.get(date);
      const px = i !== undefined ? s.bars[i].close : pos.entryPrice;
      const value = pos.shares * px;
      invested += value;
      holdings.push({ ticker: pos.ticker, shares: pos.shares, entryDate: pos.entryDate, entryPrice: pos.entryPrice, price: px, value, unrealizedPct: px / pos.entryPrice - 1 });
    }
    holdings.sort((a, b) => b.value - a.value);
    const equity = cash + invested;

    // Benchmark equal-weight buy&hold initialised on first window day.
    if (benchInit === null) {
      benchInit = [];
      const per = PARAMS.budget / Math.max(1, allSeries.length);
      for (const s of allSeries) {
        const px = priceOn(s, date);
        if (px && px > 0) benchInit.push({ ticker: s.ticker, shares: per / px });
      }
    }
    let benchVal = 0;
    for (const b of benchInit) {
      const px = priceOn(seriesMap[b.ticker], date);
      if (px) benchVal += b.shares * px;
    }

    peakEquity = Math.max(peakEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, (peakEquity - equity) / peakEquity);

    equityCurve.push({ date, equity, cash, positions: open.size, benchmark: benchVal });
    days.push({
      date,
      ranked,
      actions: actions.sort((a, b) => {
        const order = { SELL: 0, BUY: 1, HOLD: 2 } as const;
        return order[a.type] - order[b.type];
      }),
      holdings,
      cash,
      invested,
      equity,
      dayPnl: equity - prevEquity,
      cumReturnPct: equity / PARAMS.budget - 1,
    });
    prevEquity = equity;
  }

  // Build compact matrices for the heatmap (rows = involved tickers).
  const tickers = Array.from(involved).sort();
  const tIdx = new Map(tickers.map((t, i) => [t, i]));
  const returnsMatrix: (number | null)[][] = tickers.map(() => windowDates.map(() => null));
  const statusMatrix: number[][] = tickers.map(() => windowDates.map(() => 0));
  windowDates.forEach((date, di) => {
    for (const t of tickers) {
      const s = seriesMap[t];
      const i = s?.dateToIdx.get(date);
      if (i === undefined) continue;
      const ti = tIdx.get(t)!;
      const dr = s.dayReturn[i];
      returnsMatrix[ti][di] = dr === null ? null : Math.round(dr * 10000) / 100; // %, 2dp
    }
  });
  // Overlay statuses from the day ledger.
  days.forEach((day, di) => {
    for (const a of day.actions) {
      const ti = tIdx.get(a.ticker);
      if (ti === undefined) continue;
      statusMatrix[ti][di] = a.type === "SELL" ? 3 : a.type === "BUY" ? 2 : 1;
    }
    for (const r of day.ranked) {
      const ti = tIdx.get(r.ticker);
      if (ti === undefined) continue;
      if (statusMatrix[ti][di] === 0 && r.status === "SKIPPED") statusMatrix[ti][di] = 4;
    }
  });

  const lastDate = windowDates[windowDates.length - 1];
  const openPositionsAtEnd: HoldingRow[] =
    days.length > 0 ? days[days.length - 1].holdings : [];

  const endEquity = equityCurve.length ? equityCurve[equityCurve.length - 1].equity : PARAMS.budget;
  const closed = trades.filter((t) => t.returnPct !== null);
  const wins = closed.filter((t) => (t.returnPct as number) > 0).length;
  const avgRet = closed.length ? closed.reduce((a, t) => a + (t.returnPct as number), 0) / closed.length : 0;
  const sorted = [...closed].sort((a, b) => (b.returnPct as number) - (a.returnPct as number));
  const benchStart = equityCurve.length ? equityCurve[0].benchmark : PARAMS.budget;
  const benchEnd = equityCurve.length ? equityCurve[equityCurve.length - 1].benchmark : PARAMS.budget;

  return {
    startDate: windowDates[0] ?? startStr,
    endDate: lastDate ?? latest,
    startEquity: PARAMS.budget,
    endEquity,
    totalReturnPct: endEquity / PARAMS.budget - 1,
    benchmarkReturnPct: benchStart ? benchEnd / benchStart - 1 : 0,
    maxDrawdownPct: maxDrawdown,
    numTrades: closed.length,
    winRate: closed.length ? wins / closed.length : 0,
    avgTradeReturnPct: avgRet,
    bestTrade: sorted[0] ?? null,
    worstTrade: sorted[sorted.length - 1] ?? null,
    trades: trades.sort((a, b) => (a.entryDate < b.entryDate ? -1 : 1)),
    equityCurve,
    openPositionsAtEnd,
    universeSize: allSeries.length,
    tickersWithData: allSeries.length,
    dates: windowDates,
    tickers,
    returnsMatrix,
    statusMatrix,
    days,
  };
}

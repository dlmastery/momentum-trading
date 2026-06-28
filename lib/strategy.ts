import { Bar } from "./prices";
import { AnalystInfo, isBullish } from "./analyst";

// ---- Tunable strategy parameters -------------------------------------------
export const PARAMS = {
  consecutiveUpDays: 4, // "four consecutive days increase"
  consecutiveUpWeeks: 4, // "four consecutive weeks increase"
  rapidDropPct: 0.20, // single-day drop that forces an exit (20%)
  consecutiveDownDays: 2, // "two consecutive downs" forces an exit
  maxPositions: 20, // "pick top 20 stocks to trade"
  budget: 10000, // "$10,000 budget"
  minHistory: 30, // trading days needed to evaluate signals
};

// ---------------------------------------------------------------------------

function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
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
  upDays: number[]; // trailing consecutive up-close days
  downDays: number[]; // trailing consecutive down-close days
  weekUpStreak: number[]; // trailing consecutive up completed-weeks
  growth4d: (number | null)[]; // FACTOR 1: % growth over last 4 days
  growth4w: (number | null)[]; // FACTOR 2: % growth over last 4 completed weeks
  dayReturn: (number | null)[];
  weeklyCloses: number[]; // closing price of each completed week, in order
  completedWeeksAt: number[]; // # of weeks completed as of each daily index
}

export function buildSeries(ticker: string, bars: Bar[]): TickerSeries {
  const n = bars.length;
  const close = bars.map((b) => b.close);
  const upDays = new Array<number>(n).fill(0);
  const downDays = new Array<number>(n).fill(0);
  const weekUpStreak = new Array<number>(n).fill(0);
  const growth4d = new Array<number | null>(n).fill(null);
  const growth4w = new Array<number | null>(n).fill(null);
  const dayReturn = new Array<number | null>(n).fill(null);
  const dateToIdx = new Map<string, number>();

  const completedWeekCloses: number[] = [];
  const completedWeeksAt = new Array<number>(n).fill(0);
  let curWeekKey = n > 0 ? isoWeekKey(bars[0].date) : "";
  let curWeekClose = n > 0 ? close[0] : 0;

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

    // FACTOR 1 — growth over the last 4 trading days
    if (i >= 4) growth4d[i] = close[i] / close[i - 4] - 1;

    // weekly bookkeeping
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
    completedWeeksAt[i] = completedWeekCloses.length;

    // FACTOR 2 — growth over the last 4 completed weeks
    const L = completedWeekCloses.length - 1;
    if (L >= 4 && completedWeekCloses[L - 4] > 0) {
      growth4w[i] = completedWeekCloses[L] / completedWeekCloses[L - 4] - 1;
    }
  }

  return {
    ticker, bars, dateToIdx, upDays, downDays, weekUpStreak, growth4d, growth4w, dayReturn,
    weeklyCloses: completedWeekCloses,
    completedWeeksAt,
  };
}

/**
 * Entry signal — exactly as specified:
 *   4 consecutive up days  AND  4 consecutive up weeks  AND  analysts bullish.
 */
export function buySignal(s: TickerSeries, i: number, a: AnalystInfo | undefined): boolean {
  return (
    s.upDays[i] >= PARAMS.consecutiveUpDays &&
    s.weekUpStreak[i] >= PARAMS.consecutiveUpWeeks &&
    isBullish(a)
  );
}

/**
 * Score = equal-weight average of THE THREE factors (all in % units):
 *   (1) 4-day growth + (2) 4-week growth + (3) analyst price-target upside.
 */
export function scoreFactors(s: TickerSeries, i: number, a: AnalystInfo | undefined) {
  const g4d = s.growth4d[i] ?? 0;
  const g4w = s.growth4w[i] ?? 0;
  const analyst = a?.targetUpside ?? 0;
  return { g4d, g4w, analyst, score: (g4d + g4w + analyst) / 3 };
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

export interface RankedRow {
  ticker: string;
  rank: number;
  score: number;
  g4d: number; // factor 1 (%)
  g4w: number; // factor 2 (%)
  analyst: number; // factor 3 (%)
  recKey: string | null; // analyst rating label
  dayReturnPct: number | null;
  upDays: number;
  upWeeks: number;
  allocated: number;
  status: "BUY" | "HELD" | "SKIPPED";
}

export interface DayAction {
  ticker: string;
  type: "BUY" | "SELL" | "HOLD";
  shares: number;
  price: number;
  allocated: number;
  pnl: number | null;
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

/** One row in the full-universe scan for a day (every stock, pass or fail). */
export interface ScanRow {
  ticker: string;
  rank: number; // rank across the WHOLE index by score (1 = highest)
  close: number;
  dayReturnPct: number | null;
  upDays: number;
  upWeeks: number;
  last4days: (boolean | null)[]; // up/down for each of the last 4 days (old→new)
  last4weeks: (boolean | null)[]; // up/down for each of the last 4 weeks (old→new)
  recKey: string | null;
  g4d: number | null;
  g4w: number | null;
  analyst: number | null;
  score: number; // 3-factor score for every stock
  eligible: boolean;
  inTrade: boolean; // currently holding this name at end of day
  status: "BUY" | "SELL" | "HELD" | "SKIPPED" | "—";
  fail: string; // "" if eligible, else which gate failed
}

/** Funnel counts showing why so few (or many) names qualify on a day. */
export interface Funnel {
  total: number; // stocks with a bar today
  upToday: number; // closed up today
  up4days: number; // 4 consecutive up days
  up4daysWeeks: number; // + 4 consecutive up weeks
  eligible: number; // + analyst bullish (full entry signal)
  bought: number;
  held: number;
  sold: number;
}

export interface DailyRecord {
  date: string;
  ranked: RankedRow[];
  actions: DayAction[];
  holdings: HoldingRow[];
  scan: ScanRow[];
  funnel: Funnel;
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
  bullishCount: number; // tickers passing the analyst-bullish gate
  dates: string[];
  tickers: string[];
  returnsMatrix: (number | null)[][];
  statusMatrix: number[][];
  days: DailyRecord[];
}

interface OpenPos {
  ticker: string;
  shares: number;
  entryPrice: number;
  entryDate: string;
  scoreAtEntry: number;
}

export function backtest(
  seriesMap: Record<string, TickerSeries>,
  analystMap: Record<string, AnalystInfo>,
  monthsBack = 6
): BacktestResult {
  const allSeries = Object.values(seriesMap).filter((s) => s.bars.length > PARAMS.minHistory);
  const bullishCount = allSeries.filter((s) => isBullish(analystMap[s.ticker])).length;

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

  let benchInit: { ticker: string; shares: number }[] | null = null;
  let peakEquity = PARAMS.budget;
  let maxDrawdown = 0;
  let prevEquity = PARAMS.budget;
  const involved = new Set<string>();

  function priceOn(s: TickerSeries, date: string): number | null {
    const i = s.dateToIdx.get(date);
    return i === undefined ? null : s.bars[i].close;
  }

  for (const date of windowDates) {
    const soldToday = new Set<string>();
    const boughtToday = new Set<string>();
    const actions: DayAction[] = [];

    // 1) Exits at today's close.
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
        trades.push({ ticker, entryDate: pos.entryDate, entryPrice: pos.entryPrice, exitDate: date, exitPrice: px, shares: pos.shares, returnPct: ret, pnl, exitReason: reason, scoreAtEntry: pos.scoreAtEntry });
        actions.push({ ticker, type: "SELL", shares: pos.shares, price: px, allocated: pos.shares * px, pnl, returnPct: ret, reason });
        open.delete(ticker);
        soldToday.add(ticker);
        involved.add(ticker);
      }
    }

    // 2) Rank today's buy-signal candidates by score, fill slots in rank order.
    const candidates = allSeries
      .map((s) => {
        const i = s.dateToIdx.get(date);
        if (i === undefined) return null;
        if (!buySignal(s, i, analystMap[s.ticker])) return null;
        const f = scoreFactors(s, i, analystMap[s.ticker]);
        return { s, i, ...f, price: s.bars[i].close };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => b.score - a.score);

    const ranked: RankedRow[] = candidates.map((c, idx) => {
      const ticker = c.s.ticker;
      involved.add(ticker);
      let status: RankedRow["status"];
      let allocated = 0;
      if (open.has(ticker)) {
        status = "HELD";
      } else if (!soldToday.has(ticker) && open.size < PARAMS.maxPositions && cash >= slotSize && c.price > 0) {
        const shares = slotSize / c.price;
        cash -= slotSize;
        open.set(ticker, { ticker, shares, entryPrice: c.price, entryDate: date, scoreAtEntry: c.score });
        boughtToday.add(ticker);
        allocated = slotSize;
        status = "BUY";
        actions.push({ ticker, type: "BUY", shares, price: c.price, allocated: slotSize, pnl: null, returnPct: null, reason: `Rank #${idx + 1}` });
      } else {
        status = "SKIPPED";
      }
      const a = analystMap[ticker];
      return {
        ticker,
        rank: idx + 1,
        score: c.score,
        g4d: c.g4d,
        g4w: c.g4w,
        analyst: c.analyst,
        recKey: a?.recommendationKey ?? null,
        dayReturnPct: c.s.dayReturn[c.i],
        upDays: c.s.upDays[c.i],
        upWeeks: c.s.weekUpStreak[c.i],
        allocated,
        status,
      };
    });

    // 3) HOLD actions for carried-over positions.
    for (const [ticker, pos] of open.entries()) {
      if (boughtToday.has(ticker)) continue;
      const s = seriesMap[ticker];
      const i = s.dateToIdx.get(date);
      const px = i !== undefined ? s.bars[i].close : pos.entryPrice;
      involved.add(ticker);
      actions.push({ ticker, type: "HOLD", shares: pos.shares, price: px, allocated: pos.shares * px, pnl: pos.shares * (px - pos.entryPrice), returnPct: px / pos.entryPrice - 1, reason: null });
    }

    // 4) Holdings snapshot + totals.
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

    // 5) Full-universe scan + funnel — why each stock did or didn't qualify.
    const r2 = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 10000) / 10000);
    const funnel: Funnel = { total: 0, upToday: 0, up4days: 0, up4daysWeeks: 0, eligible: 0, bought: 0, held: 0, sold: 0 };
    const scan: ScanRow[] = [];
    for (const s of allSeries) {
      const i = s.dateToIdx.get(date);
      if (i === undefined) continue;
      funnel.total++;
      const dr = s.dayReturn[i];
      if (dr !== null && dr > 0) funnel.upToday++;
      const upDays = s.upDays[i];
      const upWeeks = s.weekUpStreak[i];
      const a = analystMap[s.ticker];
      const bull = isBullish(a);
      const hitDays = upDays >= PARAMS.consecutiveUpDays;
      const hitWeeks = hitDays && upWeeks >= PARAMS.consecutiveUpWeeks;
      const eligible = hitWeeks && bull;
      if (hitDays) funnel.up4days++;
      if (hitWeeks) funnel.up4daysWeeks++;
      if (eligible) funnel.eligible++;

      const inTrade = open.has(s.ticker);
      let status: ScanRow["status"] = "—";
      if (soldToday.has(s.ticker)) status = "SELL";
      else if (boughtToday.has(s.ticker)) status = "BUY";
      else if (inTrade) status = "HELD";
      else if (eligible) status = "SKIPPED";

      let fail = "";
      if (!hitDays) fail = `only ${upDays}/${PARAMS.consecutiveUpDays} up days`;
      else if (!hitWeeks) fail = `only ${upWeeks}/${PARAMS.consecutiveUpWeeks} up weeks`;
      else if (!bull) fail = `analyst: ${a?.recommendationKey ?? "no rating"}`;

      // last 4 daily moves (oldest -> newest)
      const last4days: (boolean | null)[] = [];
      for (let k = 3; k >= 0; k--) {
        const d = s.dayReturn[i - k];
        last4days.push(i - k >= 1 && d !== null ? d > 0 : null);
      }
      // last 4 weekly moves (oldest -> newest), week-over-week closes
      const last4weeks: (boolean | null)[] = [];
      const wc = s.weeklyCloses;
      const L = s.completedWeeksAt[i] - 1; // index of most recent completed week
      for (let k = 3; k >= 0; k--) {
        const idx = L - k;
        last4weeks.push(idx >= 1 ? wc[idx] > wc[idx - 1] : null);
      }

      const f = scoreFactors(s, i, a); // score EVERY stock
      scan.push({
        ticker: s.ticker,
        rank: 0,
        close: s.bars[i].close,
        dayReturnPct: r2(dr),
        upDays,
        upWeeks,
        last4days,
        last4weeks,
        recKey: a?.recommendationKey ?? null,
        g4d: r2(s.growth4d[i]),
        g4w: r2(s.growth4w[i]),
        analyst: r2(a?.targetUpside ?? null),
        score: r2(f.score) as number,
        eligible,
        inTrade,
        status,
        fail,
      });
    }
    funnel.bought = boughtToday.size;
    funnel.sold = soldToday.size;
    funnel.held = open.size - boughtToday.size;
    // Rank the WHOLE index by score (highest first).
    scan.sort((a, b) => b.score - a.score);
    scan.forEach((row, idx) => (row.rank = idx + 1));

    equityCurve.push({ date, equity, cash, positions: open.size, benchmark: benchVal });
    days.push({
      date,
      ranked,
      actions: actions.sort((a, b) => ({ SELL: 0, BUY: 1, HOLD: 2 } as const)[a.type] - ({ SELL: 0, BUY: 1, HOLD: 2 } as const)[b.type]),
      holdings,
      scan,
      funnel,
      cash,
      invested,
      equity,
      dayPnl: equity - prevEquity,
      cumReturnPct: equity / PARAMS.budget - 1,
    });
    prevEquity = equity;
  }

  // Compact matrices for the heatmap.
  const tickers = Array.from(involved).sort();
  const tIdx = new Map(tickers.map((t, i) => [t, i]));
  const returnsMatrix: (number | null)[][] = tickers.map(() => windowDates.map(() => null));
  const statusMatrix: number[][] = tickers.map(() => windowDates.map(() => 0));
  windowDates.forEach((date, di) => {
    for (const t of tickers) {
      const s = seriesMap[t];
      const i = s?.dateToIdx.get(date);
      if (i === undefined) continue;
      const dr = s.dayReturn[i];
      returnsMatrix[tIdx.get(t)!][di] = dr === null ? null : Math.round(dr * 10000) / 100;
    }
  });
  days.forEach((day, di) => {
    for (const a of day.actions) {
      const ti = tIdx.get(a.ticker);
      if (ti === undefined) continue;
      statusMatrix[ti][di] = a.type === "SELL" ? 3 : a.type === "BUY" ? 2 : 1;
    }
    for (const r of day.ranked) {
      const ti = tIdx.get(r.ticker);
      if (ti !== undefined && statusMatrix[ti][di] === 0 && r.status === "SKIPPED") statusMatrix[ti][di] = 4;
    }
  });

  const lastDate = windowDates[windowDates.length - 1];
  const openPositionsAtEnd = days.length > 0 ? days[days.length - 1].holdings : [];
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
    bullishCount,
    dates: windowDates,
    tickers,
    returnsMatrix,
    statusMatrix,
    days,
  };
}

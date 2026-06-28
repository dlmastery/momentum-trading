// Client-side loader: fetches the pre-built static JSON and runs the entire
// backtest in the browser (no server). Mirrors the old /api/backtest response
// shape so the UI is unchanged.
import { Bar, AnalystInfo } from "./types";
import {
  backtest,
  buildSeries,
  resolveParams,
  StrategyParams,
  TickerSeries,
  BacktestResult,
} from "./strategy";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export interface CompactTicker {
  d: string[]; // dates
  c: number[]; // closes
  v: number[]; // volumes
  a: {
    recommendationMean: number | null;
    recommendationKey: string | null;
    targetMeanPrice: number | null;
    currentPrice: number | null;
    targetUpside: number | null;
    numAnalysts: number | null;
  } | null;
}

export interface CompactData {
  id: string;
  name: string;
  description: string;
  years: number;
  tickers: Record<string, CompactTicker>;
}

export interface EtfListItem {
  id: string;
  name: string;
  description: string;
  count: number;
  withData: number;
}

export interface BacktestResponse {
  etf: { id: string; name: string; description: string };
  params: StrategyParams;
  monthsBack: number;
  requestedTickers: number;
  tickersWithData: number;
  analystCovered: number;
  result: BacktestResult;
}

export async function loadEtfList(): Promise<EtfListItem[]> {
  const res = await fetch(`${BASE}/data/etfs.json`);
  if (!res.ok) throw new Error(`Could not load ETF list (${res.status})`);
  return res.json();
}

const cache = new Map<string, CompactData>();
export async function loadEtfData(id: string): Promise<CompactData> {
  if (cache.has(id)) return cache.get(id)!;
  const res = await fetch(`${BASE}/data/${id}.json`);
  if (!res.ok) throw new Error(`Could not load data for ${id} (${res.status})`);
  const data = (await res.json()) as CompactData;
  cache.set(id, data);
  return data;
}

function toBars(t: CompactTicker): Bar[] {
  const bars: Bar[] = new Array(t.c.length);
  for (let i = 0; i < t.c.length; i++) {
    const close = t.c[i];
    bars[i] = { date: t.d[i], open: close, high: close, low: close, close, volume: t.v[i] ?? 0 };
  }
  return bars;
}

function toAnalyst(ticker: string, t: CompactTicker): AnalystInfo {
  const a = t.a;
  return {
    ticker,
    recommendationMean: a?.recommendationMean ?? null,
    recommendationKey: a?.recommendationKey ?? null,
    targetMeanPrice: a?.targetMeanPrice ?? null,
    currentPrice: a?.currentPrice ?? null,
    targetUpside: a?.targetUpside ?? null,
    numAnalysts: a?.numAnalysts ?? null,
  };
}

/** Build series + analyst maps from compact data and run the backtest. */
export function runBacktestClient(
  data: CompactData,
  monthsBack: number,
  partialParams?: Partial<Record<string, unknown>>
): BacktestResponse {
  const params = resolveParams(partialParams);
  const seriesMap: Record<string, TickerSeries> = {};
  const analystMap: Record<string, AnalystInfo> = {};
  let withData = 0;
  let analystCovered = 0;
  const entries = Object.entries(data.tickers);
  for (const [ticker, t] of entries) {
    if (!t.c || t.c.length === 0) continue;
    seriesMap[ticker] = buildSeries(ticker, toBars(t));
    analystMap[ticker] = toAnalyst(ticker, t);
    if (analystMap[ticker].targetUpside !== null) analystCovered++;
    withData++;
  }
  const result = backtest(seriesMap, analystMap, monthsBack, params);
  return {
    etf: { id: data.id, name: data.name, description: data.description },
    params,
    monthsBack,
    requestedTickers: entries.length,
    tickersWithData: withData,
    analystCovered,
    result,
  };
}

import { promises as fs } from "fs";
import path from "path";

// Escape hatch for machines behind a TLS-intercepting proxy (corporate MITM),
// where Node's fetch fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE. Opt-in only.
if (process.env.ALLOW_INSECURE_TLS === "1") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

import { Bar } from "./types";
export type { Bar };

const CACHE_DIR = path.join(process.cwd(), ".cache", "prices");
// Re-use cached data for this long before re-fetching (end-of-day data).
const CACHE_TTL_MS = 1000 * 60 * 60 * 12; // 12h

function cachePath(ticker: string): string {
  const safe = ticker.replace(/[^a-z0-9-]/gi, "_").toLowerCase();
  return path.join(CACHE_DIR, `${safe}.json`);
}

interface CacheFile {
  fetchedAt: number;
  bars: Bar[];
}

async function readCache(ticker: string): Promise<CacheFile | null> {
  try {
    const raw = await fs.readFile(cachePath(ticker), "utf8");
    return JSON.parse(raw) as CacheFile;
  } catch {
    return null;
  }
}

async function writeCache(ticker: string, bars: Bar[]): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const data: CacheFile = { fetchedAt: Date.now(), bars };
  await fs.writeFile(cachePath(ticker), JSON.stringify(data), "utf8");
}

interface YahooChart {
  chart: {
    result?: Array<{
      timestamp?: number[];
      indicators: {
        quote: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
        adjclose?: Array<{ adjclose?: (number | null)[] }>;
      };
    }>;
    error?: unknown;
  };
}

async function fetchFromYahoo(ticker: string, years: number): Promise<Bar[]> {
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - Math.ceil((years + 1) * 365.25 * 86400); // +1yr SMA warmup
  // Yahoo uses dashes for class shares (e.g. BRK-B), which our lists already use.
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${period1}&period2=${now}&interval=1d&includeAdjustedClose=true`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; simpletrade-backtester)" },
  });
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  const json = (await res.json()) as YahooChart;
  const r = json.chart?.result?.[0];
  if (!r || !r.timestamp) return [];

  const q = r.indicators.quote[0] ?? {};
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const ts = r.timestamp;
  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = adj?.[i] ?? q.close?.[i];
    if (close === null || close === undefined || !Number.isFinite(close)) continue;
    bars.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      open: q.open?.[i] ?? close,
      high: q.high?.[i] ?? close,
      low: q.low?.[i] ?? close,
      close,
      volume: q.volume?.[i] ?? 0,
    });
  }
  return bars;
}

/**
 * Returns daily adjusted bars for a ticker, using the on-disk cache when fresh.
 * `years` controls how far back we request from the source.
 */
export async function getBars(ticker: string, years: number): Promise<Bar[]> {
  const cached = await readCache(ticker);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.bars;
  }
  try {
    const bars = await fetchFromYahoo(ticker, years);
    if (bars.length > 0) {
      await writeCache(ticker, bars);
      return bars;
    }
    return cached?.bars ?? [];
  } catch (err) {
    if (cached) return cached.bars; // serve stale on network error
    throw err;
  }
}

/** Fetch many tickers with limited concurrency to stay polite to the source. */
export async function getManyBars(
  tickers: string[],
  years: number,
  concurrency = 6,
  onProgress?: (done: number, total: number) => void
): Promise<Record<string, Bar[]>> {
  const out: Record<string, Bar[]> = {};
  let done = 0;
  let idx = 0;
  async function worker() {
    while (idx < tickers.length) {
      const i = idx++;
      const t = tickers[i];
      try {
        out[t] = await getBars(t, years);
      } catch {
        out[t] = [];
      }
      done++;
      onProgress?.(done, tickers.length);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, tickers.length) },
    worker
  );
  await Promise.all(workers);
  return out;
}

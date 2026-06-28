import { promises as fs } from "fs";
import path from "path";
import { AnalystInfo, isBullish } from "./types";
export type { AnalystInfo };
export { isBullish };

if (process.env.ALLOW_INSECURE_TLS === "1") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const CACHE_DIR = path.join(process.cwd(), ".cache", "analyst");
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function cachePath(ticker: string): string {
  const safe = ticker.replace(/[^a-z0-9-]/gi, "_").toLowerCase();
  return path.join(CACHE_DIR, `${safe}.json`);
}

// ---- Yahoo crumb + cookie handshake (cached per process) -------------------
let creds: { cookie: string; crumb: string } | null = null;
let credsPromise: Promise<{ cookie: string; crumb: string }> | null = null;

async function getCreds(): Promise<{ cookie: string; crumb: string }> {
  if (creds) return creds;
  if (credsPromise) return credsPromise;
  credsPromise = (async () => {
    const r1 = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA } });
    const setCookies =
      typeof r1.headers.getSetCookie === "function" ? r1.headers.getSetCookie() : [];
    let cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
    if (!cookie) {
      const sc = r1.headers.get("set-cookie");
      cookie = sc ? sc.split(";")[0] : "";
    }
    const r2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie },
    });
    const crumb = (await r2.text()).trim();
    creds = { cookie, crumb };
    return creds;
  })();
  return credsPromise;
}

interface YahooQuoteSummary {
  quoteSummary?: {
    result?: Array<{
      financialData?: {
        recommendationMean?: { raw?: number };
        recommendationKey?: string;
        targetMeanPrice?: { raw?: number };
        currentPrice?: { raw?: number };
        numberOfAnalystOpinions?: { raw?: number };
      };
    }>;
    error?: unknown;
  };
}

function emptyInfo(ticker: string): AnalystInfo {
  return {
    ticker,
    recommendationMean: null,
    recommendationKey: null,
    targetMeanPrice: null,
    currentPrice: null,
    targetUpside: null,
    numAnalysts: null,
  };
}

async function readCache(ticker: string): Promise<{ at: number; info: AnalystInfo } | null> {
  try {
    return JSON.parse(await fs.readFile(cachePath(ticker), "utf8"));
  } catch {
    return null;
  }
}

async function writeCache(ticker: string, info: AnalystInfo): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cachePath(ticker), JSON.stringify({ at: Date.now(), info }), "utf8");
}

async function fetchOne(ticker: string): Promise<AnalystInfo> {
  const { cookie, crumb } = await getCreds();
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
    `?modules=financialData&crumb=${encodeURIComponent(crumb)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Cookie: cookie } });
  if (!res.ok) {
    if (res.status === 401) creds = credsPromise = null; // force re-handshake next time
    throw new Error(`analyst ${ticker} HTTP ${res.status}`);
  }
  const j = (await res.json()) as YahooQuoteSummary;
  const fd = j.quoteSummary?.result?.[0]?.financialData;
  if (!fd) return emptyInfo(ticker);
  const target = fd.targetMeanPrice?.raw ?? null;
  const price = fd.currentPrice?.raw ?? null;
  return {
    ticker,
    recommendationMean: fd.recommendationMean?.raw ?? null,
    recommendationKey: fd.recommendationKey ?? null,
    targetMeanPrice: target,
    currentPrice: price,
    targetUpside: target && price ? target / price - 1 : null,
    numAnalysts: fd.numberOfAnalystOpinions?.raw ?? null,
  };
}

export async function getAnalyst(ticker: string): Promise<AnalystInfo> {
  const cached = await readCache(ticker);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.info;
  try {
    const info = await fetchOne(ticker);
    await writeCache(ticker, info);
    return info;
  } catch {
    return cached?.info ?? emptyInfo(ticker);
  }
}

export async function getManyAnalyst(
  tickers: string[],
  concurrency = 5
): Promise<Record<string, AnalystInfo>> {
  const out: Record<string, AnalystInfo> = {};
  let idx = 0;
  async function worker() {
    while (idx < tickers.length) {
      const t = tickers[idx++];
      out[t] = await getAnalyst(t);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tickers.length) }, worker)
  );
  return out;
}

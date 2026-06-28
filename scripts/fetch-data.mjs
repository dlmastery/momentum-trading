// Pre-fetches all price + analyst data for every ETF and writes compact static
// JSON into public/data/. The browser app loads these and runs the whole
// backtest client-side — no server needed (deployable to GitHub Pages).
//
//   node scripts/fetch-data.mjs            (normal)
//   ALLOW_INSECURE_TLS=1 node scripts/...  (behind a TLS-intercepting proxy)

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

if (process.env.ALLOW_INSECURE_TLS === "1") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "public", "data");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const YEARS = 2;

const etfs = JSON.parse(await fs.readFile(path.join(ROOT, "lib", "etfs.json"), "utf8"));

// ---- price fetch (Yahoo chart, adjusted close) ----
async function fetchBars(ticker) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const period1 = now - Math.ceil((YEARS + 1) * 365.25 * 86400);
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
      `?period1=${period1}&period2=${now}&interval=1d&includeAdjustedClose=true`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const j = await res.json();
    const r = j.chart?.result?.[0];
    if (!r || !r.timestamp) return null;
  const q = r.indicators.quote[0] ?? {};
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const d = [], c = [], v = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const close = adj?.[i] ?? q.close?.[i];
    if (close === null || close === undefined || !Number.isFinite(close)) continue;
    d.push(new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10));
    c.push(Math.round(close * 100) / 100);
    v.push(q.volume?.[i] ?? 0);
  }
  return { d, c, v };
  } catch {
    return null;
  }
}

// ---- analyst fetch (Yahoo quoteSummary, needs crumb+cookie) ----
let creds = null;
async function getCreds() {
  if (creds) return creds;
  const r1 = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA } });
  const sc = typeof r1.headers.getSetCookie === "function" ? r1.headers.getSetCookie() : [];
  let cookie = sc.map((x) => x.split(";")[0]).join("; ");
  if (!cookie) { const h = r1.headers.get("set-cookie"); cookie = h ? h.split(";")[0] : ""; }
  const r2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: cookie } });
  creds = { cookie, crumb: (await r2.text()).trim() };
  return creds;
}
async function fetchAnalyst(ticker) {
  try {
    const { cookie, crumb } = await getCreds();
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=financialData&crumb=${encodeURIComponent(crumb)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Cookie: cookie } });
    if (res.status === 401) creds = null;
    if (!res.ok) return null;
    const fd = (await res.json()).quoteSummary?.result?.[0]?.financialData;
    if (!fd) return null;
    const target = fd.targetMeanPrice?.raw ?? null;
    const price = fd.currentPrice?.raw ?? null;
    return {
      recommendationMean: fd.recommendationMean?.raw ?? null,
      recommendationKey: fd.recommendationKey ?? null,
      targetMeanPrice: target,
      currentPrice: price,
      targetUpside: target && price ? Math.round((target / price - 1) * 10000) / 10000 : null,
      numAnalysts: fd.numberOfAnalystOpinions?.raw ?? null,
    };
  } catch {
    return null;
  }
}

async function mapLimit(items, limit, fn, label) {
  const out = {};
  let i = 0, done = 0;
  async function worker() {
    while (i < items.length) {
      const t = items[i++];
      out[t] = await fn(t);
      done++;
      if (done % 10 === 0 || done === items.length) process.stdout.write(`\r  ${label}: ${done}/${items.length}   `);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  process.stdout.write("\n");
  return out;
}

// ---- main ----
const allTickers = [...new Set(etfs.flatMap((e) => e.tickers))];
console.log(`Fetching ${allTickers.length} unique tickers…`);
const bars = await mapLimit(allTickers, 6, fetchBars, "prices");
const analyst = await mapLimit(allTickers, 5, fetchAnalyst, "analyst");

await fs.mkdir(OUT, { recursive: true });

const index = [];
for (const e of etfs) {
  const tickers = {};
  let withData = 0;
  for (const t of e.tickers) {
    const b = bars[t];
    if (!b || b.c.length === 0) continue;
    tickers[t] = { ...b, a: analyst[t] ?? null };
    withData++;
  }
  const file = path.join(OUT, `${e.id}.json`);
  await fs.writeFile(file, JSON.stringify({ id: e.id, name: e.name, description: e.description, generatedAt: new Date().toISOString(), years: YEARS, tickers }));
  const kb = ((await fs.stat(file)).size / 1024).toFixed(0);
  index.push({ id: e.id, name: e.name, description: e.description, count: e.tickers.length, withData });
  console.log(`  wrote ${e.id}.json — ${withData}/${e.tickers.length} tickers, ${kb} KB`);
}
await fs.writeFile(path.join(OUT, "etfs.json"), JSON.stringify(index, null, 2));
console.log("Done. Static data in public/data/.");

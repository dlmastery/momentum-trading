// Pure, dependency-free types + helpers shared by the Node data scripts and the
// browser engine. NOTHING in here may import `fs`, `path`, or do network I/O,
// so it is safe to bundle into the static client.

export interface Bar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number; // split/dividend adjusted
  volume: number;
}

export interface AnalystInfo {
  ticker: string;
  recommendationMean: number | null; // 1 = Strong Buy ... 5 = Sell
  recommendationKey: string | null; // strong_buy | buy | hold | underperform | sell
  targetMeanPrice: number | null;
  currentPrice: number | null;
  targetUpside: number | null; // targetMeanPrice / currentPrice - 1
  numAnalysts: number | null;
}

/** Bullish gate: analysts rate it Buy or Strong Buy (mean <= 2.5 as fallback). */
export function isBullish(a: AnalystInfo | undefined): boolean {
  if (!a) return false;
  if (a.recommendationKey) {
    const k = a.recommendationKey.toLowerCase();
    if (k === "strong_buy" || k === "buy") return true;
    if (k === "hold" || k === "underperform" || k === "sell" || k === "strong_sell") return false;
  }
  return a.recommendationMean !== null && a.recommendationMean <= 2.5;
}

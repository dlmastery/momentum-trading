import { NextRequest, NextResponse } from "next/server";
import { getEtf } from "@/lib/etfs";
import { getManyBars } from "@/lib/prices";
import { getManyAnalyst } from "@/lib/analyst";
import { backtest, buildSeries, TickerSeries, PARAMS } from "@/lib/strategy";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const etfId: string = body.etfId ?? "nasdaq100";
    const years: number = Math.min(Math.max(Number(body.years) || 2, 1), 10);
    const monthsBack: number = Math.min(Math.max(Number(body.monthsBack) || 6, 1), 24);

    const etf = getEtf(etfId);
    if (!etf) {
      return NextResponse.json({ error: `Unknown ETF '${etfId}'` }, { status: 400 });
    }

    // Fetch prices and analyst ratings in parallel (both cached on disk).
    const [barsMap, analystMap] = await Promise.all([
      getManyBars(etf.tickers, years),
      getManyAnalyst(etf.tickers),
    ]);

    const seriesMap: Record<string, TickerSeries> = {};
    let withData = 0;
    for (const [ticker, bars] of Object.entries(barsMap)) {
      if (bars.length > 0) {
        seriesMap[ticker] = buildSeries(ticker, bars);
        withData++;
      }
    }

    if (withData === 0) {
      return NextResponse.json(
        { error: "No price data could be fetched (data source may be rate-limiting). Try again shortly." },
        { status: 502 }
      );
    }

    const result = backtest(seriesMap, analystMap, monthsBack);
    const analystCovered = Object.values(analystMap).filter((a) => a.targetUpside !== null).length;

    return NextResponse.json({
      etf: { id: etf.id, name: etf.name, description: etf.description },
      params: PARAMS,
      years,
      monthsBack,
      requestedTickers: etf.tickers.length,
      tickersWithData: withData,
      analystCovered,
      result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

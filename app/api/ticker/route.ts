import { NextRequest, NextResponse } from "next/server";
import { getBars } from "@/lib/prices";
import { getAnalyst } from "@/lib/analyst";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const ticker = (req.nextUrl.searchParams.get("ticker") || "").toUpperCase();
    const years = Math.min(Math.max(Number(req.nextUrl.searchParams.get("years")) || 2, 1), 10);
    if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

    const [bars, analyst] = await Promise.all([getBars(ticker, years), getAnalyst(ticker)]);
    if (bars.length === 0) {
      return NextResponse.json({ error: `No data for ${ticker}` }, { status: 404 });
    }
    // Trim payload: send date / close / volume only.
    return NextResponse.json({
      ticker,
      analyst,
      bars: bars.map((b) => ({ date: b.date, close: b.close, volume: b.volume })),
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 500 });
  }
}

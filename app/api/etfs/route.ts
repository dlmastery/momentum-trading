import { NextResponse } from "next/server";
import { ETFS } from "@/lib/etfs";

export async function GET() {
  return NextResponse.json(
    ETFS.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      count: e.tickers.length,
    }))
  );
}

// Bundled ETF / index constituent lists (single source of truth in etfs.json).
//
// Real-time constituents change over time and normally require a paid data
// provider. These bundled lists are a representative, recent snapshot intended
// for backtesting.
import etfsData from "./etfs.json";

export interface EtfDef {
  id: string;
  name: string;
  description: string;
  tickers: string[];
}

export const ETFS: EtfDef[] = etfsData as EtfDef[];

export function getEtf(id: string): EtfDef | undefined {
  return ETFS.find((e) => e.id === id);
}

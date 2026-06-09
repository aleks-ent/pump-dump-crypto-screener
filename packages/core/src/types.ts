export interface Instrument {
  exchange: string;
  instrumentType: string;
  symbolNative: string;
  symbolCanonical: string;
  base: string | null;
  quote: string | null;
  metadata: Record<string, unknown>;
}

export interface CandleRecord {
  exchange: string;
  instrumentType: string;
  symbolNative: string;
  interval: string;
  openTimeMs: number;
  closeTimeMs: number | null;
  openPrice: string | null;
  highPrice: string | null;
  lowPrice: string | null;
  closePrice: string | null;
  volume: string | null;
  quoteVolume: string | null;
  tradeCount: number | null;
  rawPayload: unknown;
}

export interface PageResult {
  records: CandleRecord[];
  nextCursor: Record<string, unknown> | null;
  requestMeta: Record<string, unknown>;
}

export interface ArchiveFile {
  url: string;
  relPath: string;
  label: string;
}

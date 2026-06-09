import type { HttpClient, Instrument, PageResult } from "@screener/core";

export interface ExchangeAdapter {
  readonly name: string;
  readonly intervals: ReadonlySet<string>;
  readonly pageLimit: number;
  discoverInstruments(
    client: HttpClient,
    instrumentTypes?: Set<string> | null,
  ): Promise<Instrument[]>;
  initialCursor(startMs: number, endMs: number): Record<string, unknown>;
  fetchCandlesPage(
    client: HttpClient,
    instrument: Instrument,
    interval: string,
    cursor: Record<string, unknown>,
  ): Promise<PageResult>;
}

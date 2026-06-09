import type { CandleRecord, HttpClient, Instrument, PageResult } from "@screener/core";
import type { ExchangeAdapter } from "./adapter.js";

const BASE_URL = "https://api.bybit.com";

const TYPE_TO_CATEGORY: Record<string, string> = {
  spot: "spot",
  linear_perp: "linear",
  inverse_futures: "inverse",
  option: "option",
};

export class BybitAdapter implements ExchangeAdapter {
  readonly name = "bybit";
  readonly intervals = new Set(["1m", "5m"]);
  readonly pageLimit = 1000;

  async discoverInstruments(
    client: HttpClient,
    instrumentTypes?: Set<string> | null,
  ): Promise<Instrument[]> {
    const out: Instrument[] = [];
    for (const [instrumentType, category] of Object.entries(TYPE_TO_CATEGORY)) {
      if (instrumentTypes && !instrumentTypes.has(instrumentType)) continue;
      let cursor: string | undefined;
      while (true) {
        const params: Record<string, string | number> = {
          category,
          limit: 1000,
        };
        if (cursor) params.cursor = cursor;
        const payload = await client.getJson<{
          result?: {
            list?: Array<Record<string, unknown>>;
            nextPageCursor?: string;
          };
        }>(`${BASE_URL}/v5/market/instruments-info`, params, 8);
        const result = payload.result ?? {};
        for (const item of result.list ?? []) {
          const symbol = item.symbol as string | undefined;
          if (!symbol) continue;
          if (item.status !== "Trading") continue;
          const base = item.baseCoin as string | undefined;
          const quote = item.quoteCoin as string | undefined;
          const canonical = base && quote ? `${base}/${quote}` : symbol;
          out.push({
            exchange: this.name,
            instrumentType,
            symbolNative: symbol,
            symbolCanonical: canonical,
            base: base ?? null,
            quote: quote ?? null,
            metadata: item,
          });
        }
        cursor = result.nextPageCursor;
        if (!cursor) break;
      }
    }
    return out;
  }

  initialCursor(startMs: number, endMs: number): Record<string, unknown> {
    // Bybit returns klines newest-first; paginate by moving end_ms backward.
    return { start_ms: startMs, end_ms: endMs };
  }

  async fetchCandlesPage(
    client: HttpClient,
    instrument: Instrument,
    interval: string,
    cursor: Record<string, unknown>,
  ): Promise<PageResult> {
    if (!this.intervals.has(interval)) {
      throw new Error(`Unsupported interval ${interval} for ${this.name}`);
    }
    const category = TYPE_TO_CATEGORY[instrument.instrumentType];
    if (!category || !["spot", "linear", "inverse"].includes(category)) {
      return { records: [], nextCursor: null, requestMeta: { skipped: "unsupported_type" } };
    }

    const startMs = Number(cursor.start_ms ?? cursor.next_start_ms);
    const endMs = Number(cursor.end_ms);
    if (startMs >= endMs) {
      return { records: [], nextCursor: null, requestMeta: { done: true } };
    }

    const payload = await client.getJson<{
      result?: { list?: Array<Array<string | number>> };
    }>(
      `${BASE_URL}/v5/market/kline`,
      {
        category,
        symbol: instrument.symbolNative,
        interval: interval.replace("m", ""),
        start: startMs,
        end: endMs,
        limit: this.pageLimit,
      },
    );

    const rows = payload.result?.list ?? [];
    const rowsSorted = [...rows].sort((a, b) => Number(a[0]) - Number(b[0]));
    const records: CandleRecord[] = [];
    for (const row of rowsSorted) {
      if (row.length < 6) continue;
      records.push({
        exchange: this.name,
        instrumentType: instrument.instrumentType,
        symbolNative: instrument.symbolNative,
        interval,
        openTimeMs: Number(row[0]),
        closeTimeMs: null,
        openPrice: String(row[1]),
        highPrice: String(row[2]),
        lowPrice: String(row[3]),
        closePrice: String(row[4]),
        volume: String(row[5]),
        quoteVolume: row[6] != null ? String(row[6]) : null,
        tradeCount: null,
        rawPayload: row,
      });
    }

    if (records.length === 0) {
      return { records: [], nextCursor: null, requestMeta: { done: true } };
    }

    const oldest = records[0]!.openTimeMs;
    // Bybit start/end are inclusive; step end just below the oldest bar already fetched.
    const nextEndMs = oldest - 1;
    return {
      records,
      nextCursor:
        oldest > startMs && nextEndMs >= startMs ? { start_ms: startMs, end_ms: nextEndMs } : null,
      requestMeta: { endpoint: "/v5/market/kline" },
    };
  }
}

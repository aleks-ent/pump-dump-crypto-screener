import type { CandleRecord, HttpClient, Instrument, PageResult } from "@screener/core";
import type { ExchangeAdapter } from "./adapter.js";

const SPOT_BASE = "https://api.binance.com";
const USDT_PERP_BASE = "https://fapi.binance.com";
const COIN_FUT_BASE = "https://dapi.binance.com";

const TYPE_TO_DISCOVERY: Record<string, [string, string]> = {
  spot: [SPOT_BASE, "/api/v3/exchangeInfo"],
  linear_perp: [USDT_PERP_BASE, "/fapi/v1/exchangeInfo"],
  inverse_futures: [COIN_FUT_BASE, "/dapi/v1/exchangeInfo"],
};

const TYPE_TO_KLINES: Record<string, [string, string]> = {
  spot: [SPOT_BASE, "/api/v3/klines"],
  linear_perp: [USDT_PERP_BASE, "/fapi/v1/klines"],
  inverse_futures: [COIN_FUT_BASE, "/dapi/v1/klines"],
};

export class BinanceAdapter implements ExchangeAdapter {
  readonly name = "binance";
  readonly intervals = new Set(["1m", "5m"]);
  // Keep under 500: Binance futures klines cost weight 10 at limit 1000 but
  // only weight 2 below 500, so smaller pages use far less of the per-IP
  // request-weight budget for the same data.
  readonly pageLimit = 499;

  async discoverInstruments(
    client: HttpClient,
    instrumentTypes?: Set<string> | null,
  ): Promise<Instrument[]> {
    const instruments: Instrument[] = [];
    for (const [instrumentType, [base, path]] of Object.entries(TYPE_TO_DISCOVERY)) {
      if (instrumentTypes && !instrumentTypes.has(instrumentType)) continue;
      const payload = await client.getJson<{ symbols?: Array<Record<string, unknown>> }>(
        `${base}${path}`,
        undefined,
        8,
      );
      for (const item of payload.symbols ?? []) {
        const symbol = item.symbol as string | undefined;
        if (!symbol) continue;
        if (item.status !== "TRADING") continue;
        const baseAsset = item.baseAsset as string | undefined;
        const quoteAsset = item.quoteAsset as string | undefined;
        const canonical =
          baseAsset && quoteAsset ? `${baseAsset}/${quoteAsset}` : symbol;
        instruments.push({
          exchange: this.name,
          instrumentType,
          symbolNative: symbol,
          symbolCanonical: canonical,
          base: baseAsset ?? null,
          quote: quoteAsset ?? null,
          metadata: item,
        });
      }
    }
    return instruments;
  }

  initialCursor(startMs: number, endMs: number): Record<string, unknown> {
    return { next_start_ms: startMs, end_ms: endMs };
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
    const klines = TYPE_TO_KLINES[instrument.instrumentType];
    if (!klines) {
      return { records: [], nextCursor: null, requestMeta: { skipped: "unsupported_type" } };
    }

    const nextStartMs = Number(cursor.next_start_ms);
    const endMs = Number(cursor.end_ms);
    if (nextStartMs >= endMs) {
      return { records: [], nextCursor: null, requestMeta: { done: true } };
    }

    const [base, path] = klines;
    // No explicit rps here: let the per-host token bucket (host_rps in
    // config/archives.yaml) govern the REST kline rate so it can be tuned in
    // one place against the per-IP weight limits.
    const payload = await client.getJson<unknown[]>(
      `${base}${path}`,
      {
        symbol: instrument.symbolNative,
        interval,
        startTime: nextStartMs,
        endTime: endMs,
        limit: this.pageLimit,
      },
    );

    const rows = Array.isArray(payload) ? payload : [];
    const records: CandleRecord[] = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 6) continue;
      const openTime = Number(row[0]);
      records.push({
        exchange: this.name,
        instrumentType: instrument.instrumentType,
        symbolNative: instrument.symbolNative,
        interval,
        openTimeMs: openTime,
        closeTimeMs: row.length > 6 ? Number(row[6]) : null,
        openPrice: row[1] != null ? String(row[1]) : null,
        highPrice: row[2] != null ? String(row[2]) : null,
        lowPrice: row[3] != null ? String(row[3]) : null,
        closePrice: row[4] != null ? String(row[4]) : null,
        volume: row[5] != null ? String(row[5]) : null,
        quoteVolume: row[7] != null ? String(row[7]) : null,
        tradeCount: row[8] != null ? Number(row[8]) : null,
        rawPayload: row,
      });
    }

    if (records.length === 0) {
      return { records: [], nextCursor: null, requestMeta: { done: true } };
    }

    const intervalMs = interval === "1m" ? 60_000 : 300_000;
    const next = {
      next_start_ms: records[records.length - 1]!.openTimeMs + intervalMs,
      end_ms: endMs,
    };
    return {
      records,
      nextCursor: next.next_start_ms >= endMs ? null : next,
      requestMeta: { endpoint: path },
    };
  }
}

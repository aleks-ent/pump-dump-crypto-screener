import { HttpClient, type CandleRecord, type Instrument } from "@screener/core";
import { getAdapters, type ExchangeAdapter } from "@screener/exchanges";
import type { Timeframe } from "@screener/pump-detector";

const MAX_REMOTE_PAGES = 16;

const sharedClient = new HttpClient({
  timeoutS: 8,
  userAgent: "pump-event-reviewer/1.0",
  retryPolicy: { retries: 1, baseDelayS: 0.25, maxDelayS: 1 },
});

export interface ExchangeChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
}

export interface ReviewExchangeCandleRequest {
  instrument: Instrument;
  interval: Timeframe;
  fromMs: number;
  toMs: number;
}

export interface ReviewExchangeCandleDependencies {
  client?: HttpClient;
  adapters?: Record<string, ExchangeAdapter>;
  maxPages?: number;
}

function finiteNumber(value: string | number | null): number | null {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function chartCandle(record: CandleRecord): ExchangeChartCandle | null {
  const open = finiteNumber(record.openPrice);
  const high = finiteNumber(record.highPrice);
  const low = finiteNumber(record.lowPrice);
  const close = finiteNumber(record.closePrice);
  const volume = finiteNumber(record.volume);
  if (open == null || high == null || low == null || close == null || volume == null) {
    return null;
  }
  return {
    time: Math.floor(record.openTimeMs / 1_000),
    open,
    high,
    low,
    close,
    volume,
    quoteVolume: finiteNumber(record.quoteVolume) ?? 0,
  };
}

/** Fetch a bounded historical window from the event's exchange without persisting it. */
export async function fetchReviewExchangeCandles(
  request: ReviewExchangeCandleRequest,
  dependencies: ReviewExchangeCandleDependencies = {},
): Promise<ExchangeChartCandle[]> {
  const adapters = dependencies.adapters ?? getAdapters();
  const adapter = adapters[request.instrument.exchange];
  if (!adapter) {
    throw new Error(`No exchange adapter for ${request.instrument.exchange}`);
  }
  if (!adapter.intervals.has(request.interval)) {
    throw new Error(
      `${request.instrument.exchange} does not support ${request.interval} review candles`,
    );
  }

  const client = dependencies.client ?? sharedClient;
  const maxPages = dependencies.maxPages ?? MAX_REMOTE_PAGES;
  let cursor: Record<string, unknown> | null = adapter.initialCursor(
    request.fromMs,
    request.toMs - 1,
  );
  const byOpenTime = new Map<number, ExchangeChartCandle>();

  for (let pageNumber = 0; cursor && pageNumber < maxPages; pageNumber += 1) {
    const page = await adapter.fetchCandlesPage(
      client,
      request.instrument,
      request.interval,
      cursor,
    );
    for (const record of page.records) {
      if (record.openTimeMs < request.fromMs || record.openTimeMs >= request.toMs) continue;
      const candle = chartCandle(record);
      if (candle) byOpenTime.set(record.openTimeMs, candle);
    }
    cursor = page.nextCursor;
  }
  if (cursor) {
    throw new Error(`Exchange candle pagination exceeded ${maxPages} pages`);
  }

  return [...byOpenTime.values()].sort((left, right) => left.time - right.time);
}

import { join } from "node:path";
import { resolveRepoPath, type Instrument } from "@screener/core";
import type { StoredPump } from "@screener/db";
import {
  loadSeries,
  type Candle,
  type LoadSeriesOptions,
  type SeriesLoadResult,
  type SeriesDataSource,
  type Timeframe,
} from "@screener/pump-detector";
import {
  fetchReviewExchangeCandles,
  type ReviewExchangeCandleDependencies,
} from "./review-exchange-candles.js";

const HOUR_MS = 60 * 60 * 1_000;

export const DEFAULT_REVIEW_CANDLE_CONTEXT_MS = 2 * HOUR_MS;
export const MAX_REVIEW_CANDLE_CONTEXT_MS = 24 * HOUR_MS;

const INTERVAL_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
};

export type ReviewCandleErrorCode =
  | "INVALID_EVENT"
  | "INVALID_INTERVAL"
  | "INVALID_WINDOW"
  | "UNSUPPORTED_EXCHANGE"
  | "UNSUPPORTED_INSTRUMENT"
  | "UNSUPPORTED_SYMBOL"
  | "CANDLE_LOAD_FAILED";

export class ReviewCandleError extends Error {
  constructor(
    readonly code: ReviewCandleErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ReviewCandleError";
  }
}

export interface ReviewCandleRequest {
  event: StoredPump;
  /** Defaults to 5m, the review UI's preferred initial timeframe. */
  interval?: string;
  /** Milliseconds of context before the event detection time. Defaults to two hours. */
  beforeMs?: number;
  /** Milliseconds of context after the event detection time. Defaults to two hours. */
  afterMs?: number;
}

export interface ReviewCandleStorageOptions {
  /** Repository-relative paths are resolved from the repository root. */
  dataDir?: string;
  useArchives?: boolean;
  onLog?: (message: string) => void;
}

export interface ReviewChartCandle {
  /** Unix seconds, as expected by Lightweight Charts and the UI specification. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
}

export interface ReviewCandleQuality {
  badData: boolean;
  duplicateBars: number;
  gaps: number;
  reasons: string[];
  expectedBars: number;
  loadedBars: number;
  coveragePct: number;
}

export type ReviewCandleDataSource =
  | SeriesDataSource
  | "exchange_api"
  | "local_and_exchange_api";

export interface ReviewCandleSource {
  source: ReviewCandleDataSource;
  ndjsonBars: number;
  archiveBars: number;
  archiveFileCount: number;
  usedArchives: boolean;
  exchangeApiAttempted: boolean;
  exchangeApiBars: number;
  exchangeApiError: boolean;
}

export interface ReviewCandleWindow {
  eventId: string;
  exchange: string;
  symbol: string;
  instrumentType: string;
  interval: Timeframe;
  detectedAtMs: number;
  detectedAt: number;
  fromMs: number;
  toMs: number;
  items: ReviewChartCandle[];
  quality: ReviewCandleQuality;
  source: ReviewCandleSource;
}

export type ReviewSeriesLoader = (
  instrument: Instrument,
  interval: Timeframe,
  options: LoadSeriesOptions,
) => SeriesLoadResult;

export interface ReviewCandleDependencies {
  loadSeries?: ReviewSeriesLoader;
  resolvePath?: typeof resolveRepoPath;
}

export interface ReviewCandleFallbackDependencies extends ReviewCandleDependencies {
  fetchExchangeCandles?: typeof fetchReviewExchangeCandles;
  exchange?: ReviewExchangeCandleDependencies;
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ReviewCandleError("INVALID_EVENT", `${field} is required`);
  }
  return normalized;
}

function parseInterval(value: string | undefined): Timeframe {
  const interval = value ?? "5m";
  if (interval !== "1m" && interval !== "5m") {
    throw new ReviewCandleError(
      "INVALID_INTERVAL",
      `Unsupported candle interval "${interval}"; expected 1m or 5m`,
    );
  }
  return interval;
}

function parseContext(value: number | undefined, field: string): number {
  const context = value ?? DEFAULT_REVIEW_CANDLE_CONTEXT_MS;
  if (!Number.isSafeInteger(context) || context < 0) {
    throw new ReviewCandleError("INVALID_WINDOW", `${field} must be a non-negative integer`);
  }
  if (context > MAX_REVIEW_CANDLE_CONTEXT_MS) {
    throw new ReviewCandleError(
      "INVALID_WINDOW",
      `${field} cannot exceed ${MAX_REVIEW_CANDLE_CONTEXT_MS}ms`,
    );
  }
  return context;
}

function canonicalParts(coin: string): { base: string | null; quote: string | null } {
  const [base, quote, extra] = coin.split("/");
  if (extra == null && base && quote) return { base, quote };
  return { base: null, quote: null };
}

/** Map persisted detector identity fields to the instrument identity used by market storage. */
export function storedPumpInstrument(event: StoredPump): Instrument {
  const exchange = requireNonEmpty(event.leadingExchange, "leadingExchange").toLowerCase();
  if (exchange !== "binance" && exchange !== "bybit") {
    throw new ReviewCandleError(
      "UNSUPPORTED_EXCHANGE",
      `Historical candles are not supported for exchange "${exchange}"`,
    );
  }

  const symbolNative = requireNonEmpty(event.symbolNative, "symbolNative");
  // The native symbol becomes part of an on-disk path. Reject separators and traversal tokens.
  if (!/^[A-Za-z0-9._:-]+$/.test(symbolNative) || symbolNative.includes("..")) {
    throw new ReviewCandleError(
      "UNSUPPORTED_SYMBOL",
      `Unsupported native symbol "${symbolNative}"`,
    );
  }

  const instrumentType = requireNonEmpty(event.instrumentType, "instrumentType");
  if (!/^[A-Za-z0-9_-]+$/.test(instrumentType) || instrumentType.includes("..")) {
    throw new ReviewCandleError(
      "UNSUPPORTED_INSTRUMENT",
      `Unsupported instrument type "${instrumentType}"`,
    );
  }
  const symbolCanonical = requireNonEmpty(event.coin, "coin");
  const { base, quote } = canonicalParts(symbolCanonical);

  return {
    exchange,
    instrumentType,
    symbolNative,
    symbolCanonical,
    base,
    quote,
    metadata: {},
  };
}

function expectedBarCount(fromMs: number, toMs: number, intervalMs: number): number {
  const firstOpenMs = Math.ceil(fromMs / intervalMs) * intervalMs;
  if (firstOpenMs >= toMs) return 0;
  return Math.ceil((toMs - firstOpenMs) / intervalMs);
}

function chartCandle(candle: Candle): ReviewChartCandle {
  return {
    time: Math.floor(candle.openTimeMs / 1_000),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    quoteVolume: candle.quoteVolume,
  };
}

/**
 * Load a deterministic, bounded historical OHLCV window around a persisted pump event.
 * This service performs no HTTP work and can be wired into the review API directly.
 */
export function loadReviewCandleWindow(
  request: ReviewCandleRequest,
  storage: ReviewCandleStorageOptions = {},
  dependencies: ReviewCandleDependencies = {},
): ReviewCandleWindow {
  if (!request.event || typeof request.event !== "object") {
    throw new ReviewCandleError("INVALID_EVENT", "event is required");
  }

  const eventId = requireNonEmpty(request.event.index, "event.index");

  const detectedAtMs = request.event.startMs;
  if (!Number.isSafeInteger(detectedAtMs) || detectedAtMs < 0) {
    throw new ReviewCandleError(
      "INVALID_EVENT",
      "event.startMs must be a non-negative Unix timestamp in milliseconds",
    );
  }

  const interval = parseInterval(request.interval);
  const beforeMs = parseContext(request.beforeMs, "beforeMs");
  const afterMs = parseContext(request.afterMs, "afterMs");
  if (beforeMs === 0 && afterMs === 0) {
    throw new ReviewCandleError("INVALID_WINDOW", "The candle window cannot be empty");
  }

  const fromMs = detectedAtMs - beforeMs;
  const toMs = detectedAtMs + afterMs;
  if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs < 0) {
    throw new ReviewCandleError(
      "INVALID_WINDOW",
      "The candle window falls outside the supported Unix timestamp range",
    );
  }

  const instrument = storedPumpInstrument(request.event);
  const resolvePath = dependencies.resolvePath ?? resolveRepoPath;
  const dataDir = resolvePath(storage.dataDir ?? "data/market_stats");
  const seriesLoader = dependencies.loadSeries ?? loadSeries;

  let loaded: SeriesLoadResult;
  try {
    loaded = seriesLoader(instrument, interval, {
      ndjsonRoots: [join(dataDir, "api_fallback"), join(dataDir, "extracted")],
      archivesDir: join(dataDir, "archives"),
      useArchives: storage.useArchives ?? true,
      startMs: fromMs,
      endMs: toMs,
      onLog: storage.onLog,
    });
  } catch (error) {
    throw new ReviewCandleError(
      "CANDLE_LOAD_FAILED",
      `Failed to load historical candles for ${instrument.exchange} ${instrument.symbolNative}`,
      { cause: error },
    );
  }

  const items = [...loaded.candles]
    .sort((left, right) => left.openTimeMs - right.openTimeMs)
    .map(chartCandle);
  const expectedBars = expectedBarCount(fromMs, toMs, INTERVAL_MS[interval]);
  const coveragePct =
    expectedBars === 0 ? 0 : Math.min(100, (items.length / expectedBars) * 100);

  return {
    eventId,
    exchange: instrument.exchange,
    symbol: instrument.symbolNative,
    instrumentType: instrument.instrumentType,
    interval,
    detectedAtMs,
    detectedAt: Math.floor(detectedAtMs / 1_000),
    fromMs,
    toMs,
    items,
    quality: {
      ...loaded.quality,
      reasons: [...loaded.quality.reasons],
      expectedBars,
      loadedBars: items.length,
      coveragePct,
    },
    source: {
      source: loaded.meta.source,
      ndjsonBars: loaded.meta.ndjsonBars,
      archiveBars: loaded.meta.archiveBars,
      archiveFileCount: loaded.meta.archiveFiles.length,
      usedArchives: loaded.meta.usedArchives,
      exchangeApiAttempted: false,
      exchangeApiBars: 0,
      exchangeApiError: false,
    },
  };
}

function mergedQuality(
  items: ReviewChartCandle[],
  fromMs: number,
  toMs: number,
  interval: Timeframe,
): ReviewCandleQuality {
  const intervalMs = INTERVAL_MS[interval];
  const expectedBars = expectedBarCount(fromMs, toMs, intervalMs);
  let gaps = 0;
  for (let index = 1; index < items.length; index += 1) {
    const differenceMs = (items[index]!.time - items[index - 1]!.time) * 1_000;
    if (differenceMs > intervalMs) gaps += Math.max(0, Math.round(differenceMs / intervalMs) - 1);
  }
  const loadedBars = items.length;
  const coveragePct =
    expectedBars === 0 ? 0 : Math.min(100, (loadedBars / expectedBars) * 100);
  const reasons: string[] = [];
  if (loadedBars === 0) reasons.push("No candles returned by local storage or exchange API");
  if (loadedBars < expectedBars) reasons.push(`${expectedBars - loadedBars} candles missing`);
  if (gaps > 0) reasons.push(`${gaps} timestamp gaps`);
  return {
    badData: loadedBars < expectedBars || gaps > 0,
    duplicateBars: 0,
    gaps,
    reasons,
    expectedBars,
    loadedBars,
    coveragePct,
  };
}

/**
 * Prefer complete local history, otherwise fill the requested window from the
 * event's public exchange API. Remote candles are returned only to the caller;
 * this path does not write a cache or mutate the market-data archive.
 */
export async function loadReviewCandleWindowWithExchangeFallback(
  request: ReviewCandleRequest,
  storage: ReviewCandleStorageOptions = {},
  dependencies: ReviewCandleFallbackDependencies = {},
): Promise<ReviewCandleWindow> {
  const local = loadReviewCandleWindow(request, storage, dependencies);
  if (
    local.quality.expectedBars > 0 &&
    local.quality.loadedBars >= local.quality.expectedBars &&
    local.quality.coveragePct >= 100
  ) {
    return local;
  }

  const fetchExchangeCandles =
    dependencies.fetchExchangeCandles ?? fetchReviewExchangeCandles;
  let exchangeItems: ReviewChartCandle[];
  try {
    exchangeItems = await fetchExchangeCandles(
      {
        instrument: storedPumpInstrument(request.event),
        interval: local.interval,
        fromMs: local.fromMs,
        toMs: local.toMs,
      },
      dependencies.exchange,
    );
  } catch (error) {
    if (local.items.length > 0) {
      return {
        ...local,
        quality: {
          ...local.quality,
          reasons: [...local.quality.reasons, "Exchange API unavailable; showing local candles"],
        },
        source: {
          ...local.source,
          exchangeApiAttempted: true,
          exchangeApiError: true,
        },
      };
    }
    throw new ReviewCandleError(
      "CANDLE_LOAD_FAILED",
      `Failed to fetch historical candles for ${local.exchange} ${local.symbol}`,
      { cause: error },
    );
  }

  const itemsByTime = new Map<number, ReviewChartCandle>();
  for (const candle of local.items) itemsByTime.set(candle.time, candle);
  for (const candle of exchangeItems) itemsByTime.set(candle.time, candle);
  const items = [...itemsByTime.values()].sort((left, right) => left.time - right.time);
  return {
    ...local,
    items,
    quality: mergedQuality(items, local.fromMs, local.toMs, local.interval),
    source: {
      ...local.source,
      source: local.items.length > 0 ? "local_and_exchange_api" : "exchange_api",
      exchangeApiAttempted: true,
      exchangeApiBars: exchangeItems.length,
      exchangeApiError: false,
    },
  };
}

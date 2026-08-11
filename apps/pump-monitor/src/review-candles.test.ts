import { describe, expect, it, vi } from "vitest";
import type { StoredPump } from "@screener/db";
import type { Candle, SeriesLoadResult } from "@screener/pump-detector";
import {
  DEFAULT_REVIEW_CANDLE_CONTEXT_MS,
  MAX_REVIEW_CANDLE_CONTEXT_MS,
  ReviewCandleError,
  loadReviewCandleWindow,
  storedPumpInstrument,
  type ReviewSeriesLoader,
} from "./review-candles.js";

const DETECTED_AT_MS = Date.parse("2026-07-12T14:32:00.000Z");

function sampleEvent(overrides: Partial<StoredPump> = {}): StoredPump {
  return {
    index: "FUEL/USDT|2026-07-12T14:32:00.000Z",
    episodeType: "pump",
    coin: "FUEL/USDT",
    startMs: DETECTED_AT_MS,
    startUtc: "2026-07-12T14:32:00.000Z",
    endMs: DETECTED_AT_MS + 5 * 60_000,
    endUtc: "2026-07-12T14:37:00.000Z",
    durationMinutes: 5,
    peakScore: 90,
    dominantPhase: "active_pump",
    leadingExchange: "bybit",
    symbolNative: "FUELUSDT",
    instrumentType: "linear_perp",
    tradingViewUrl: "https://example.test/chart",
    confirmed: true,
    confirmedExchanges: ["bybit"],
    eventCount: 1,
    firstSeenAt: "2026-07-12T14:37:00.000Z",
    lastSeenAt: "2026-07-12T14:37:00.000Z",
    classification: null,
    ...overrides,
  };
}

function candle(openTimeMs = DETECTED_AT_MS): Candle {
  return {
    openTimeMs,
    exchange: "bybit",
    instrumentType: "linear_perp",
    symbolNative: "FUELUSDT",
    symbolCanonical: "FUEL/USDT",
    base: "FUEL",
    quote: "USDT",
    interval: "1m",
    open: 0.0121,
    high: 0.0128,
    low: 0.012,
    close: 0.0126,
    volume: 125_000,
    quoteVolume: 1_575,
  };
}

function seriesResult(overrides: Partial<SeriesLoadResult> = {}): SeriesLoadResult {
  return {
    candles: [candle()],
    quality: { badData: false, duplicateBars: 1, gaps: 2, reasons: ["2 timestamp gaps"] },
    meta: {
      source: "merged",
      ndjsonBars: 1,
      archiveBars: 2,
      archiveFiles: ["/private/archive.zip"],
      usedArchives: true,
    },
    ...overrides,
  };
}

describe("storedPumpInstrument", () => {
  it("maps the persisted event's exchange, native symbol, market type and canonical pair", () => {
    expect(storedPumpInstrument(sampleEvent({ leadingExchange: "BYBIT" }))).toEqual({
      exchange: "bybit",
      instrumentType: "linear_perp",
      symbolNative: "FUELUSDT",
      symbolCanonical: "FUEL/USDT",
      base: "FUEL",
      quote: "USDT",
      metadata: {},
    });
  });

  it("rejects unsupported exchanges and unsafe native symbols explicitly", () => {
    expect(() => storedPumpInstrument(sampleEvent({ leadingExchange: "kraken" }))).toThrowError(
      expect.objectContaining<Partial<ReviewCandleError>>({ code: "UNSUPPORTED_EXCHANGE" }),
    );
    expect(() => storedPumpInstrument(sampleEvent({ symbolNative: "../FUELUSDT" }))).toThrowError(
      expect.objectContaining<Partial<ReviewCandleError>>({ code: "UNSUPPORTED_SYMBOL" }),
    );
    expect(() =>
      storedPumpInstrument(sampleEvent({ instrumentType: "../../linear_perp" })),
    ).toThrowError(
      expect.objectContaining<Partial<ReviewCandleError>>({ code: "UNSUPPORTED_INSTRUMENT" }),
    );
  });
});

describe("loadReviewCandleWindow", () => {
  it("loads the default two-hour window and returns chart-ready OHLCV with quality metadata", () => {
    const loader = vi.fn<ReviewSeriesLoader>(() => seriesResult());
    const resolvePath = vi.fn(() => "/repo/data/market_stats");

    const result = loadReviewCandleWindow(
      { event: sampleEvent() },
      {},
      { loadSeries: loader, resolvePath },
    );

    expect(resolvePath).toHaveBeenCalledWith("data/market_stats");
    expect(loader).toHaveBeenCalledWith(
      expect.objectContaining({
        exchange: "bybit",
        symbolNative: "FUELUSDT",
        instrumentType: "linear_perp",
      }),
      "5m",
      {
        ndjsonRoots: [
          "/repo/data/market_stats/api_fallback",
          "/repo/data/market_stats/extracted",
        ],
        archivesDir: "/repo/data/market_stats/archives",
        useArchives: true,
        startMs: DETECTED_AT_MS - DEFAULT_REVIEW_CANDLE_CONTEXT_MS,
        endMs: DETECTED_AT_MS + DEFAULT_REVIEW_CANDLE_CONTEXT_MS,
        onLog: undefined,
      },
    );
    expect(result).toMatchObject({
      eventId: "FUEL/USDT|2026-07-12T14:32:00.000Z",
      exchange: "bybit",
      symbol: "FUELUSDT",
      interval: "5m",
      detectedAt: Math.floor(DETECTED_AT_MS / 1_000),
      items: [
        {
          time: Math.floor(DETECTED_AT_MS / 1_000),
          open: 0.0121,
          high: 0.0128,
          low: 0.012,
          close: 0.0126,
          volume: 125_000,
          quoteVolume: 1_575,
        },
      ],
      quality: {
        badData: false,
        duplicateBars: 1,
        gaps: 2,
        expectedBars: 48,
        loadedBars: 1,
      },
      source: {
        source: "merged",
        ndjsonBars: 1,
        archiveBars: 2,
        archiveFileCount: 1,
        usedArchives: true,
      },
    });
    expect(result.quality.coveragePct).toBeCloseTo(100 / 48);
  });

  it("supports a deterministic bounded 5m window and repository-relative data directory", () => {
    const loader = vi.fn<ReviewSeriesLoader>(() =>
      seriesResult({
        candles: [],
        quality: {
          badData: true,
          duplicateBars: 0,
          gaps: 0,
          reasons: ["No data"],
        },
      }),
    );

    const result = loadReviewCandleWindow(
      {
        event: sampleEvent(),
        interval: "5m",
        beforeMs: 30 * 60_000,
        afterMs: 60 * 60_000,
      },
      { dataDir: "fixtures/market", useArchives: false },
      { loadSeries: loader, resolvePath: (path) => `/repo/${path}` },
    );

    expect(result.fromMs).toBe(DETECTED_AT_MS - 30 * 60_000);
    expect(result.toMs).toBe(DETECTED_AT_MS + 60 * 60_000);
    expect(result.quality).toMatchObject({ expectedBars: 18, loadedBars: 0, coveragePct: 0 });
    expect(result.source.source).toBe("merged");
    expect(loader).toHaveBeenCalledWith(
      expect.anything(),
      "5m",
      expect.objectContaining({
        ndjsonRoots: ["/repo/fixtures/market/api_fallback", "/repo/fixtures/market/extracted"],
        archivesDir: "/repo/fixtures/market/archives",
        useArchives: false,
      }),
    );
  });

  it("keeps chart candles ordered without mutating the loader result", () => {
    const later = candle(DETECTED_AT_MS + 60_000);
    const atDetection = candle();
    const candles = [later, atDetection];

    const result = loadReviewCandleWindow(
      { event: sampleEvent() },
      {},
      {
        loadSeries: () => seriesResult({ candles }),
        resolvePath: (path) => path,
      },
    );

    expect(result.items.map((item) => item.time)).toEqual([
      Math.floor(DETECTED_AT_MS / 1_000),
      Math.floor((DETECTED_AT_MS + 60_000) / 1_000),
    ]);
    expect(candles).toEqual([later, atDetection]);
  });

  it.each([
    [{ interval: "15m" }, "INVALID_INTERVAL"],
    [{ beforeMs: -1 }, "INVALID_WINDOW"],
    [{ afterMs: MAX_REVIEW_CANDLE_CONTEXT_MS + 1 }, "INVALID_WINDOW"],
    [{ beforeMs: 0, afterMs: 0 }, "INVALID_WINDOW"],
  ] as const)("rejects invalid request %j", (request, code) => {
    expect(() =>
      loadReviewCandleWindow(
        { event: sampleEvent(), ...request },
        {},
        { loadSeries: () => seriesResult(), resolvePath: (path) => path },
      ),
    ).toThrowError(expect.objectContaining<Partial<ReviewCandleError>>({ code }));
  });

  it("wraps loader failures with an API-safe error and preserves the cause", () => {
    const cause = new Error("corrupt archive details");

    expect(() =>
      loadReviewCandleWindow(
        { event: sampleEvent() },
        {},
        {
          loadSeries: () => {
            throw cause;
          },
          resolvePath: (path) => path,
        },
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ReviewCandleError>>({
        code: "CANDLE_LOAD_FAILED",
        cause,
        message: "Failed to load historical candles for bybit FUELUSDT",
      }),
    );
  });
});

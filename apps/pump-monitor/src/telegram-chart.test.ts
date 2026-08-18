import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { StoredPump } from "@screener/db";
import {
  createTelegramChartImage,
  renderTelegramChartSvg,
} from "./telegram-chart.js";
import type { ReviewCandleWindow } from "./review-candles.js";

const DETECTED_AT_MS = Date.parse("2026-08-18T12:00:00.000Z");

function sampleEvent(overrides: Partial<StoredPump> = {}): StoredPump {
  return {
    index: "FUEL/USDT|2026-08-18T12:00:00.000Z",
    episodeType: "pump",
    coin: "FUEL/USDT",
    startMs: DETECTED_AT_MS,
    startUtc: "2026-08-18T12:00:00.000Z",
    endMs: DETECTED_AT_MS + 5 * 60_000,
    endUtc: "2026-08-18T12:05:00.000Z",
    durationMinutes: 5,
    peakScore: 96,
    dominantPhase: "active_pump",
    leadingExchange: "binance",
    symbolNative: "FUELUSDT",
    instrumentType: "linear_perp",
    tradingViewUrl: "https://example.test/chart",
    confirmed: true,
    confirmedExchanges: ["binance"],
    eventCount: 2,
    firstSeenAt: "2026-08-18T12:05:00.000Z",
    lastSeenAt: "2026-08-18T12:05:00.000Z",
    classification: null,
    ...overrides,
  };
}

function sampleWindow(items = Array.from({ length: 30 }, (_value, index) => {
  const open = 0.01 + index * 0.0001;
  const close = open + (index % 3 === 0 ? -0.00004 : 0.00007);
  return {
    time: Math.floor((DETECTED_AT_MS - 2 * 60 * 60_000 + index * 5 * 60_000) / 1_000),
    open,
    high: Math.max(open, close) + 0.00005,
    low: Math.min(open, close) - 0.00005,
    close,
    volume: 10_000 + index * 500,
    quoteVolume: 150 + index,
  };
})): ReviewCandleWindow {
  return {
    eventId: sampleEvent().index,
    exchange: "binance",
    symbol: "FUELUSDT",
    instrumentType: "linear_perp",
    interval: "5m",
    detectedAtMs: DETECTED_AT_MS,
    detectedAt: Math.floor(DETECTED_AT_MS / 1_000),
    fromMs: DETECTED_AT_MS - 2 * 60 * 60_000,
    toMs: DETECTED_AT_MS + 30 * 60_000,
    items,
    quality: {
      badData: false,
      duplicateBars: 0,
      gaps: 0,
      reasons: [],
      expectedBars: 30,
      loadedBars: items.length,
      coveragePct: 100,
    },
    source: {
      source: "merged",
      ndjsonBars: items.length,
      archiveBars: 0,
      archiveFileCount: 0,
      usedArchives: false,
      exchangeApiAttempted: false,
      exchangeApiBars: 0,
      exchangeApiError: false,
    },
  };
}

describe("renderTelegramChartSvg", () => {
  it("renders a labeled 5-minute candlestick and volume chart with an event marker", () => {
    const svg = renderTelegramChartSvg(sampleEvent(), sampleWindow());

    expect(svg).toContain('width="1200" height="720"');
    expect(svg).toContain("FUEL/USDT · PUMP · peak 96");
    expect(svg).toContain("BINANCE · FUELUSDT · 5-minute candles");
    expect(svg).toContain("DETECTED");
    expect(svg).toContain('class="body up"');
    expect(svg).toContain('class="body down"');
    expect(svg).toContain('class="volume up"');
  });

  it("rejects a window without usable candles", () => {
    expect(() => renderTelegramChartSvg(sampleEvent(), sampleWindow([]))).toThrow(
      "No valid 5-minute candles available for FUEL/USDT",
    );
  });
});

describe("createTelegramChartImage", () => {
  it("loads a bounded 5m event window and rasterizes it to a Telegram-ready PNG", async () => {
    const loadWindow = vi.fn(async () => sampleWindow());

    const image = await createTelegramChartImage(
      sampleEvent(),
      "/srv/screener/data/market_stats",
      { loadWindow },
    );

    expect(loadWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ coin: "FUEL/USDT" }),
        interval: "5m",
        beforeMs: 2 * 60 * 60_000,
        afterMs: 30 * 60_000,
      }),
      { dataDir: "/srv/screener/data/market_stats" },
    );
    expect(image.filename).toBe("FUEL-USDT-5m.png");
    expect([...image.buffer.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    await expect(sharp(image.buffer).metadata()).resolves.toMatchObject({
      format: "png",
      width: 1_200,
      height: 720,
    });
  });
});

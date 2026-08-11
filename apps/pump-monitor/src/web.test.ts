import { describe, expect, it } from "vitest";
import type { StoredPump } from "@screener/db";
import { renderPumpsPage } from "./web.js";

function sampleStoredPump(overrides: Partial<StoredPump> = {}): StoredPump {
  return {
    index: "BTC/USDT|2026-06-07T00:50:00.000Z",
    episodeType: "pump",
    coin: "BTC/USDT",
    startMs: Date.parse("2026-06-07T00:50:00.000Z"),
    startUtc: "2026-06-07T00:50:00.000Z",
    endMs: Date.parse("2026-06-07T00:55:00.000Z"),
    endUtc: "2026-06-07T00:55:00.000Z",
    durationMinutes: 5,
    peakScore: 91,
    dominantPhase: "active_pump",
    leadingExchange: "binance",
    symbolNative: "BTCUSDT",
    instrumentType: "linear_perp",
    tradingViewUrl: "https://example.com/chart",
    confirmed: true,
    confirmedExchanges: ["binance", "bybit"],
    eventCount: 3,
    firstSeenAt: "2026-06-07T00:56:00.000Z",
    lastSeenAt: "2026-06-07T00:56:00.000Z",
    classification: null,
    ...overrides,
  };
}

describe("renderPumpsPage", () => {
  it("renders the latest pumps table", () => {
    const html = renderPumpsPage(
      [sampleStoredPump()],
      new Date("2026-06-07T01:00:00.000Z"),
    );

    expect(html).toContain("Last 10 Pumps");
    expect(html).toContain("BTC/USDT");
    expect(html).toContain("2026-06-07 00:50 UTC");
    expect(html).toContain("91");
    expect(html).toContain("binance, bybit");
    expect(html).toContain("https://example.com/chart");
    expect(html).toContain("https://cdn.tailwindcss.com");
  });

  describe("when disk space is available", () => {
    it("renders free space, total, and used percent", () => {
      const html = renderPumpsPage([sampleStoredPump()], new Date(), {
        freeBytes: 412 * 1024 ** 3,
        totalBytes: 1024 ** 4,
        usedPercent: 59,
      });

      expect(html).toContain("412 GB free of 1.0 TB");
      expect(html).toContain("59% used");
    });

    it("renders the usage bar at the used percent", () => {
      const html = renderPumpsPage([sampleStoredPump()], new Date(), {
        freeBytes: 412 * 1024 ** 3,
        totalBytes: 1024 ** 4,
        usedPercent: 59,
      });

      expect(html).toContain('style="width:59%"');
    });
  });

  describe("when free space is under fifteen percent", () => {
    it("renders the usage bar in amber", () => {
      const html = renderPumpsPage([sampleStoredPump()], new Date(), {
        freeBytes: 100 * 1024 ** 3,
        totalBytes: 1024 ** 4,
        usedPercent: 90,
      });

      expect(html).toContain("bg-amber-500");
      expect(html).not.toContain("bg-red-500");
    });
  });

  describe("when free space is under five percent", () => {
    it("renders the usage bar in red", () => {
      const html = renderPumpsPage([sampleStoredPump()], new Date(), {
        freeBytes: 20 * 1024 ** 3,
        totalBytes: 1024 ** 4,
        usedPercent: 98,
      });

      expect(html).toContain("bg-red-500");
      expect(html).not.toContain("bg-amber-500");
    });
  });

  describe("when disk space could not be read", () => {
    it("renders an unavailable notice without a usage bar", () => {
      const html = renderPumpsPage([sampleStoredPump()], new Date(), null);

      expect(html).toContain("Disk usage unavailable");
      expect(html).not.toContain("free of");
      expect(html).not.toContain('style="width:');
    });
  });

  it("escapes text and suppresses unsafe chart links", () => {
    const html = renderPumpsPage([
      sampleStoredPump({
        coin: "<BAD/USDT>",
        tradingViewUrl: "javascript:alert(1)",
      }),
    ]);

    expect(html).toContain("&lt;BAD/USDT&gt;");
    expect(html).not.toContain("<BAD/USDT>");
    expect(html).not.toContain("javascript:alert");
    expect(html).toContain("Unavailable");
  });
});

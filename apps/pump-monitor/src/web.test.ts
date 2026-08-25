import { describe, expect, it } from "vitest";
import type { StoredPump, TelegramSubscriberHistoryPoint } from "@screener/db";
import { renderIndexPage } from "./index-page.js";

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

function renderPage(
  pumps: StoredPump[],
  generatedAt: Date = new Date(),
  disk: Parameters<typeof renderIndexPage>[0]["disk"] = null,
  subscriberHistory: TelegramSubscriberHistoryPoint[] = [],
): string {
  return renderIndexPage({ pumps, generatedAt, disk, subscriberHistory });
}

describe("renderIndexPage", () => {
  it("renders the latest pumps table", () => {
    const html = renderPage(
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
      const html = renderPage([sampleStoredPump()], new Date(), {
        freeBytes: 412 * 1024 ** 3,
        totalBytes: 1024 ** 4,
        usedPercent: 59,
      });

      expect(html).toContain("412 GB free of 1.0 TB");
      expect(html).toContain("59% used");
    });

    it("renders the usage bar at the used percent", () => {
      const html = renderPage([sampleStoredPump()], new Date(), {
        freeBytes: 412 * 1024 ** 3,
        totalBytes: 1024 ** 4,
        usedPercent: 59,
      });

      expect(html).toContain('style="width:59%"');
    });
  });

  describe("when free space is under fifteen percent", () => {
    it("renders the usage bar in amber", () => {
      const html = renderPage([sampleStoredPump()], new Date(), {
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
      const html = renderPage([sampleStoredPump()], new Date(), {
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
      const html = renderPage([sampleStoredPump()], new Date(), null);

      expect(html).toContain("Disk usage unavailable");
      expect(html).not.toContain("free of");
      expect(html).not.toContain('style="width:');
    });
  });

  it("escapes text and suppresses unsafe chart links", () => {
    const html = renderPage([
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

  it("renders accessible same-page tabs with pumps selected by default", () => {
    const html = renderPage([sampleStoredPump()]);

    expect(html).toContain('role="tablist"');
    expect(html).toContain(
      'id="tab-pumps" type="button" role="tab" aria-controls="panel-pumps" aria-selected="true"',
    );
    expect(html).toContain(
      'id="tab-subscribers" type="button" role="tab" aria-controls="panel-subscribers" aria-selected="false"',
    );
    expect(html).toContain(
      'id="panel-subscribers" role="tabpanel" aria-labelledby="tab-subscribers" tabindex="0" hidden',
    );
    expect(html).not.toContain('href="/subscribers"');
  });

  it("renders the current subscriber count and historical chart points", () => {
    const html = renderPage(
      [sampleStoredPump()],
      new Date("2026-06-07T01:00:00.000Z"),
      null,
      [
        { occurredAt: "2026-06-01T10:00:00.000Z", count: 1 },
        { occurredAt: "2026-06-03T10:00:00.000Z", count: 3 },
        { occurredAt: "2026-06-05T10:00:00.000Z", count: 2 },
      ],
    );

    expect(html).toContain('data-active-subscriber-count="2"');
    expect(html).toContain("Telegram bot subscriber count over time");
    expect(html).toContain('data-occurred-at="2026-06-01T10:00:00.000Z" data-count="1"');
    expect(html).toContain('data-occurred-at="2026-06-05T10:00:00.000Z" data-count="2"');
    expect(html).toContain("Tracking since Jun 01, 2026 UTC");
  });

  it("renders a subscriber empty state when no history exists", () => {
    const html = renderPage([sampleStoredPump()]);

    expect(html).toContain('data-active-subscriber-count="0"');
    expect(html).toContain("No subscriber history yet");
    expect(html).toContain("The chart will appear after the bot records its first subscriber.");
  });
});

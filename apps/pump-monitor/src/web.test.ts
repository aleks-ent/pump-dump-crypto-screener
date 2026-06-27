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

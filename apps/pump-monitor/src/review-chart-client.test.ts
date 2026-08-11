import { describe, expect, it } from "vitest";
import {
  renderReviewChart,
  REVIEW_CHART_CLIENT_SCRIPT,
} from "./review-chart-client.js";

describe("review chart client", () => {
  it("renders an accessible, event-scoped chart shell with interval and recovery controls", () => {
    const html = renderReviewChart({
      eventId: 'pump|BTC/USDT|<unsafe>"',
      detectedAtMs: 1_788_000_000_000,
      exchange: "binance",
      symbol: "BTCUSDT",
      instrumentType: "linear_perp",
    });

    expect(html).toContain('data-chart-state="loading"');
    expect(html).toContain('data-event-id="pump|BTC/USDT|&lt;unsafe&gt;&quot;"');
    expect(html).toContain('data-detected-at-ms="1788000000000"');
    expect(html).toContain('data-chart-interval="1m" aria-pressed="false"');
    expect(html).toContain('class="is-active" data-chart-interval="5m" aria-pressed="true"');
    expect(html).toContain("Preparing the 5 minute view");
    expect(html).toContain('aria-label="Historical OHLCV chart for the selected event"');
    expect(html).toContain("2h before · 2h after pump time");
    expect(html).toContain("data-chart-retry");
    expect(html).toContain("TradingView fallback");
    expect(html).toContain("TradingView 1m");
    expect(html).toContain("TradingView 5m");
    expect(html).toContain(
      "https://www.tradingview.com/chart/?symbol=BINANCE%3ABTCUSDT.P&amp;interval=1",
    );
    expect(html).toContain(
      "https://www.tradingview.com/chart/?symbol=BINANCE%3ABTCUSDT.P&amp;interval=5",
    );
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("2026-08-29 10:40:00 UTC");
    expect(html).toContain('data-copy-value="2026-08-29"');
    expect(html).toContain('data-copy-value="10:40"');
    expect(html).toContain("Copy date");
    expect(html).toContain("Copy time");
    expect(html).toContain("timezone to UTC");
    expect(html).toContain("Alt/Option + G");
    expect(html).not.toContain("<unsafe>");
  });

  it("maps a Bybit spot symbol without the perpetual suffix", () => {
    const html = renderReviewChart({
      eventId: "spot-event",
      detectedAtMs: Date.parse("2026-07-12T14:32:00.000Z"),
      exchange: "bybit",
      symbol: "ETHUSDT",
      instrumentType: "spot",
    });

    expect(html).toContain(
      "https://www.tradingview.com/chart/?symbol=BYBIT%3AETHUSDT&amp;interval=1",
    );
    expect(html).toContain(
      "https://www.tradingview.com/chart/?symbol=BYBIT%3AETHUSDT&amp;interval=5",
    );
    expect(html).not.toContain("ETHUSDT.P");
  });

  it("ships a valid dependency-free client with deterministic loading and marker behavior", () => {
    expect(() => new Function(REVIEW_CHART_CLIENT_SCRIPT)).not.toThrow();
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("/api/market-data/candles?");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("eventId,");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("detectedAtMs - CONTEXT_MS");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("detectedAtMs + CONTEXT_MS");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("let interval = '5m'");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("[0, 'Pump start', true]");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("[5 * 60, '+5m', false]");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("[10 * 60, '+10m', false]");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("[15 * 60, '+15m', false]");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("new ResizeObserver");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("showState('empty'");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("showState('error'");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("navigator.clipboard.writeText");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("document.execCommand('copy')");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("Paste it into TradingView’s");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("retry.addEventListener('click', load)");
  });
});

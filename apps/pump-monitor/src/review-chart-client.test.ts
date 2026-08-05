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
    });

    expect(html).toContain('data-chart-state="loading"');
    expect(html).toContain('data-event-id="pump|BTC/USDT|&lt;unsafe&gt;&quot;"');
    expect(html).toContain('data-detected-at-ms="1788000000000"');
    expect(html).toContain('data-chart-interval="1m"');
    expect(html).toContain('data-chart-interval="5m"');
    expect(html).toContain('aria-label="Historical OHLCV chart for the selected event"');
    expect(html).toContain("2h before · 2h after detection");
    expect(html).toContain("data-chart-retry");
    expect(html).not.toContain("<unsafe>");
  });

  it("ships a valid dependency-free client with deterministic loading and marker behavior", () => {
    expect(() => new Function(REVIEW_CHART_CLIENT_SCRIPT)).not.toThrow();
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("/api/market-data/candles?");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("eventId,");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("detectedAtMs - CONTEXT_MS");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("detectedAtMs + CONTEXT_MS");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("[0, 'Detection', true]");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("[5 * 60, '+5m', false]");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("[10 * 60, '+10m', false]");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("[15 * 60, '+15m', false]");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("new ResizeObserver");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("showState('empty'");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("showState('error'");
    expect(REVIEW_CHART_CLIENT_SCRIPT).toContain("retry.addEventListener('click', load)");
  });
});

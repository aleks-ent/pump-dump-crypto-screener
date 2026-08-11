import { describe, expect, it } from "vitest";
import {
  renderReviewPage,
  type ReviewEventSummary,
} from "./review-page.js";

function event(
  overrides: Partial<ReviewEventSummary> = {},
): ReviewEventSummary {
  return {
    id: "event-101",
    symbol: "FUELUSDT",
    exchange: "bybit",
    detectedAt: "2026-07-12T14:32:00.000Z",
    status: "unreviewed",
    marketType: "linear_perp",
    ...overrides,
  };
}

describe("renderReviewPage", () => {
  it("renders the desktop review workspace with a selected event", () => {
    const html = renderReviewPage({
      events: [
        event(),
        event({
          id: "event-102",
          symbol: "WIFUSDT",
          status: "reviewed",
          category: "wick_spike",
        }),
      ],
      progress: { total: 684, reviewed: 203, unreviewed: 471, unclear: 10 },
    });

    expect(html).toContain("Pump Event Reviewer");
    expect(html).toContain('class="review-grid"');
    expect(html).toContain('data-event-list');
    expect(html).toContain('data-chart-root');
    expect(html).toContain('data-annotation-root');
    expect(html).toContain('data-selected-event-id="event-101"');
    expect(html).toContain('data-event-id="event-101"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("FUELUSDT");
    expect(html).toContain("2026-07-12 14:32:00 UTC");
    expect(html).toContain("linear_perp");
    expect(html).toContain("TradingView fallback");
    expect(html).toContain("TradingView 1m");
    expect(html).toContain("TradingView 5m");
    expect(html).toContain("BYBIT%3AFUELUSDT.P");
    expect(html).toContain("Copy date");
    expect(html).toContain("Copy time");
    expect(html).toContain("213</strong> / 684 reviewed");
    expect(html).toContain("31%");
    expect(html).toContain("Historical chart");
    expect(html).toContain("Classify event");
    expect(html).toContain("Keyboard shortcuts");
    expect(html).toContain('data-unsaved-dialog');
    expect(html).toContain("review:annotation-save-request");
    expect(html).toContain("beforeunload");
    expect(html).toContain("@media (max-width:1050px)");
  });

  it("enables editing for the selected event's existing annotation", () => {
    const html = renderReviewPage({
      events: [
        event({
          status: "reviewed",
          category: "market_move",
          confidence: "medium",
          comment: "Tracked the broader BTC move.",
        }),
      ],
    });

    expect(html).toContain('data-annotation-state="ready"');
    expect(html).toContain('value="market_move" checked');
    expect(html).toContain('value="medium" selected');
    expect(html).toContain("Tracked the broader BTC move.");
    expect(html).toContain("Editing saved annotation.");
    expect(html).toContain("/api/pump-events/");
    expect(html).toContain("method: 'PUT'");
  });

  it("uses the required default filters and preserves filters in event links", () => {
    const html = renderReviewPage({
      events: [event()],
      filters: {
        exchange: "bybit",
        symbol: "FUEL",
        dateFrom: "2026-07-01",
      },
    });

    expect(html).toContain('<option value="unreviewed" selected>Unreviewed</option>');
    expect(html).toContain(
      '<option value="detectedAtAsc" selected>Pump time: oldest first</option>',
    );
    expect(html).toContain("status=unreviewed");
    expect(html).toContain("exchange=bybit");
    expect(html).toContain("symbol=FUEL");
    expect(html).toContain("dateFrom=2026-07-01");
    expect(html).toContain("event=event-101");
    expect(html).toContain("new URLSearchParams(new FormData(form))");
  });

  it("keeps detector-only metadata out of the reviewer interface", () => {
    const detectorEvent = {
      ...event(),
      detectorVersion: "0.4.1",
      detectorScore: 87,
      triggerSummary: "price +8.4% · volume 5.1×",
    };
    const html = renderReviewPage({ events: [detectorEvent] });

    expect(html).not.toContain('name="detectorVersion"');
    expect(html).not.toContain("Detector score");
    expect(html).not.toContain("0.4.1");
    expect(html).not.toContain("price +8.4%");
    expect(html).toContain("2026-07-12 14:32:00 UTC");
    expect(html).toContain("TradingView fallback");
  });

  it("renders a load-more control that retains query state", () => {
    const html = renderReviewPage({
      events: [event()],
      filters: { status: "all", category: "wick_spike" },
      pagination: { page: 2, pageSize: 50, loadedCount: 100, hasMore: true },
    });

    expect(html).toContain('data-load-more');
    expect(html).toContain("status=all");
    expect(html).toContain("category=wick_spike");
    expect(html).toContain("page=3");
  });

  it("renders filtered and complete JSON/CSV export controls", () => {
    const html = renderReviewPage({
      events: [event()],
      filters: { status: "reviewed", exchange: "bybit", symbol: "FUEL" },
    });

    expect(html.match(/<a href="[^"]+" data-review-export>/g)).toHaveLength(4);
    expect(html).toContain("format=json&amp;scope=filtered&amp;status=reviewed");
    expect(html).toContain("exchange=bybit");
    expect(html).toContain("scope=all-reviewed");
    expect(html).toContain("Preparing export");
  });

  it.each([
    ["loading", "Loading events…"],
    ["error", "Database temporarily unavailable"],
  ] as const)("renders the %s list state", (listState, message) => {
    const html = renderReviewPage({
      listState,
      errorMessage: "Database temporarily unavailable",
    });

    expect(html).toContain(`data-list-state="${listState}"`);
    expect(html).toContain(message);
  });

  it("renders an empty state and safely escapes event data", () => {
    const emptyHtml = renderReviewPage();
    const eventHtml = renderReviewPage({
      events: [
        event({
          id: 'event-\"unsafe',
          symbol: "<script>alert(1)</script>",
        }),
      ],
    });

    expect(emptyHtml).toContain('data-list-state="empty"');
    expect(emptyHtml).toContain("No matching events");
    expect(emptyHtml).toContain('data-selection-state="empty"');
    expect(eventHtml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(eventHtml).not.toContain("<script>alert(1)</script>");
  });
});

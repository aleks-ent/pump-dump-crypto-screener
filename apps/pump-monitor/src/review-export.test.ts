import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type {
  PumpAnnotation,
  PumpEventFilters,
  PumpReviewEvent,
  StoredPump,
} from "@screener/db";
import {
  MAX_REVIEW_EXPORT_EVENTS,
  ReviewExportLimitError,
  createReviewCsv,
  createReviewExport,
  escapeCsvField,
  handleReviewExportRequest,
  listReviewEventsForExport,
  reviewExportFilename,
  serializeReviewExportEvent,
  type ReviewExportRepositoryLike,
} from "./review-export.js";

function pump(id: string, startMs: number): StoredPump {
  return {
    index: id,
    episodeType: "pump",
    coin: "FUEL/USDT",
    startMs,
    startUtc: new Date(startMs).toISOString(),
    endMs: startMs + 300_000,
    endUtc: new Date(startMs + 300_000).toISOString(),
    durationMinutes: 5,
    peakScore: 0.81,
    dominantPhase: "active_pump",
    leadingExchange: "bybit",
    symbolNative: "FUELUSDT",
    instrumentType: "linear",
    tradingViewUrl: "https://example.com/FUELUSDT",
    confirmed: true,
    confirmedExchanges: ["bybit", "binance"],
    eventCount: 3,
    firstSeenAt: new Date(startMs + 301_000).toISOString(),
    lastSeenAt: new Date(startMs + 302_000).toISOString(),
    classification: null,
  };
}

function annotation(
  eventId: string,
  category: PumpAnnotation["category"],
  comment = "Manual label",
): PumpAnnotation {
  return {
    id: `annotation-${eventId}`,
    eventId,
    source: "human",
    category,
    confidence: "high",
    comment,
    createdAt: "2026-08-04T14:00:00.000Z",
    updatedAt: "2026-08-04T14:20:00.000Z",
  };
}

function reviewEvent(
  id: string,
  startMs: number,
  category?: PumpAnnotation["category"],
  comment?: string,
): PumpReviewEvent {
  const humanAnnotation = category ? annotation(id, category, comment) : null;
  return {
    pump: pump(id, startMs),
    annotation: humanAnnotation,
    status:
      humanAnnotation == null
        ? "unreviewed"
        : humanAnnotation.category === "unclear"
          ? "unclear"
          : "reviewed",
    telegramVotes: { pump: 0, dump: 0, none: 0 },
  };
}

class ArrayRepository implements ReviewExportRepositoryLike {
  readonly calls: PumpEventFilters[] = [];

  constructor(private readonly events: PumpReviewEvent[]) {}

  async listReviewEvents(filters: PumpEventFilters = {}) {
    this.calls.push(filters);
    const matching = this.events.filter((event) => {
      if (filters.status === "reviewed") return event.status === "reviewed";
      if (filters.status === "unclear") return event.status === "unclear";
      if (filters.status === "unreviewed") return event.status === "unreviewed";
      if (filters.exchange) return event.pump.leadingExchange === filters.exchange;
      return true;
    });
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const offset = (page - 1) * pageSize;
    return {
      items: matching.slice(offset, offset + pageSize),
      page,
      pageSize,
      total: matching.length,
    };
  }
}

describe("pump review exports", () => {
  it("exports every page in the current filtered dataset and ignores UI pagination", async () => {
    const events = Array.from({ length: 501 }, (_, index) =>
      reviewEvent(
        `event-${index}`,
        Date.UTC(2026, 6, 1, 0, index),
        "sustained_move",
      ),
    );
    const repository = new ArrayRepository(events);

    const exported = await listReviewEventsForExport(repository, "filtered", {
      status: "all",
      exchange: "bybit",
      page: 9,
      pageSize: 10,
    });

    expect(exported).toHaveLength(501);
    expect(repository.calls).toHaveLength(3);
    expect(repository.calls[0]).toMatchObject({
      status: "all",
      exchange: "bybit",
      page: 1,
      pageSize: 250,
    });
  });

  it("omits unreviewed rows from filtered labeled-data exports", async () => {
    const repository = new ArrayRepository([
      reviewEvent("unreviewed", 1),
      reviewEvent("reviewed", 2, "volume_only"),
    ]);

    const exported = await listReviewEventsForExport(repository, "filtered", {
      status: "all",
    });

    expect(exported.map((event) => event.pump.index)).toEqual(["reviewed"]);
  });

  it("exports all human-reviewed and unclear events in deterministic event order", async () => {
    const repository = new ArrayRepository([
      reviewEvent("unreviewed", 1),
      reviewEvent("unclear", 3, "unclear"),
      reviewEvent("reviewed", 2, "sustained_move"),
    ]);

    const events = await listReviewEventsForExport(repository, "all-reviewed", {
      exchange: "ignored",
    });

    expect(events.map((event) => event.pump.index)).toEqual(["reviewed", "unclear"]);
    expect(repository.calls.map((call) => call.status)).toEqual(["reviewed", "unclear"]);
    expect(repository.calls.every((call) => call.exchange == null)).toBe(true);
  });

  it("preserves detector metadata, trigger data, and all human annotation timestamps", async () => {
    const event = reviewEvent("event-1", Date.UTC(2026, 6, 12), "wick_spike");
    const repository = new ArrayRepository([event]);

    const file = await createReviewExport(repository, {
      format: "json",
      scope: "all-reviewed",
    });
    const parsed = JSON.parse(file.body) as ReturnType<typeof serializeReviewExportEvent>[];

    expect(file).toMatchObject({
      filename: "pump-event-reviews-all-reviewed.json",
      contentType: "application/json; charset=utf-8",
      eventCount: 1,
    });
    expect(parsed[0]).toMatchObject({
      eventId: "event-1",
      detectorScore: 0.81,
      triggerData: {
        durationMinutes: 5,
        confirmedExchanges: ["bybit", "binance"],
      },
      eventMetadata: {
        index: "event-1",
        tradingViewUrl: "https://example.com/FUELUSDT",
      },
      humanAnnotation: {
        id: "annotation-event-1",
        source: "human",
        category: "wick_spike",
        createdAt: "2026-08-04T14:00:00.000Z",
        updatedAt: "2026-08-04T14:20:00.000Z",
      },
    });
  });

  it("escapes commas, quotes, Unicode, and embedded newlines in CSV fields", () => {
    const event = serializeReviewExportEvent(
      reviewEvent(
        "event,\"1\"",
        Date.UTC(2026, 6, 12),
        "wick_spike",
        "Привет, \"pump\"\nsecond line\r\nthird line",
      ),
    );
    const csv = createReviewCsv([event]);

    expect(csv).toContain(
      '"event,""1""",bybit,linear,FUELUSDT,',
    );
    expect(csv).toContain(
      '"Привет, ""pump""\nsecond line\r\nthird line"',
    );
    expect(csv).toContain('"{\"\"episodeType\"\":\"\"pump\"\"');
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(escapeCsvField("plain π")).toBe("plain π");
  });

  it("uses deterministic filenames and refuses oversized datasets", async () => {
    expect(reviewExportFilename("filtered", "csv")).toBe(
      "pump-event-reviews-filtered.csv",
    );
    const repository: ReviewExportRepositoryLike = {
      async listReviewEvents(filters = {}) {
        return {
          items: [],
          page: filters.page ?? 1,
          pageSize: filters.pageSize ?? 250,
          total: MAX_REVIEW_EXPORT_EVENTS + 1,
        };
      },
    };

    await expect(
      createReviewExport(repository, { format: "csv", scope: "filtered" }),
    ).rejects.toBeInstanceOf(ReviewExportLimitError);
  });
});

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

describe("pump review export HTTP handler", () => {
  it("returns a downloadable CSV response for later server wiring", async () => {
    const repository = new ArrayRepository([
      reviewEvent("event-1", Date.UTC(2026, 6, 12), "volume_only"),
    ]);
    const server = createServer((req, res) => {
      void handleReviewExportRequest(req, res, repository).then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address == null || typeof address === "string") throw new Error("Missing address");

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/pump-events/export?format=csv&scope=all-reviewed`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="pump-event-reviews-all-reviewed.csv"',
    );
    expect(response.headers.get("x-export-event-count")).toBe("1");
    expect(await response.text()).toContain("event_id,exchange,market_type");
  });
});

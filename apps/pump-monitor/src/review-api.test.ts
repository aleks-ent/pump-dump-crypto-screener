import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type {
  PumpAnnotation,
  PumpEventFilters,
  PumpReviewEvent,
  PumpReviewStats,
  StoredPump,
} from "@screener/db";
import {
  handleReviewApiRequest,
  parseAnnotationInput,
  parsePumpEventFilters,
  serializeReviewEvent,
  type ReviewRepositoryLike,
} from "./review-api.js";

function samplePump(): StoredPump {
  return {
    index: "pump|BTC/USDT|2026-07-01T10:00:00.000Z",
    episodeType: "pump",
    coin: "BTC/USDT",
    startMs: Date.parse("2026-07-01T10:00:00.000Z"),
    startUtc: "2026-07-01T10:00:00.000Z",
    endMs: Date.parse("2026-07-01T10:05:00.000Z"),
    endUtc: "2026-07-01T10:05:00.000Z",
    durationMinutes: 5,
    peakScore: 91,
    dominantPhase: "active_pump",
    leadingExchange: "bybit",
    symbolNative: "BTCUSDT",
    instrumentType: "linear_perp",
    tradingViewUrl: "https://example.com/chart",
    confirmed: true,
    confirmedExchanges: ["bybit", "binance"],
    eventCount: 2,
    firstSeenAt: "2026-07-01T10:06:00.000Z",
    lastSeenAt: "2026-07-01T10:07:00.000Z",
    classification: null,
  };
}

function annotation(): PumpAnnotation {
  return {
    id: "annotation-1",
    eventId: samplePump().index,
    source: "human",
    category: "wick_spike",
    confidence: "high",
    comment: "Fast retrace",
    createdAt: "2026-08-05T10:00:00.000Z",
    updatedAt: "2026-08-05T10:00:00.000Z",
  };
}

function event(): PumpReviewEvent {
  return {
    pump: samplePump(),
    annotation: null,
    status: "unreviewed",
    telegramVotes: { pump: 3, dump: 1, none: 2 },
  };
}

class FakeReviewRepository implements ReviewRepositoryLike {
  lastFilters: PumpEventFilters | undefined;
  savedInput: Parameters<ReviewRepositoryLike["upsertAnnotation"]>[0] | undefined;

  async listReviewEvents(filters?: PumpEventFilters) {
    this.lastFilters = filters;
    return { items: [event()], page: 1, pageSize: 25, total: 1 };
  }

  async getReviewEvent(eventId: string) {
    return eventId === samplePump().index ? event() : null;
  }

  async upsertAnnotation(input: Parameters<ReviewRepositoryLike["upsertAnnotation"]>[0]) {
    this.savedInput = input;
    return annotation();
  }

  async getReviewStats(): Promise<PumpReviewStats> {
    return {
      total: 1,
      reviewed: 0,
      unreviewed: 1,
      unclear: 0,
      reviewedPercentage: 0,
      categories: {
        sustained_move: 0,
        wick_spike: 0,
        volume_only: 0,
        market_move: 0,
        illiquid_noise: 0,
        unclear: 0,
      },
    };
  }
}

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

async function request(repository: ReviewRepositoryLike, path: string, init?: RequestInit) {
  const server = createServer((req, res) => {
    void handleReviewApiRequest(req, res, repository).then((handled) => {
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
  return fetch(`http://127.0.0.1:${address.port}${path}`, init);
}

describe("pump review API", () => {
  it("defaults to unreviewed events with the latest pumps first", () => {
    expect(parsePumpEventFilters(new URLSearchParams())).toMatchObject({
      status: "unreviewed",
      sort: "detectedAtDesc",
      page: 1,
      pageSize: 50,
    });
  });

  it("parses bounded filters and date-only end dates", () => {
    const filters = parsePumpEventFilters(
      new URLSearchParams(
        "status=reviewed&category=wick_spike&exchange=bybit&symbol=btc&dateFrom=2026-07-01&dateTo=2026-07-02&sort=symbolAsc&page=2&pageSize=25",
      ),
    );
    expect(filters).toMatchObject({
      status: "reviewed",
      category: "wick_spike",
      exchange: "bybit",
      symbol: "btc",
      sort: "symbolAsc",
      page: 2,
      pageSize: 25,
      dateFromMs: Date.parse("2026-07-01T00:00:00Z"),
      dateToMs: Date.parse("2026-07-03T00:00:00Z"),
    });
  });

  it("serializes all stored pump metadata", () => {
    const serialized = serializeReviewEvent(event());
    expect(serialized).toMatchObject({
      id: samplePump().index,
      exchange: "bybit",
      symbol: "BTCUSDT",
      detectedAt: "2026-07-01T10:00:00.000Z",
      detectorScore: 91,
      reviewStatus: "unreviewed",
      telegramVotes: { pump: 3, dump: 1, none: 2 },
      metadata: { coin: "BTC/USDT", eventCount: 2 },
    });
  });

  it("rejects invalid annotation values without clearing valid input", () => {
    expect(() => parseAnnotationInput({ category: "other", comment: "Keep me" })).toThrow(
      "Select one of the six",
    );
    expect(parseAnnotationInput({ category: "unclear", comment: "  Needs data  " })).toEqual({
      category: "unclear",
      confidence: null,
      comment: "Needs data",
    });
  });

  it("lists filtered events and returns progress statistics", async () => {
    const repository = new FakeReviewRepository();
    const list = await request(
      repository,
      "/api/pump-events?status=unreviewed&sort=detectedAtAsc&pageSize=25",
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ total: 1, items: [{ symbol: "BTCUSDT" }] });
    expect(repository.lastFilters).toMatchObject({ status: "unreviewed", pageSize: 25 });

    const stats = await request(repository, "/api/pump-events/stats");
    expect(await stats.json()).toMatchObject({ total: 1, unreviewed: 1 });
  });

  it("creates a human annotation and reports missing events", async () => {
    const repository = new FakeReviewRepository();
    const id = encodeURIComponent(samplePump().index);
    const saved = await request(repository, `/api/pump-events/${id}/annotation`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: "wick_spike",
        confidence: "high",
        comment: "Fast retrace",
      }),
    });
    expect(saved.status).toBe(200);
    expect(repository.savedInput).toMatchObject({
      eventId: samplePump().index,
      source: "human",
      category: "wick_spike",
    });

    const missing = await request(repository, "/api/pump-events/missing");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "event_not_found" } });
  });
});

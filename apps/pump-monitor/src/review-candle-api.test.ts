import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PumpReviewEvent, StoredPump } from "@screener/db";
import { handleReviewCandleApiRequest } from "./review-candle-api.js";
import type { ReviewCandleWindowLoader } from "./review-candle-api.js";

function pump(): StoredPump {
  const startMs = Date.parse("2026-07-01T10:00:00Z");
  return {
    index: "pump|BTC/USDT|2026-07-01T10:00:00.000Z",
    episodeType: "pump",
    coin: "BTC/USDT",
    startMs,
    startUtc: new Date(startMs).toISOString(),
    endMs: startMs + 300_000,
    endUtc: new Date(startMs + 300_000).toISOString(),
    durationMinutes: 5,
    peakScore: 91,
    dominantPhase: "active_pump",
    leadingExchange: "bybit",
    symbolNative: "BTCUSDT",
    instrumentType: "linear_perp",
    tradingViewUrl: "https://example.com",
    confirmed: false,
    confirmedExchanges: ["bybit"],
    eventCount: 1,
    firstSeenAt: new Date(startMs).toISOString(),
    lastSeenAt: new Date(startMs).toISOString(),
    classification: null,
  };
}

const reviewEvent: PumpReviewEvent = {
  pump: pump(),
  annotation: null,
  status: "unreviewed",
  telegramVotes: { pump: 0, dump: 0, none: 0 },
};
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

async function request(path: string, loader: ReviewCandleWindowLoader, method = "GET") {
  const repository = {
    getReviewEvent: vi.fn(async (id: string) => (id === pump().index ? reviewEvent : null)),
  };
  const server = createServer((req, res) => {
    void handleReviewCandleApiRequest(req, res, repository, loader);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("Missing address");
  return fetch(`http://127.0.0.1:${address.port}${path}`, { method });
}

describe("review candle API", () => {
  it("loads the selected event with default context", async () => {
    const loader = vi.fn(() => ({ items: [{ time: 1 }], interval: "5m" })) as unknown as ReviewCandleWindowLoader;
    const id = encodeURIComponent(pump().index);
    const response = await request(`/api/market-data/candles?eventId=${id}`, loader);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [{ time: 1 }], interval: "5m" });
    expect(loader).toHaveBeenCalledWith({
      event: expect.objectContaining({ symbolNative: "BTCUSDT" }),
      interval: undefined,
      beforeMs: undefined,
      afterMs: undefined,
    });
  });

  it("converts explicit timestamps to bounded event context", async () => {
    const loader = vi.fn(() => ({ items: [] })) as unknown as ReviewCandleWindowLoader;
    const id = encodeURIComponent(pump().index);
    const from = pump().startMs - 3_600_000;
    const to = pump().startMs + 7_200_000;
    const response = await request(
      `/api/market-data/candles?eventId=${id}&interval=5m&from=${from}&to=${to}`,
      loader,
    );
    expect(response.status).toBe(200);
    expect(loader).toHaveBeenCalledWith(expect.objectContaining({
      interval: "5m",
      beforeMs: 3_600_000,
      afterMs: 7_200_000,
    }));
  });

  it("returns explicit validation, missing-event, and method errors", async () => {
    const loader = vi.fn(() => ({ items: [] })) as unknown as ReviewCandleWindowLoader;
    expect((await request("/api/market-data/candles", loader)).status).toBe(400);
    expect(
      (await request("/api/market-data/candles?eventId=missing", loader)).status,
    ).toBe(404);
    expect(
      (await request("/api/market-data/candles?eventId=missing", loader, "POST")).status,
    ).toBe(405);
  });
});

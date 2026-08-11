import { beforeEach, describe, expect, it } from "vitest";
import type { PumpEpisode } from "@screener/pump-detector";
import { createMemoryDbClient } from "../client.js";
import { PumpRepository } from "../pumps/repository.js";
import { PumpReviewRepository } from "./repository.js";
import {
  ANNOTATION_CONFIDENCES,
  PUMP_CATEGORIES,
  isAnnotationConfidence,
  isPumpCategory,
  type PumpAnnotation,
} from "./types.js";

function sampleEpisode(
  coin: string,
  startMs: number,
  options: Partial<PumpEpisode> = {},
): PumpEpisode {
  return {
    coin,
    type: "pump",
    startMs,
    endMs: startMs + 300_000,
    durationMinutes: 5,
    peakScore: 72,
    dominantPhase: "active_pump",
    leadingExchange: "binance",
    symbolNative: coin.replace("/", ""),
    instrumentType: "linear_perp",
    tradingViewUrl: "https://example.com/chart",
    confirmed: true,
    confirmedExchanges: ["binance"],
    eventCount: 3,
    ...options,
  };
}

describe("pump review types", () => {
  it("defines and validates exactly the review taxonomy", () => {
    expect(PUMP_CATEGORIES).toEqual([
      "sustained_move",
      "wick_spike",
      "volume_only",
      "market_move",
      "illiquid_noise",
      "unclear",
    ]);
    expect(ANNOTATION_CONFIDENCES).toEqual(["high", "medium", "low"]);
    expect(PUMP_CATEGORIES.every(isPumpCategory)).toBe(true);
    expect(ANNOTATION_CONFIDENCES.every(isAnnotationConfidence)).toBe(true);
    expect(isPumpCategory("pump")).toBe(false);
    expect(isAnnotationConfidence("certain")).toBe(false);
  });
});

describe("PumpReviewRepository", () => {
  let pumpRepo: PumpRepository;
  let reviewRepo: PumpReviewRepository;
  let eventIds: string[];

  beforeEach(async () => {
    const client = createMemoryDbClient();
    pumpRepo = new PumpRepository(client);
    await pumpRepo.applySchema();
    reviewRepo = new PumpReviewRepository(client);

    const { newPumps } = await pumpRepo.upsertPumpEpisodes([
      sampleEpisode("AAA/USDT", Date.parse("2026-07-01T10:00:00.000Z")),
      sampleEpisode("BBB/USDT", Date.parse("2026-07-02T10:00:00.000Z"), {
        leadingExchange: "bybit",
      }),
      sampleEpisode("CCC/USDT", Date.parse("2026-07-03T10:00:00.000Z")),
      sampleEpisode("DDD/USDT", Date.parse("2026-07-04T10:00:00.000Z")),
    ]);
    await pumpRepo.upsertPumpEpisodes([
      sampleEpisode("IGNORED/USDT", Date.parse("2026-07-05T10:00:00.000Z"), {
        type: "dump",
      }),
    ]);
    eventIds = newPumps.map((pump) => pump.index);
  });

  it("creates a human annotation separately from the pump event", async () => {
    const saved = await reviewRepo.upsertAnnotation(
      {
        eventId: eventIds[0]!,
        category: "sustained_move",
        confidence: "high",
        comment: "Held above the breakout.",
      },
      "2026-08-01T10:00:00.000Z",
    );

    expect(saved).toMatchObject({
      eventId: eventIds[0],
      source: "human",
      category: "sustained_move",
      confidence: "high",
      comment: "Held above the breakout.",
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
    });
    expect(saved.id).toEqual(expect.any(String));

    const event = await reviewRepo.getReviewEvent(eventIds[0]!);
    expect(event).toEqual({
      pump: expect.objectContaining({
        index: eventIds[0],
        coin: "AAA/USDT",
        classification: null,
      }),
      annotation: saved,
      status: "reviewed",
    });
    expect(await pumpRepo.getClassification(eventIds[0]!)).toBeNull();
  });

  it("updates one annotation per event and source while preserving identity and creation time", async () => {
    const created = await reviewRepo.upsertAnnotation(
      {
        eventId: eventIds[0]!,
        category: "wick_spike",
        confidence: "medium",
      },
      "2026-08-01T10:00:00.000Z",
    );
    const updated = await reviewRepo.upsertAnnotation(
      {
        eventId: eventIds[0]!,
        category: "volume_only",
        comment: "Volume increased without a breakout.",
      },
      "2026-08-02T11:00:00.000Z",
    );

    expect(updated).toEqual({
      ...created,
      category: "volume_only",
      confidence: null,
      comment: "Volume increased without a breakout.",
      updatedAt: "2026-08-02T11:00:00.000Z",
    });
  });

  it("keeps future AI annotations independent from the current human label", async () => {
    const human = await reviewRepo.upsertAnnotation(
      { eventId: eventIds[0]!, category: "market_move" },
      "2026-08-01T10:00:00.000Z",
    );
    const ai = await reviewRepo.upsertAnnotation(
      {
        eventId: eventIds[0]!,
        source: "ai",
        category: "volume_only",
        confidence: "low",
      },
      "2026-08-02T10:00:00.000Z",
    );

    expect(await reviewRepo.getAnnotation(eventIds[0]!)).toEqual(human);
    expect(await reviewRepo.getAnnotation(eventIds[0]!, "ai")).toEqual(ai);
    expect((await reviewRepo.getReviewEvent(eventIds[0]!))?.annotation).toEqual(human);
  });

  it("validates inputs and rejects missing or non-pump events", async () => {
    await expect(
      reviewRepo.upsertAnnotation({
        eventId: eventIds[0]!,
        category: "not-a-category" as PumpAnnotation["category"],
      }),
    ).rejects.toThrow("Invalid pump category");
    await expect(
      reviewRepo.upsertAnnotation({
        eventId: eventIds[0]!,
        category: "unclear",
        confidence: "certain" as PumpAnnotation["confidence"],
      }),
    ).rejects.toThrow("Invalid annotation confidence");
    await expect(
      reviewRepo.upsertAnnotation({ eventId: "missing", category: "unclear" }),
    ).rejects.toThrow("Pump event not found");

    const dumps = await pumpRepo.listStoredPumps({ episodeType: "dump" });
    await expect(
      reviewRepo.upsertAnnotation({
        eventId: dumps[0]!.index,
        category: "unclear",
      }),
    ).rejects.toThrow("Pump event not found");
    expect(await reviewRepo.getReviewEvent(dumps[0]!.index)).toBeNull();
  });

  it("filters, sorts, and paginates review events", async () => {
    await reviewRepo.upsertAnnotation({
      eventId: eventIds[0]!,
      category: "wick_spike",
    });
    await reviewRepo.upsertAnnotation({
      eventId: eventIds[1]!,
      category: "unclear",
    });

    const unreviewed = await reviewRepo.listReviewEvents({
      status: "unreviewed",
      sort: "detectedAtAsc",
      pageSize: 1,
    });
    expect(unreviewed).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(unreviewed.items.map((event) => event.pump.coin)).toEqual(["CCC/USDT"]);

    const unclear = await reviewRepo.listReviewEvents({
      status: "unclear",
      exchange: "BYBIT",
      symbol: "bbb",
    });
    expect(unclear.items.map((event) => event.status)).toEqual(["unclear"]);
    expect(unclear.items[0]!.pump.coin).toBe("BBB/USDT");

    const byCategory = await reviewRepo.listReviewEvents({ category: "wick_spike" });
    expect(byCategory.items.map((event) => event.pump.coin)).toEqual(["AAA/USDT"]);

    const dated = await reviewRepo.listReviewEvents({
      dateFromMs: Date.parse("2026-07-02T10:00:00.000Z"),
      dateToMs: Date.parse("2026-07-04T10:00:00.000Z"),
      sort: "symbolAsc",
    });
    expect(dated.items.map((event) => event.pump.coin)).toEqual([
      "BBB/USDT",
      "CCC/USDT",
    ]);
  });

  it("computes review statuses and category progress for pump events only", async () => {
    await reviewRepo.upsertAnnotation({
      eventId: eventIds[0]!,
      category: "sustained_move",
    });
    await reviewRepo.upsertAnnotation({
      eventId: eventIds[1]!,
      category: "unclear",
    });
    await reviewRepo.upsertAnnotation({
      eventId: eventIds[2]!,
      source: "ai",
      category: "volume_only",
    });

    expect(await reviewRepo.getReviewStats()).toEqual({
      total: 4,
      reviewed: 1,
      unreviewed: 2,
      unclear: 1,
      reviewedPercentage: 50,
      categories: {
        sustained_move: 1,
        wick_spike: 0,
        volume_only: 0,
        market_move: 0,
        illiquid_noise: 0,
        unclear: 1,
      },
    });
  });
});

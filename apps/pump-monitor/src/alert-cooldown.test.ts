import { describe, expect, it } from "vitest";
import type { StoredPump } from "@screener/db";
import {
  filterEpisodesSinceAlertCutoff,
  filterPumpsPastCooldown,
  PUMP_ALERT_COOLDOWN_MS,
} from "./alert-cooldown.js";

function storedPump(coin: string, startMs: number): StoredPump {
  return {
    index: `${coin}|${new Date(startMs).toISOString()}`,
    episodeType: "pump",
    coin,
    startMs,
    startUtc: new Date(startMs).toISOString(),
    endMs: startMs + 300_000,
    endUtc: new Date(startMs + 300_000).toISOString(),
    durationMinutes: 5,
    peakScore: 90,
    dominantPhase: "active_pump",
    leadingExchange: "binance",
    symbolNative: "BTCUSDT",
    instrumentType: "linear_perp",
    tradingViewUrl: "https://example.com",
    confirmed: true,
    confirmedExchanges: ["binance"],
    eventCount: 3,
    firstSeenAt: new Date(startMs).toISOString(),
    lastSeenAt: new Date(startMs).toISOString(),
    classification: null,
  };
}

describe("filterEpisodesSinceAlertCutoff", () => {
  const previousRunStartedMs = Date.parse("2026-08-12T23:55:13.579Z");

  it("keeps episodes that ended after the previous monitor cycle began", () => {
    const current = storedPump("CURRENT/USDT", previousRunStartedMs);

    const filtered = filterEpisodesSinceAlertCutoff(
      [current],
      previousRunStartedMs,
    );

    expect(filtered.alertable).toEqual([current]);
    expect(filtered.historical).toEqual([]);
  });

  it("suppresses VELODROME-style historical discoveries from a later scan", () => {
    const historical = storedPump(
      "VELODROME/USDT",
      Date.parse("2026-08-10T11:15:00.000Z"),
    );

    const filtered = filterEpisodesSinceAlertCutoff(
      [historical],
      previousRunStartedMs,
    );

    expect(filtered.alertable).toEqual([]);
    expect(filtered.historical).toEqual([historical]);
  });

  it("applies the same monitor watermark to pump and dump alerts", () => {
    const currentPump = storedPump("PUMP/USDT", previousRunStartedMs + 60_000);
    const historicalDump = {
      ...storedPump("DUMP/USDT", previousRunStartedMs - 60 * 60 * 1000),
      episodeType: "dump" as const,
    };

    const filtered = filterEpisodesSinceAlertCutoff(
      [currentPump, historicalDump],
      previousRunStartedMs,
    );

    expect(filtered.alertable).toEqual([currentPump]);
    expect(filtered.historical).toEqual([historicalDump]);
  });
});

describe("filterPumpsPastCooldown", () => {
  it("allows first alert on a coin", () => {
    const pump = storedPump("AIO/USDT", 1_000_000);
    const { alertable, suppressed } = filterPumpsPastCooldown([pump], new Map());
    expect(alertable).toEqual([pump]);
    expect(suppressed).toEqual([]);
  });

  it("suppresses a second alert on the same coin within the cooldown window", () => {
    const firstMs = Date.parse("2026-06-11T01:45:00.000Z");
    const secondMs = firstMs + 3.25 * 60 * 60 * 1000;
    const recent = new Map([["AIO/USDT", firstMs]]);
    const { alertable, suppressed } = filterPumpsPastCooldown(
      [storedPump("AIO/USDT", secondMs)],
      recent,
    );
    expect(alertable).toHaveLength(0);
    expect(suppressed).toHaveLength(1);
  });

  it("allows a second alert after the cooldown window", () => {
    const firstMs = Date.parse("2026-06-11T01:45:00.000Z");
    const secondMs = firstMs + PUMP_ALERT_COOLDOWN_MS + 60_000;
    const recent = new Map([["AIO/USDT", firstMs]]);
    const { alertable, suppressed } = filterPumpsPastCooldown(
      [storedPump("AIO/USDT", secondMs)],
      recent,
    );
    expect(alertable).toHaveLength(1);
    expect(suppressed).toHaveLength(0);
  });

  it("keeps only the earliest alert when multiple new pumps share a coin in one batch", () => {
    const firstMs = Date.parse("2026-06-11T01:00:00.000Z");
    const secondMs = firstMs + 60 * 60 * 1000;
    const { alertable, suppressed } = filterPumpsPastCooldown(
      [storedPump("AIO/USDT", secondMs), storedPump("AIO/USDT", firstMs)],
      new Map(),
    );
    expect(alertable.map((p) => p.startMs)).toEqual([firstMs]);
    expect(suppressed).toHaveLength(1);
  });
});

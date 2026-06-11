import { describe, expect, it } from "vitest";
import type { StoredPump } from "@screener/db";
import {
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

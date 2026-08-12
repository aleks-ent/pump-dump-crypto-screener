import { describe, expect, it } from "vitest";
import {
  resolveFetchIntervals,
  resolvePumpDays,
  resolvePumpMinDumpScore,
  resolvePumpMinScore,
  resolvePumpScanCache,
  resolvePumpUniverseRefreshDays,
  type AppConfig,
} from "./app-config.js";

describe("resolveFetchIntervals", () => {
  it("defaults to 1m and 5m when fetch.intervals is omitted", () => {
    expect(resolveFetchIntervals({})).toEqual(["1m", "5m"]);
  });

  it("accepts a single interval", () => {
    expect(resolveFetchIntervals({ fetch: { intervals: ["5m"] } })).toEqual(["5m"]);
  });

  it("deduplicates intervals", () => {
    expect(resolveFetchIntervals({ fetch: { intervals: ["5m", "5m", "1m"] } })).toEqual([
      "5m",
      "1m",
    ]);
  });

  it("rejects unknown intervals", () => {
    expect(() =>
      resolveFetchIntervals({ fetch: { intervals: ["15m"] } } as AppConfig),
    ).toThrow(/allowed: 1m, 5m/);
  });

  it("rejects an empty list", () => {
    expect(() => resolveFetchIntervals({ fetch: { intervals: [] } })).toThrow(
      /at least one/,
    );
  });
});

describe("resolvePumpDays", () => {
  it("defaults to 5 when pump.days is omitted", () => {
    expect(resolvePumpDays({})).toBe(5);
  });

  it("reads pump.days", () => {
    expect(resolvePumpDays({ pump: { days: 7 } })).toBe(7);
  });

  it("rejects invalid values", () => {
    expect(() => resolvePumpDays({ pump: { days: 0 } })).toThrow(/pump\.days/);
    expect(() => resolvePumpDays({ pump: { days: -1 } })).toThrow(/pump\.days/);
  });
});

describe("resolvePumpUniverseRefreshDays", () => {
  it("defaults to 4 when pump.universeRefreshDays is omitted", () => {
    expect(resolvePumpUniverseRefreshDays({})).toBe(4);
  });

  it("reads pump.universeRefreshDays", () => {
    expect(resolvePumpUniverseRefreshDays({ pump: { universeRefreshDays: 7 } })).toBe(7);
  });

  it("rejects invalid values", () => {
    expect(() =>
      resolvePumpUniverseRefreshDays({ pump: { universeRefreshDays: 0 } }),
    ).toThrow(/pump\.universeRefreshDays/);
    expect(() =>
      resolvePumpUniverseRefreshDays({ pump: { universeRefreshDays: Number.NaN } }),
    ).toThrow(/pump\.universeRefreshDays/);
  });
});

describe("resolvePumpMinScore", () => {
  it("defaults to 80 when pump config is omitted", () => {
    expect(resolvePumpMinScore({})).toBe(80);
  });

  it("reads pump.minScore", () => {
    expect(resolvePumpMinScore({ pump: { minScore: 75 } })).toBe(75);
  });

  it("falls back to deprecated pump.statsMinScore", () => {
    expect(resolvePumpMinScore({ pump: { statsMinScore: 70 } })).toBe(70);
  });

  it("prefers minScore over statsMinScore", () => {
    expect(resolvePumpMinScore({ pump: { minScore: 85, statsMinScore: 70 } })).toBe(85);
  });

  it("rejects invalid values", () => {
    expect(() => resolvePumpMinScore({ pump: { minScore: -1 } })).toThrow(/pump\.minScore/);
  });
});

describe("resolvePumpMinDumpScore", () => {
  it("defaults to 55 when pump config is omitted", () => {
    expect(resolvePumpMinDumpScore({})).toBe(55);
  });

  it("reads pump.minDumpScore", () => {
    expect(resolvePumpMinDumpScore({ pump: { minDumpScore: 60 } })).toBe(60);
  });
});
describe("resolvePumpScanCache", () => {
  it("defaults to true when pump.scanCache is omitted", () => {
    expect(resolvePumpScanCache({})).toBe(true);
  });

  it("reads pump.scanCache", () => {
    expect(resolvePumpScanCache({ pump: { scanCache: false } })).toBe(false);
    expect(resolvePumpScanCache({ pump: { scanCache: true } })).toBe(true);
  });

  it("rejects non-boolean values", () => {
    expect(() =>
      resolvePumpScanCache({ pump: { scanCache: "no" as unknown as boolean } }),
    ).toThrow(/pump\.scanCache/);
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXCHANGE_PRIORITY,
  pickLeadingExchange,
  type ExchangeCoverage,
} from "./coverage.js";

function cov(
  exchange: string,
  coveragePct: number,
  overrides: Partial<ExchangeCoverage> = {},
): ExchangeCoverage {
  return {
    exchange,
    fromMs: null,
    toMs: null,
    barsPresent: 0,
    barsExpected: 100,
    coveragePct,
    fullySatisfied: coveragePct >= 100,
    ...overrides,
  };
}

describe("pickLeadingExchange", () => {
  it("picks highest coverage percentage", () => {
    const { leader, ranked } = pickLeadingExchange([
      cov("bybit", 60),
      cov("binance", 90),
    ]);
    expect(leader).toBe("binance");
    expect(ranked[0]!.exchange).toBe("binance");
  });

  it("breaks ties by binance > bybit priority", () => {
    const { leader } = pickLeadingExchange(
      [cov("bybit", 100), cov("binance", 100)],
      DEFAULT_EXCHANGE_PRIORITY,
    );
    expect(leader).toBe("binance");
  });

  it("returns null leader when all coverages are zero", () => {
    const { leader } = pickLeadingExchange([cov("binance", 0), cov("bybit", 0)]);
    expect(leader).toBeNull();
  });

  it("returns null for empty input", () => {
    const { leader, ranked } = pickLeadingExchange([]);
    expect(leader).toBeNull();
    expect(ranked).toEqual([]);
  });

  it("ranks equal coverage by exchange priority", () => {
    const { ranked } = pickLeadingExchange([cov("bybit", 50), cov("binance", 50)]);
    expect(ranked.map((r) => r.exchange)).toEqual(["binance", "bybit"]);
  });
});

describe("DEFAULT_EXCHANGE_PRIORITY", () => {
  it("lists binance before bybit", () => {
    expect(DEFAULT_EXCHANGE_PRIORITY).toEqual(["binance", "bybit"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  isHighVolumeDistributionStall,
  MIN_DISTRIBUTION_STALL_DRAWDOWN,
  MIN_DISTRIBUTION_STALL_PRICE_DROP,
} from "./evaluate.js";

describe("isHighVolumeDistributionStall", () => {
  it("does not call SPCX-like consolidation near the high a distribution", () => {
    expect(
      isHighVolumeDistributionStall({
        volumeRatio: 66.15,
        priceChangeLast3: 0.0089,
        close: 148.98,
        recentHigh: 149,
      }),
    ).toBe(false);
  });

  it("requires both negative momentum and a material drawdown from the high", () => {
    expect(
      isHighVolumeDistributionStall({
        volumeRatio: 8,
        priceChangeLast3: -(MIN_DISTRIBUTION_STALL_PRICE_DROP + 0.001),
        close: 98,
        recentHigh: 100,
      }),
    ).toBe(true);

    expect(
      isHighVolumeDistributionStall({
        volumeRatio: 8,
        priceChangeLast3: 0,
        close: 98,
        recentHigh: 100,
      }),
    ).toBe(false);

    expect(
      isHighVolumeDistributionStall({
        volumeRatio: 8,
        priceChangeLast3: -(MIN_DISTRIBUTION_STALL_PRICE_DROP + 0.001),
        close: 100 * (1 - MIN_DISTRIBUTION_STALL_DRAWDOWN / 2),
        recentHigh: 100,
      }),
    ).toBe(false);
  });
});

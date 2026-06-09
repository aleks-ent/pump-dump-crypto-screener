import { describe, expect, it } from "vitest";
import { median, SlidingWindowMedian } from "./math.js";

describe("SlidingWindowMedian", () => {
  it("matches naive median for a sliding window", () => {
    const values = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5];
    const window = 4;
    const sliding = new SlidingWindowMedian(window);

    for (let i = 0; i < values.length; i++) {
      if (i >= window) {
        const slice = values.slice(i - window, i);
        expect(sliding.median()).toBe(median(slice));
      }
      sliding.push(values[i]!);
    }
  });

  it("returns null until the window is full", () => {
    const sliding = new SlidingWindowMedian(3);
    expect(sliding.median()).toBeNull();
    sliding.push(1);
    expect(sliding.median()).toBeNull();
    sliding.push(2);
    expect(sliding.median()).toBeNull();
    sliding.push(3);
    expect(sliding.median()).toBe(2);
  });
});

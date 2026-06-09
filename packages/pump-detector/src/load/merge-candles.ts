import type { Candle, SeriesQualityFlags } from "../types.js";

export function mergeCandleSets(
  sets: { candles: Candle[]; label: string }[],
  intervalMs: number,
): { candles: Candle[]; quality: SeriesQualityFlags } {
  const byTime = new Map<number, { candle: Candle; label: string }>();
  let duplicateBars = 0;

  for (const { candles, label } of sets) {
    for (const candle of candles) {
      const prev = byTime.get(candle.openTimeMs);
      if (prev) {
        duplicateBars += 1;
        if (label === "ndjson") {
          byTime.set(candle.openTimeMs, { candle, label });
        }
        continue;
      }
      byTime.set(candle.openTimeMs, { candle, label });
    }
  }

  const candles = [...byTime.values()]
    .map((e) => e.candle)
    .sort((a, b) => a.openTimeMs - b.openTimeMs);

  let gaps = 0;
  for (let i = 1; i < candles.length; i++) {
    const delta = candles[i]!.openTimeMs - candles[i - 1]!.openTimeMs;
    if (delta > intervalMs * 1.5) gaps += 1;
  }

  const reasons: string[] = [];
  if (candles.length === 0) reasons.push("No candles in window");
  if (duplicateBars > 0) reasons.push(`${duplicateBars} duplicate bars merged`);
  if (gaps > 0) reasons.push(`${gaps} timestamp gaps`);

  return {
    candles,
    quality: {
      badData: candles.length === 0 || gaps > candles.length * 0.1,
      duplicateBars,
      gaps,
      reasons,
    },
  };
}

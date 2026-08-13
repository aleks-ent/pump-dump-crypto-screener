import { median } from "../metrics/math.js";
import type { ComputedSeries } from "../metrics/series-state.js";

/** Two hours of 5m candles immediately before the first impulse candle. */
export const PRE_PUMP_CALM_WINDOW_BARS = 24;

/** Maximum high-to-low envelope across the two-hour window. */
export const MAX_PRE_PUMP_RANGE_PCT = 3;

/** Maximum sum of absolute close-to-close moves across the window. */
export const MAX_PRE_PUMP_PATH_PCT = 6;

/** Typical pre-pump candle must not be larger than the instrument's 24h baseline. */
export const MAX_PRE_PUMP_MEDIAN_RANGE_RATIO = 1.25;

/** Reject a calm window containing even one candle at activation-level volatility. */
export const MAX_PRE_PUMP_CANDLE_RANGE_RATIO = 2;

/** Typical pre-pump volume must remain close to or below the instrument's 24h baseline. */
export const MAX_PRE_PUMP_MEDIAN_VOLUME_RATIO = 1.2;

export interface PrePumpCalmSnapshot {
  calm: boolean;
  rangePct: number | null;
  pathPct: number | null;
  medianRangeRatio: number | null;
  maxRangeRatio: number | null;
  medianVolumeRatio: number | null;
}

const UNAVAILABLE_PRE_PUMP_CALM: PrePumpCalmSnapshot = {
  calm: false,
  rangePct: null,
  pathPct: null,
  medianRangeRatio: null,
  maxRangeRatio: null,
  medianVolumeRatio: null,
};

/**
 * Measures the quiet "thin string" immediately before an impulse using only earlier bars.
 * The price envelope catches broad movement, while path length rejects tight-looking but
 * rapidly oscillating candles whose gains and losses cancel out.
 */
export function evaluatePrePumpCalm(
  series: ComputedSeries,
  impulseStartIndex: number,
): PrePumpCalmSnapshot {
  const start = impulseStartIndex - PRE_PUMP_CALM_WINDOW_BARS;
  if (start < 0) return UNAVAILABLE_PRE_PUMP_CALM;

  const candles = series.candles.slice(start, impulseStartIndex);
  if (candles.length !== PRE_PUMP_CALM_WINDOW_BARS) return UNAVAILABLE_PRE_PUMP_CALM;

  const rangeBaseline = series.rangeBaseline[impulseStartIndex];
  const volumeBaseline = series.volumeBaseline[impulseStartIndex];
  if (
    rangeBaseline == null ||
    rangeBaseline <= 0 ||
    volumeBaseline == null ||
    volumeBaseline <= 0
  ) {
    return UNAVAILABLE_PRE_PUMP_CALM;
  }

  let high = -Infinity;
  let low = Infinity;
  let path = 0;
  const ranges: number[] = [];
  const volumes: number[] = [];

  for (let offset = 0; offset < candles.length; offset++) {
    const candle = candles[offset]!;
    if (
      candle.open <= 0 ||
      candle.high <= 0 ||
      candle.low <= 0 ||
      candle.close <= 0 ||
      candle.volume <= 0
    ) {
      return UNAVAILABLE_PRE_PUMP_CALM;
    }

    high = Math.max(high, candle.high);
    low = Math.min(low, candle.low);
    ranges.push(series.rangePct[start + offset]!);
    volumes.push(candle.volume);

    if (offset > 0) {
      path += Math.abs(candle.close - candles[offset - 1]!.close);
    }
  }

  const medianRangePct = median(ranges);
  const medianVolume = median(volumes);
  const firstClose = candles[0]!.close;
  if (low <= 0 || firstClose <= 0 || medianRangePct == null || medianVolume == null) {
    return UNAVAILABLE_PRE_PUMP_CALM;
  }

  const rangePct = ((high - low) / low) * 100;
  const pathPct = (path / firstClose) * 100;
  const medianRangeRatio = medianRangePct / rangeBaseline;
  const maxRangeRatio = Math.max(...ranges) / rangeBaseline;
  const medianVolumeRatio = medianVolume / volumeBaseline;

  return {
    calm:
      rangePct <= MAX_PRE_PUMP_RANGE_PCT &&
      pathPct <= MAX_PRE_PUMP_PATH_PCT &&
      medianRangeRatio <= MAX_PRE_PUMP_MEDIAN_RANGE_RATIO &&
      maxRangeRatio < MAX_PRE_PUMP_CANDLE_RANGE_RATIO &&
      medianVolumeRatio <= MAX_PRE_PUMP_MEDIAN_VOLUME_RATIO,
    rangePct,
    pathPct,
    medianRangeRatio,
    maxRangeRatio,
    medianVolumeRatio,
  };
}

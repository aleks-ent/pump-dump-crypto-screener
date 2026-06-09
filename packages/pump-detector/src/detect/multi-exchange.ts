import { computeSeries, priceChange, type ComputedSeries } from "../metrics/series-state.js";
import type { Candle } from "../types.js";

const FIVE_MIN_MS = 300_000;
const PEER_TOLERANCE_MS = 3 * FIVE_MIN_MS;

export function findCandleIndexNear(
  candles: Candle[],
  targetMs: number,
  toleranceMs: number,
): number | null {
  let best: number | null = null;
  let bestDelta = Infinity;
  for (let i = 0; i < candles.length; i++) {
    const delta = Math.abs(candles[i]!.openTimeMs - targetMs);
    if (delta <= toleranceMs && delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}

export function listConfirmedExchangeNames(
  leaderSeries: ComputedSeries,
  leaderIndex: number,
  peerSeriesByExchange: Map<string, ComputedSeries>,
  leaderExchange: string,
): string[] {
  const leaderMove = priceChange(leaderSeries, leaderIndex, 6);
  const confirmed: string[] = [leaderExchange];
  if (leaderMove <= 0) return confirmed;

  const targetMs = leaderSeries.candles[leaderIndex]!.openTimeMs;

  for (const [exchange, peer] of peerSeriesByExchange) {
    if (exchange === leaderExchange) continue;
    const peerIdx = findCandleIndexNear(peer.candles, targetMs, PEER_TOLERANCE_MS);
    if (peerIdx == null || !peer.eligible[peerIdx]) continue;

    const peerMove = priceChange(peer, peerIdx, 6);
    const vr = peer.volumeRatio[peerIdx] ?? 0;
    if (peerMove >= 0.6 * leaderMove && vr >= 2 && peerMove > 0) {
      confirmed.push(exchange);
    }
  }

  return confirmed;
}

export function countConfirmedExchanges(
  leaderSeries: ComputedSeries,
  leaderIndex: number,
  peerSeriesByExchange: Map<string, ComputedSeries>,
  leaderExchange: string,
): number {
  return listConfirmedExchangeNames(
    leaderSeries,
    leaderIndex,
    peerSeriesByExchange,
    leaderExchange,
  ).length;
}

export function buildComputedSeriesMap(
  candlesByExchange: Map<string, Candle[]>,
): Map<string, ComputedSeries> {
  const out = new Map<string, ComputedSeries>();
  for (const [exchange, candles] of candlesByExchange) {
    if (candles.length > 0) {
      out.set(exchange, computeSeries(candles, "5m"));
    }
  }
  return out;
}

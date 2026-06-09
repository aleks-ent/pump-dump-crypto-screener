import { buildTradingViewChartUrl } from "./tradingview.js";
import type { PumpCandidate, PumpPhase } from "./types.js";

const BAR_MS = 300_000;
/** Max gap between 5m bars to still count as one episode (30 minutes). */
export const DEFAULT_EPISODE_GAP_MS = 30 * 60 * 1000;

const PUMP_PHASES = new Set<PumpPhase>([
  "activation",
  "active_pump",
  "late_pump",
  "spike",
]);

const DUMP_PHASES = new Set<PumpPhase>(["distribution_or_fade"]);

export type EpisodeType = "pump" | "dump";

export interface PumpEpisode {
  coin: string;
  type: EpisodeType;
  startMs: number;
  endMs: number;
  durationMinutes: number;
  peakScore: number;
  dominantPhase: PumpPhase;
  leadingExchange: string;
  symbolNative: string;
  instrumentType: string;
  tradingViewUrl: string;
  confirmed: boolean;
  confirmedExchanges: string[];
  eventCount: number;
}

export function phaseFamily(phase: PumpPhase): EpisodeType | null {
  if (PUMP_PHASES.has(phase)) return "pump";
  if (DUMP_PHASES.has(phase)) return "dump";
  return null;
}

function coinLabel(e: PumpCandidate): string {
  return `${e.baseAsset}/${e.quoteAsset}`;
}

function episodeEndMs(lastOpenMs: number): number {
  return lastOpenMs + BAR_MS;
}

function dominantPhase(events: PumpCandidate[]): PumpPhase {
  const counts = new Map<PumpPhase, number>();
  for (const e of events) {
    counts.set(e.phase, (counts.get(e.phase) ?? 0) + 1);
  }
  let best: PumpPhase = events[0]!.phase;
  let bestCount = 0;
  for (const [phase, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = phase;
    }
  }
  return best;
}

function buildEpisode(events: PumpCandidate[]): PumpEpisode {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const startMs = first.timestamp;
  const endMs = episodeEndMs(last.timestamp);
  const peak = sorted.reduce((m, e) => (e.score > m.score ? e : m), first);
  const confirmedSet = new Set<string>();
  for (const e of sorted) {
    for (const ex of e.confirmedExchanges) confirmedSet.add(ex);
  }

  const instrumentType = first.instrumentType ?? "linear_perp";

  return {
    coin: coinLabel(first),
    type: phaseFamily(first.phase)!,
    startMs,
    endMs,
    durationMinutes: Math.round((endMs - startMs) / 60_000),
    peakScore: peak.score,
    dominantPhase: dominantPhase(sorted),
    leadingExchange: first.leadingExchange,
    symbolNative: first.symbol,
    instrumentType,
    tradingViewUrl: buildTradingViewChartUrl({
      exchange: first.leadingExchange,
      symbolNative: first.symbol,
      instrumentType,
      timeframe: first.timeframe,
    }),
    confirmed: sorted.some((e) => e.confirmed),
    confirmedExchanges: [...confirmedSet].sort(),
    eventCount: sorted.length,
  };
}

export function groupEventsIntoEpisodes(
  events: PumpCandidate[],
  maxGapMs: number = DEFAULT_EPISODE_GAP_MS,
): PumpEpisode[] {
  const reportable = events
    .filter((e) => phaseFamily(e.phase) != null)
    .sort(
      (a, b) =>
        a.baseAsset.localeCompare(b.baseAsset) ||
        a.quoteAsset.localeCompare(b.quoteAsset) ||
        a.leadingExchange.localeCompare(b.leadingExchange) ||
        a.timestamp - b.timestamp,
    );

  const episodes: PumpEpisode[] = [];
  let bucket: PumpCandidate[] = [];

  const flush = (): void => {
    if (bucket.length > 0) {
      episodes.push(buildEpisode(bucket));
      bucket = [];
    }
  };

  for (const event of reportable) {
    const family = phaseFamily(event.phase)!;
    const prev = bucket[bucket.length - 1];

    if (!prev) {
      bucket.push(event);
      continue;
    }

    const sameCoin =
      prev.baseAsset === event.baseAsset &&
      prev.quoteAsset === event.quoteAsset &&
      prev.leadingExchange === event.leadingExchange;
    const sameFamily = phaseFamily(prev.phase) === family;
    const gap = event.timestamp - episodeEndMs(prev.timestamp);

    if (sameCoin && sameFamily && gap <= maxGapMs) {
      bucket.push(event);
    } else {
      flush();
      bucket.push(event);
    }
  }
  flush();

  return episodes.sort((a, b) => b.peakScore - a.peakScore || a.startMs - b.startMs);
}

export interface EpisodeStats {
  totalEpisodes: number;
  pumpEpisodes: number;
  dumpEpisodes: number;
  coinsWithPump: number;
  coinsWithDump: number;
  rawEventCount: number;
}

export function summarizeEpisodes(episodes: PumpEpisode[], rawEventCount: number): EpisodeStats {
  const pumpCoins = new Set<string>();
  const dumpCoins = new Set<string>();
  let pumpEpisodes = 0;
  let dumpEpisodes = 0;

  for (const ep of episodes) {
    if (ep.type === "pump") {
      pumpEpisodes += 1;
      pumpCoins.add(ep.coin);
    } else {
      dumpEpisodes += 1;
      dumpCoins.add(ep.coin);
    }
  }

  return {
    totalEpisodes: episodes.length,
    pumpEpisodes,
    dumpEpisodes,
    coinsWithPump: pumpCoins.size,
    coinsWithDump: dumpCoins.size,
    rawEventCount,
  };
}

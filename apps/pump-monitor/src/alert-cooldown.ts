import type { StoredPump } from "@screener/db";

/** Suppress repeat Telegram alerts on the same coin within this window. */
export const PUMP_ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/**
 * Only broadcast episodes that ended after the previous successful monitor
 * cycle began. Older discoveries are historical backfill and stay reviewable.
 */
export function filterEpisodesSinceAlertCutoff(
  episodes: StoredPump[],
  cutoffMs: number,
): { alertable: StoredPump[]; historical: StoredPump[] } {
  const alertable: StoredPump[] = [];
  const historical: StoredPump[] = [];

  for (const episode of episodes) {
    if (episode.endMs >= cutoffMs) alertable.push(episode);
    else historical.push(episode);
  }

  return { alertable, historical };
}

export function filterPumpsPastCooldown(
  newPumps: StoredPump[],
  recentPumpStartsByCoin: ReadonlyMap<string, number>,
  cooldownMs: number = PUMP_ALERT_COOLDOWN_MS,
): { alertable: StoredPump[]; suppressed: StoredPump[] } {
  const latestStartByCoin = new Map(recentPumpStartsByCoin);
  const alertable: StoredPump[] = [];
  const suppressed: StoredPump[] = [];

  const sorted = [...newPumps].sort((a, b) => a.startMs - b.startMs);
  for (const pump of sorted) {
    const previousStartMs = latestStartByCoin.get(pump.coin);
    if (
      previousStartMs != null &&
      pump.startMs - previousStartMs < cooldownMs
    ) {
      suppressed.push(pump);
      continue;
    }
    alertable.push(pump);
    latestStartByCoin.set(pump.coin, pump.startMs);
  }

  return { alertable, suppressed };
}

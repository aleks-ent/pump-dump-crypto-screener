import type { StoredPump } from "@screener/db";

/** Suppress repeat Telegram alerts on the same coin within this window. */
export const PUMP_ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;

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

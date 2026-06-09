const DAY_MS = 86_400_000;

/** UTC midnight at or before `ms`. */
export function utcDayStartMs(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function parseIsoUtc(value: string): Date {
  const text = value.replace("Z", "+00:00");
  const dt = new Date(text);
  if (Number.isNaN(dt.getTime())) {
    throw new Error(`Invalid ISO UTC date: ${value}`);
  }
  return dt;
}

export function resolveWindow(
  start?: string | null,
  end?: string | null,
  cfg: Record<string, unknown> = {},
  defaultDays = 30,
): [number, number] {
  const now = Date.now();
  const defaultEnd = now;
  const defaultStart = now - defaultDays * 24 * 60 * 60 * 1000;
  const startDt = start
    ? parseIsoUtc(start)
    : cfg.start
      ? parseIsoUtc(String(cfg.start))
      : new Date(defaultStart);
  const endDt = end
    ? parseIsoUtc(end)
    : cfg.end
      ? parseIsoUtc(String(cfg.end))
      : new Date(defaultEnd);
  return [startDt.getTime(), endDt.getTime()];
}

export interface WindowArgs {
  start?: string | null;
  end?: string | null;
}

export function resolveWindowFromArgs(
  args: WindowArgs,
  cfg: Record<string, unknown>,
): [number, number] {
  return resolveWindow(args.start, args.end, cfg);
}

/**
 * Calendar lookback for archive pulls when start/end are omitted: N−1 full UTC
 * calendar days are satisfied via bulk archives; the partial current UTC day
 * through `now` is satisfied via REST fallback.
 */
export function resolveArchiveWindow(
  start?: string | null,
  end?: string | null,
  cfg: Record<string, unknown> = {},
  defaultDays = 30,
): [number, number] {
  const explicit =
    start != null ||
    end != null ||
    (cfg.start != null && cfg.start !== "") ||
    (cfg.end != null && cfg.end !== "");
  if (explicit) {
    return resolveWindow(start, end, cfg, defaultDays);
  }
  const now = Date.now();
  const todayStart = utcDayStartMs(now);
  const archiveDays = Math.max(0, defaultDays - 1);
  return [todayStart - archiveDays * DAY_MS, now];
}

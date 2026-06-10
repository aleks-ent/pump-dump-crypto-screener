import type { HttpClient } from "@screener/core";
import { utcDayStartMs } from "@screener/core";
import type { ExchangeAdapter } from "@screener/exchanges";
import { isFallbackSeriesOnDisk } from "@screener/storage";
import { runFallbackRange } from "./runner.js";

export type TailRefreshStatus = "fresh" | "refreshed" | "stale" | "skipped";

export interface TailRefreshResult {
  key: string;
  status: TailRefreshStatus;
  fallbackRows: number;
  error?: string;
}

export interface TailRefreshOptions {
  fallbackDir: string;
  adapter: ExchangeAdapter;
  client: HttpClient;
  allowFallback?: boolean;
  onFallbackFailed?: (info: {
    instrument: { symbolNative: string; exchange: string };
    interval: string;
    reason: string;
  }) => void;
}

/** UTC partial day [tailStart, endMs) — the slice monitor scans need fresh every run. */
export function tailWindowMs(endMs: number): [number, number] | null {
  const tailStart = utcDayStartMs(endMs);
  if (tailStart >= endMs) return null;
  return [tailStart, endMs];
}

export function isTailFreshOnDisk(
  fallbackDir: string,
  inst: Parameters<typeof isFallbackSeriesOnDisk>[1],
  interval: string,
  endMs: number,
): boolean {
  const window = tailWindowMs(endMs);
  if (!window) return true;
  const [tailStart, tailEnd] = window;
  return isFallbackSeriesOnDisk(fallbackDir, inst, interval, tailStart, tailEnd);
}

export async function refreshSeriesTail(
  inst: Parameters<typeof isFallbackSeriesOnDisk>[1],
  interval: string,
  endMs: number,
  opts: TailRefreshOptions,
): Promise<TailRefreshResult> {
  const key = `${inst.exchange}|${inst.instrumentType}|${inst.symbolNative}|${interval}`;
  const allowFallback = opts.allowFallback ?? true;

  const window = tailWindowMs(endMs);
  if (!window || !allowFallback) {
    return { key, status: "skipped", fallbackRows: 0 };
  }

  const [tailStart, tailEnd] = window;

  if (isFallbackSeriesOnDisk(opts.fallbackDir, inst, interval, tailStart, tailEnd)) {
    return { key, status: "fresh", fallbackRows: 0 };
  }

  try {
    const fallbackRows = await runFallbackRange(
      opts.adapter,
      opts.client,
      inst,
      interval,
      tailStart,
      tailEnd,
      opts.fallbackDir,
      {},
      false,
    );
    const ok = isFallbackSeriesOnDisk(opts.fallbackDir, inst, interval, tailStart, tailEnd);
    return {
      key,
      status: ok ? "refreshed" : "stale",
      fallbackRows,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    opts.onFallbackFailed?.({
      instrument: { symbolNative: inst.symbolNative, exchange: inst.exchange },
      interval,
      reason,
    });
    return { key, status: "stale", fallbackRows: 0, error: reason };
  }
}

import { pathToFileURL } from "node:url";
import { resolveRepoPath } from "./repo-path.js";

export type FetchInterval = "1m" | "5m";

const DEFAULT_FETCH_INTERVALS: FetchInterval[] = ["1m", "5m"];

const DEFAULT_PUMP_MIN_SCORE = 80;
const DEFAULT_PUMP_MIN_DUMP_SCORE = 55;

export interface AppConfig {
  fetch?: {
    intervals?: string[];
  };
  pump?: {
    /** Lookback calendar days for fetch:all + scan (default 5). */
    days?: number;
    /** Rebuild the listed-symbol universe after this many days (default 4). */
    universeRefreshDays?: number;
    minScore?: number;
    /** Minimum score for distribution_or_fade (dump) alerts (default 55). */
    minDumpScore?: number;
    /** Per-coin scan result cache (reads + incremental tail rescans). Default true. */
    scanCache?: boolean;
    /** @deprecated use minScore */
    statsMinScore?: number;
  };
}

export async function loadAppConfig(configPath?: string): Promise<AppConfig> {
  const path = resolveRepoPath(configPath ?? "config.js");
  const mod = await import(pathToFileURL(path).href);
  return (mod.default ?? mod) as AppConfig;
}

export function resolveFetchIntervals(cfg: AppConfig): FetchInterval[] {
  const raw = cfg.fetch?.intervals ?? DEFAULT_FETCH_INTERVALS;
  const intervals: FetchInterval[] = [];
  for (const iv of raw) {
    if (iv !== "1m" && iv !== "5m") {
      throw new Error(`Invalid fetch interval "${iv}" in config.js — allowed: 1m, 5m`);
    }
    if (!intervals.includes(iv)) intervals.push(iv);
  }
  if (intervals.length === 0) {
    throw new Error("config.js fetch.intervals must include at least one of: 1m, 5m");
  }
  return intervals;
}

export async function loadFetchIntervals(configPath?: string): Promise<FetchInterval[]> {
  return resolveFetchIntervals(await loadAppConfig(configPath));
}

export function resolvePumpMinScore(cfg: AppConfig): number {
  const raw = cfg.pump?.minScore ?? cfg.pump?.statsMinScore ?? DEFAULT_PUMP_MIN_SCORE;
  const minScore = Number(raw);
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
    throw new Error(
      `Invalid pump.minScore in config.js — must be a number between 0 and 100 (got ${String(raw)})`,
    );
  }
  return minScore;
}

export async function loadPumpMinScore(configPath?: string): Promise<number> {
  return resolvePumpMinScore(await loadAppConfig(configPath));
}

export function resolvePumpMinDumpScore(cfg: AppConfig): number {
  const raw = cfg.pump?.minDumpScore ?? DEFAULT_PUMP_MIN_DUMP_SCORE;
  const minDumpScore = Number(raw);
  if (!Number.isFinite(minDumpScore) || minDumpScore < 0 || minDumpScore > 100) {
    throw new Error(
      `Invalid pump.minDumpScore in config.js — must be a number between 0 and 100 (got ${String(raw)})`,
    );
  }
  return minDumpScore;
}

export async function loadPumpMinDumpScore(configPath?: string): Promise<number> {
  return resolvePumpMinDumpScore(await loadAppConfig(configPath));
}

const DEFAULT_PUMP_DAYS = 5;

export function resolvePumpDays(cfg: AppConfig): number {
  const raw = cfg.pump?.days ?? DEFAULT_PUMP_DAYS;
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 1) {
    throw new Error(
      `Invalid pump.days in config.js — must be a positive number (got ${String(raw)})`,
    );
  }
  return days;
}

export async function loadPumpDays(configPath?: string): Promise<number> {
  return resolvePumpDays(await loadAppConfig(configPath));
}

const DEFAULT_PUMP_UNIVERSE_REFRESH_DAYS = 4;

export function resolvePumpUniverseRefreshDays(cfg: AppConfig): number {
  const raw = cfg.pump?.universeRefreshDays ?? DEFAULT_PUMP_UNIVERSE_REFRESH_DAYS;
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 1) {
    throw new Error(
      `Invalid pump.universeRefreshDays in config.js — must be a positive number (got ${String(raw)})`,
    );
  }
  return days;
}

export async function loadPumpUniverseRefreshDays(configPath?: string): Promise<number> {
  return resolvePumpUniverseRefreshDays(await loadAppConfig(configPath));
}

const DEFAULT_PUMP_SCAN_CACHE = true;

export function resolvePumpScanCache(cfg: AppConfig): boolean {
  const raw = cfg.pump?.scanCache;
  if (raw === undefined) return DEFAULT_PUMP_SCAN_CACHE;
  if (typeof raw !== "boolean") {
    throw new Error(
      `Invalid pump.scanCache in config.js — must be a boolean (got ${String(raw)})`,
    );
  }
  return raw;
}

export async function loadPumpScanCacheEnabled(configPath?: string): Promise<boolean> {
  return resolvePumpScanCache(await loadAppConfig(configPath));
}

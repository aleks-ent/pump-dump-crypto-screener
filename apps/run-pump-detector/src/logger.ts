import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function createFileLogger(logPath: string): (msg: string) => void {
  mkdirSync(dirname(logPath), { recursive: true });
  return (msg: string) => {
    const line = `${new Date().toISOString()} ${msg}`;
    appendFileSync(logPath, `${line}\n`, "utf-8");
  };
}

export const WORKER_RESULT_PREFIX = "PUMP_WORKER_RESULT:";

export interface CoinWorkerResult {
  coinKey: string;
  status: "ok" | "skipped" | "error" | "cached" | "incremental";
  leaderExchange: string | null;
  exchanges: string[];
  candidateCount: number;
  coverages: Array<{
    exchange: string;
    coveragePct: number;
    fromMs: number | null;
    toMs: number | null;
    fullySatisfied: boolean;
  }>;
  error?: string;
}

export function formatWorkerResult(result: CoinWorkerResult): string {
  return `${WORKER_RESULT_PREFIX}${JSON.stringify(result)}`;
}

export function parseWorkerResult(line: string): CoinWorkerResult | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(WORKER_RESULT_PREFIX)) return null;
  try {
    return JSON.parse(trimmed.slice(WORKER_RESULT_PREFIX.length)) as CoinWorkerResult;
  } catch {
    return null;
  }
}

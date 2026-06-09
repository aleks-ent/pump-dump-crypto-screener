import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface LastPumpScanManifest {
  generated_at_utc: string;
  coins_scanned: number;
  coin_outputs?: number;
  worker_results?: number;
  failures: Array<{ coinKey: string; code: number | null; error?: string }>;
  total_episodes: number;
  episode_stats?: { pumpEpisodes: number; dumpEpisodes: number };
  output: string;
  run_dir: string;
}

export interface LastPumpScanFailure {
  failed_at_utc: string;
  error: string;
}

export function loadLastPumpScanManifest(dataDir: string): LastPumpScanManifest | null {
  const path = join(dataDir, "reports", "last_pump_scan.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as LastPumpScanManifest;
  } catch {
    return null;
  }
}

export function loadLastPumpScanFailure(dataDir: string): LastPumpScanFailure | null {
  const path = join(dataDir, "reports", "last_pump_scan_failed.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as LastPumpScanFailure;
  } catch {
    return null;
  }
}

export function assertScanCompleted(dataDir: string, manifest: LastPumpScanManifest | null): void {
  if (!manifest) {
    const failed = loadLastPumpScanFailure(dataDir);
    if (failed) {
      throw new Error(`Pump scan failed: ${failed.error}`);
    }
    throw new Error(
      "Pump scan did not write reports/last_pump_scan.json (scan exited before completion — pull latest run-pump-detector and retry)",
    );
  }
  const outputs = manifest.coin_outputs ?? manifest.worker_results ?? 0;
  if (outputs !== manifest.coins_scanned) {
    throw new Error(
      `Pump scan incomplete: ${outputs}/${manifest.coins_scanned} coin output(s); refusing to use pump_events.ndjson`,
    );
  }
  if (manifest.failures.length > 0) {
    throw new Error(
      `Pump scan reported ${manifest.failures.length} failure(s); see ${manifest.run_dir}/run_manifest.json`,
    );
  }
}

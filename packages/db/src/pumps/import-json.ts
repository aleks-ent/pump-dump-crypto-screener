import { readFileSync, unlinkSync } from "node:fs";
import { resolveRepoPath } from "@screener/core";
import { createDbClient } from "../client.js";
import { loadDatabaseConfig } from "../config.js";
import { PumpRepository } from "./repository.js";
import type { LegacyPumpIndexStore, StoredPump } from "./types.js";

const DEFAULT_LEGACY_PATH = "data/market_stats/reports/pump_index.json";

function legacyPumpToStored(
  pump: LegacyPumpIndexStore["pumps"][string],
): StoredPump {
  return {
    ...pump,
    classification: null,
  };
}

export async function importLegacyPumpIndex(opts?: {
  jsonPath?: string;
  deleteAfterImport?: boolean;
}): Promise<number> {
  const jsonPath = resolveRepoPath(opts?.jsonPath ?? DEFAULT_LEGACY_PATH);
  const deleteAfterImport = opts?.deleteAfterImport ?? true;

  let raw: string;
  try {
    raw = readFileSync(jsonPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`Legacy pump index not found (${jsonPath}); nothing to import.`);
      return 0;
    }
    throw err;
  }

  const parsed = JSON.parse(raw) as LegacyPumpIndexStore;
  if (parsed.version !== 1 || typeof parsed.pumps !== "object") {
    throw new Error("Unsupported legacy pump index format");
  }

  const config = await loadDatabaseConfig();
  const client = createDbClient(config);
  const repo = new PumpRepository(client);
  await repo.applySchema();

  const pumps = Object.values(parsed.pumps).map(legacyPumpToStored);
  for (const pump of pumps) {
    await repo.upsertStoredPump(pump);
  }

  if (deleteAfterImport) {
    unlinkSync(jsonPath);
  }

  console.error(`Imported ${pumps.length} pump(s) from ${jsonPath}`);
  if (deleteAfterImport) {
    console.error(`Deleted legacy file: ${jsonPath}`);
  }

  return pumps.length;
}

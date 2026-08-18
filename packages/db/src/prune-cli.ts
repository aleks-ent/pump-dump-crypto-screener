#!/usr/bin/env node
import { createDbClient } from "./client.js";
import { loadDatabaseConfig } from "./config.js";
import { applySchema } from "./pumps/repository.js";
import {
  inspectPumpRetention,
  parsePumpRetentionDays,
  prunePumpsBefore,
  pumpRetentionCutoffMs,
  type PumpRetentionResult,
} from "./pumps/retention.js";

function usage(): string {
  return `Usage: pnpm db:prune-pumps -- [--apply]

Prune database pump events older than PUMP_RETAIN_DAYS (default: 365).
The command is a dry run unless --apply is provided.`;
}

function printResult(label: string, result: PumpRetentionResult): void {
  console.log(`${label}:`);
  console.log(`  Cutoff:            ${result.cutoffUtc}`);
  console.log(`  Pumps:             ${result.pumps}`);
  console.log(`  Annotations:       ${result.annotations}`);
  console.log(`  Telegram votes:    ${result.telegramVotes}`);
  console.log(`  Telegram messages: ${result.telegramMessages}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const unknown = args.filter((arg) => arg !== "--apply" && arg !== "--help");
  if (unknown.length > 0) {
    throw new Error(`Unknown option: ${unknown[0]}\n\n${usage()}`);
  }
  if (args.includes("--help")) {
    console.log(usage());
    return;
  }

  const retentionDays = parsePumpRetentionDays(process.env.PUMP_RETAIN_DAYS);
  const cutoffMs = pumpRetentionCutoffMs(retentionDays);
  const client = createDbClient(await loadDatabaseConfig());

  try {
    await applySchema(client);
    const preview = await inspectPumpRetention(client, cutoffMs);
    printResult(`Matched rows (keeping ${retentionDays} days)`, preview);

    if (!args.includes("--apply")) {
      console.log("\nDry run. Re-run with --apply to delete these rows.");
      return;
    }
    if (preview.pumps === 0) {
      console.log("\nNothing to prune.");
      return;
    }

    const deleted = await prunePumpsBefore(client, cutoffMs);
    printResult("\nDeleted rows", deleted);
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

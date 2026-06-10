#!/usr/bin/env node
import { Command } from "commander";
import { resolveRepoPath } from "@screener/core";
import { migrateLegacySharedNdjson } from "@screener/storage";

async function main(): Promise<void> {
  const program = new Command();
  program
    .description("Split legacy shared api_fallback day NDJSON files into per-symbol files")
    .option("--output <dir>", "Market data root (default: data/market_stats)", "data/market_stats")
    .option("--dry-run", "Count files only; do not write or rename");

  program.parse(process.argv.slice(2).filter((a) => a !== "--"), { from: "user" });
  const opts = program.opts<{ output: string; dryRun?: boolean }>();
  const fallbackDir = `${resolveRepoPath(opts.output)}/api_fallback`;

  const result = await migrateLegacySharedNdjson(fallbackDir, { dryRun: opts.dryRun });
  console.log(JSON.stringify({ fallbackDir, dry_run: opts.dryRun === true, ...result }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import {
  createDbClient,
  loadDatabaseConfig,
  MonitorRunRepository,
  PumpRepository,
} from "@screener/db";
import {
  defaultWorkerConcurrency,
  findRepoRoot,
  loadPumpDays,
  loadPumpMinScore,
  loadPumpScanCacheEnabled,
  resolveRepoPath,
} from "@screener/core";
import {
  groupEventsIntoEpisodes,
  summarizeEpisodes,
  type PumpCandidate,
} from "@screener/pump-detector";
import { runCommand } from "./run-step.js";
import { assertScanCompleted, loadLastPumpScanManifest } from "./scan-validation.js";
import { loadTelegramConfig, sendPumpAlert } from "./telegram.js";

function loadPumpCandidates(path: string): PumpCandidate[] {
  const content = readFileSync(path, "utf-8");
  const events: PumpCandidate[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    events.push(JSON.parse(line) as PumpCandidate);
  }
  return events;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("pump-monitor")
    .description(
      "Fetch recent market data, scan for pumps/dumps, persist pumps to screener DB, and alert via Telegram",
    )
    .option("--no-telegram", "Persist pumps but skip Telegram notification")
    .option("--cache-dir <path>", "Per-coin scan result cache directory");

  program.parse(process.argv.slice(2).filter((a) => a !== "--"), { from: "user" });
  const opts = program.opts<{
    noTelegram?: boolean;
    cacheDir?: string;
  }>();

  const repoRoot = findRepoRoot();
  const dataDir = resolveRepoPath("data/market_stats", repoRoot);
  const eventsPath = join(dataDir, "reports", "pump_events.ndjson");
  const days = await loadPumpDays();
  const minScore = await loadPumpMinScore();
  const scanCacheEnabled = await loadPumpScanCacheEnabled();
  const useScanCache = scanCacheEnabled;

  const dbConfig = await loadDatabaseConfig();
  const client = createDbClient(dbConfig);
  const pumpRepo = new PumpRepository(client);
  const runRepo = new MonitorRunRepository(client);
  await pumpRepo.applySchema();

  const runId = await runRepo.startRun(new Date().toISOString());
  let newPumpsCount: number | null = null;

  try {
    await runMonitorPipeline({
      days,
      repoRoot,
      dataDir,
      eventsPath,
      minScore,
      useScanCache,
      opts,
      pumpRepo,
      onNewPumpsCount: (count) => {
        newPumpsCount = count;
      },
    });
  } finally {
    await runRepo.finishRun(runId, new Date().toISOString(), newPumpsCount);
    client.close();
  }
}

async function runMonitorPipeline(args: {
  days: number;
  repoRoot: string;
  dataDir: string;
  eventsPath: string;
  minScore: number;
  useScanCache: boolean;
  opts: {
    noTelegram?: boolean;
    cacheDir?: string;
  };
  pumpRepo: PumpRepository;
  onNewPumpsCount: (count: number) => void;
}): Promise<void> {
  const { days, repoRoot, dataDir, eventsPath, minScore, useScanCache, opts, pumpRepo, onNewPumpsCount } =
    args;

  console.error(`Pump monitor: ${days}-day window (config.js pump.days)`);
  console.error(`Min score: ${minScore} (config.js pump.minScore)`);
  console.error(`Scan cache: ${useScanCache ? "enabled" : "disabled (config.js pump.scanCache)"}`);
  console.error(`Data dir: ${dataDir}`);
  console.error(
    `Scan worker threads: ${defaultWorkerConcurrency()} (auto-detected CPU cores)`,
  );

  console.error("\n=== Step 1/3: fetch latest market data ===");
  const fetchCode = await runCommand(
    "pnpm",
    ["fetch:all", "--", String(days)],
    repoRoot,
  );
  if (fetchCode !== 0) {
    throw new Error(`fetch:all exited with code ${fetchCode}`);
  }

  console.error("\n=== Step 2/3: pump/dump scan ===");
  const scanArgs = [
    "scan:pumps",
    "--",
    "--days",
    String(days),
    "--min-score",
    String(minScore),
    "--data-dir",
    dataDir,
    "--output",
    eventsPath,
  ];
  if (opts.cacheDir) {
    scanArgs.push("--cache-dir", opts.cacheDir);
  }
  const scanCode = await runCommand("pnpm", scanArgs, repoRoot);
  if (scanCode !== 0) {
    throw new Error(`scan:pumps exited with code ${scanCode}`);
  }
  assertScanCompleted(dataDir, loadLastPumpScanManifest(dataDir));

  console.error("\n=== Step 3/3: persist pumps and notify ===");
  const events = loadPumpCandidates(eventsPath).filter((e) => e.score >= minScore);
  const episodes = groupEventsIntoEpisodes(events);
  const stats = summarizeEpisodes(episodes, events.length);
  const pumpEpisodes = episodes.filter((ep) => ep.type === "pump");

  console.error(
    `Scan produced ${stats.pumpEpisodes} pump episode(s) and ${stats.dumpEpisodes} dump episode(s)`,
  );

  const existingCount = await pumpRepo.countPumps();
  const { newPumps } = await pumpRepo.upsertPumpEpisodes(pumpEpisodes);
  const totalCount = await pumpRepo.countPumps();
  onNewPumpsCount(newPumps.length);

  console.error(
    `Screener DB pumps: ${existingCount} existing → ${totalCount} total (${newPumps.length} new)`,
  );

  if (newPumps.length === 0) {
    console.error("No new pumps — Telegram not sent");
    return;
  }

  if (opts.noTelegram) {
    console.error(`Skipping Telegram (--no-telegram); ${newPumps.length} new pump(s) stored`);
    return;
  }

  const telegram = await loadTelegramConfig();
  if (!telegram) {
    console.error(
      "New pumps found but Telegram is not configured. Set telegramBotToken and telegramChatId in config.js.",
    );
    return;
  }

  const messageCount = await sendPumpAlert(telegram, newPumps);
  console.error(
    `Telegram alert sent for ${newPumps.length} new pump(s) (${messageCount} message${messageCount === 1 ? "" : "s"})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

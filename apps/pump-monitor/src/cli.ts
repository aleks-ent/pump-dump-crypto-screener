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
  loadPumpMinDumpScore,
  loadPumpScanCacheEnabled,
  resolveRepoPath,
} from "@screener/core";
import {
  groupEventsIntoEpisodes,
  summarizeEpisodes,
  candidateIsReportable,
  type PumpCandidate,
} from "@screener/pump-detector";
import { runCommand } from "./run-step.js";
import { assertScanCompleted, loadLastPumpScanManifest } from "./scan-validation.js";
import { loadTelegramConfig, sendEpisodeAlerts, TELEGRAM_ALERT_DETAIL_LIMIT } from "./telegram.js";
import { filterPumpsPastCooldown } from "./alert-cooldown.js";

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
      "Fetch recent market data, scan for pumps/dumps, persist episodes to screener DB, and alert via Telegram",
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
  const minDumpScore = await loadPumpMinDumpScore();
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
      minDumpScore,
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
  minDumpScore: number;
  useScanCache: boolean;
  opts: {
    noTelegram?: boolean;
    cacheDir?: string;
  };
  pumpRepo: PumpRepository;
  onNewPumpsCount: (count: number) => void;
}): Promise<void> {
  const { days, repoRoot, dataDir, eventsPath, minScore, minDumpScore, useScanCache, opts, pumpRepo, onNewPumpsCount } =
    args;

  console.error(`Pump monitor: ${days}-day window (config.js pump.days)`);
  console.error(`Min score: ${minScore} pumps / ${minDumpScore} dumps (config.js)`);
  console.error(`Scan cache: ${useScanCache ? "enabled" : "disabled (config.js pump.scanCache)"}`);
  console.error(`Data dir: ${dataDir}`);
  console.error(
    `Scan worker threads: ${defaultWorkerConcurrency()} (auto-detected CPU cores)`,
  );

  console.error("\n=== Step 1/3: refresh today's REST tails (live window) ===");
  const tailCode = await runCommand(
    "pnpm",
    ["fetch:tail", "--", String(days)],
    repoRoot,
  );
  if (tailCode !== 0) {
    console.error(
      "WARNING: fetch:tail reported stale series (rate limit or API errors); continuing with best on-disk data",
    );
  }

  console.error("\n=== Step 1b/3: fetch archives / fill gaps ===");
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
    "--min-dump-score",
    String(minDumpScore),
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

  console.error("\n=== Step 3/3: persist episodes and notify ===");
  const events = loadPumpCandidates(eventsPath).filter((e) =>
    candidateIsReportable(e, minScore, minDumpScore),
  );
  const episodes = groupEventsIntoEpisodes(events);
  const stats = summarizeEpisodes(episodes, events.length);

  console.error(
    `Scan produced ${stats.pumpEpisodes} pump episode(s) and ${stats.dumpEpisodes} dump episode(s) (after quality gates)`,
  );

  const existingCount = await pumpRepo.countPumps();
  const minNewStartMs =
    episodes.length > 0 ? Math.min(...episodes.map((e) => e.startMs)) : Date.now();
  const recentPumpStarts = await pumpRepo.listRecentPumpStartsByCoin(minNewStartMs);
  const { newPumps, newDumps } = await pumpRepo.upsertPumpEpisodes(episodes);
  const totalCount = await pumpRepo.countPumps();
  onNewPumpsCount(newPumps.length);

  console.error(
    `Screener DB episodes: ${existingCount} existing → ${totalCount} total (${newPumps.length} new pump(s), ${newDumps.length} new dump(s))`,
  );

  const { alertable: pumpsToAlert, suppressed: cooldownSuppressed } =
    filterPumpsPastCooldown(newPumps, recentPumpStarts);
  if (cooldownSuppressed.length > 0) {
    console.error(
      `Cooldown: suppressed ${cooldownSuppressed.length} pump alert(s) within 4h of a prior alert on the same coin`,
    );
  }

  if (pumpsToAlert.length === 0 && newDumps.length === 0) {
    console.error("No new pumps or dumps to alert — Telegram not sent");
    return;
  }

  if (opts.noTelegram) {
    console.error(
      `Skipping Telegram (--no-telegram); ${pumpsToAlert.length} pump(s) would alert, ${newDumps.length} new dump(s) stored`,
    );
    return;
  }

  const telegram = await loadTelegramConfig();
  if (!telegram) {
    console.error(
      "New episodes found but Telegram is not configured. Set telegramBotToken and telegramChatId in config.js.",
    );
    return;
  }

  const messageCount = await sendEpisodeAlerts(telegram, pumpsToAlert, newDumps);
  if (pumpsToAlert.length + newDumps.length > TELEGRAM_ALERT_DETAIL_LIMIT) {
    console.error(
      `Telegram summary sent (${pumpsToAlert.length} new pump(s), ${newDumps.length} new dump(s) — individual alerts skipped, limit ${TELEGRAM_ALERT_DETAIL_LIMIT})`,
    );
  } else {
    console.error(
      `Telegram alert sent for ${pumpsToAlert.length} new pump(s) and ${newDumps.length} new dump(s) (${messageCount} message${messageCount === 1 ? "" : "s"})`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import {
  createDbClient,
  loadDatabaseConfig,
  MonitorRunRepository,
  PumpRepository,
  TelegramEpisodeVotingRepository,
  TelegramSubscriberRepository,
} from "@screener/db";
import {
  defaultWorkerConcurrency,
  findRepoRoot,
  loadPumpDays,
  loadPumpMinScore,
  loadPumpMinDumpScore,
  loadPumpRequireCalmPrePump,
  loadPumpScanCacheEnabled,
  loadPumpUniverseRefreshDays,
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
import {
  cleanupUnavailableTelegramRecipient,
  ensureClassifierTelegramRecipient,
} from "./telegram-delivery.js";
import { loadTelegramConfig, sendEpisodeAlerts } from "./telegram.js";
import {
  resolveTelegramAlertChatIds,
} from "./telegram-subscribers.js";
import {
  filterEpisodesSinceAlertCutoff,
  filterPumpsPastCooldown,
} from "./alert-cooldown.js";

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
  const requireCalmPrePump = await loadPumpRequireCalmPrePump();
  const universeRefreshDays = await loadPumpUniverseRefreshDays();
  const useScanCache = scanCacheEnabled;

  const dbConfig = await loadDatabaseConfig();
  const client = createDbClient(dbConfig);
  const pumpRepo = new PumpRepository(client);
  const runRepo = new MonitorRunRepository(client);
  const subscriberRepo = new TelegramSubscriberRepository(client);
  const votingRepo = new TelegramEpisodeVotingRepository(client);
  await pumpRepo.applySchema();

  const runStartedAt = new Date();
  const previousSuccessfulRun = await runRepo.getLatestSuccessfulRun();
  const previousRunStartedMs = previousSuccessfulRun
    ? Date.parse(previousSuccessfulRun.startedAt)
    : Number.NaN;
  const alertCutoffMs = Number.isFinite(previousRunStartedMs)
    ? previousRunStartedMs
    : runStartedAt.getTime();
  const runId = await runRepo.startRun(runStartedAt.toISOString());
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
      requireCalmPrePump,
      universeRefreshDays,
      alertCutoffMs,
      opts,
      pumpRepo,
      subscriberRepo,
      votingRepo,
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
  requireCalmPrePump: boolean;
  universeRefreshDays: number;
  alertCutoffMs: number;
  opts: {
    noTelegram?: boolean;
    cacheDir?: string;
  };
  pumpRepo: PumpRepository;
  subscriberRepo: TelegramSubscriberRepository;
  votingRepo: TelegramEpisodeVotingRepository;
  onNewPumpsCount: (count: number) => void;
}): Promise<void> {
  const {
    days,
    repoRoot,
    dataDir,
    eventsPath,
    minScore,
    minDumpScore,
    useScanCache,
    requireCalmPrePump,
    universeRefreshDays,
    alertCutoffMs,
    opts,
    pumpRepo,
    subscriberRepo,
    votingRepo,
    onNewPumpsCount,
  } = args;

  console.error(`Pump monitor: ${days}-day window (config.js pump.days)`);
  console.error(`Min score: ${minScore} pumps / ${minDumpScore} dumps (config.js)`);
  console.error(`Scan cache: ${useScanCache ? "enabled" : "disabled (config.js pump.scanCache)"}`);
  console.error(
    `Calm pre-pump gate: ${requireCalmPrePump ? "enabled" : "disabled"} (config.js pump.requireCalmPrePump)`,
  );
  console.error(`Symbol universe refresh: every ${universeRefreshDays} day(s)`);
  console.error(
    `Telegram alert watermark: episodes ending at or after ${new Date(alertCutoffMs).toISOString()}`,
  );
  console.error(`Data dir: ${dataDir}`);
  console.error(
    `Scan worker threads: ${defaultWorkerConcurrency()} (auto-detected CPU cores)`,
  );

  console.error("\n=== Step 1/3: refresh today's REST tails (live window) ===");
  const tailCode = await runCommand(
    "pnpm",
    [
      "fetch:tail",
      "--",
      String(days),
      "--refresh-universe-days",
      String(universeRefreshDays),
    ],
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
    [
      "fetch:all",
      "--",
      String(days),
      "--refresh-universe-days",
      String(universeRefreshDays),
    ],
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

  const { alertable: currentPumps, historical: historicalPumps } =
    filterEpisodesSinceAlertCutoff(newPumps, alertCutoffMs);
  const { alertable: currentDumps, historical: historicalDumps } =
    filterEpisodesSinceAlertCutoff(newDumps, alertCutoffMs);
  if (historicalPumps.length > 0 || historicalDumps.length > 0) {
    console.error(
      `Watermark: suppressed Telegram alerts for ${historicalPumps.length} historical pump(s) and ${historicalDumps.length} historical dump(s) ending before ${new Date(alertCutoffMs).toISOString()}; episodes remain stored for review`,
    );
  }

  const { alertable: pumpsToAlert, suppressed: cooldownSuppressed } =
    filterPumpsPastCooldown(currentPumps, recentPumpStarts);
  if (cooldownSuppressed.length > 0) {
    console.error(
      `Cooldown: suppressed ${cooldownSuppressed.length} pump alert(s) within 4h of a prior alert on the same coin`,
    );
  }

  if (pumpsToAlert.length === 0 && currentDumps.length === 0) {
    console.error("No current new pumps or dumps to alert — Telegram not sent");
    return;
  }

  if (opts.noTelegram) {
    console.error(
      `Skipping Telegram (--no-telegram); ${pumpsToAlert.length} pump(s) would alert, ${currentDumps.length} dump(s) would alert`,
    );
    return;
  }

  const telegram = await loadTelegramConfig();
  if (!telegram) {
    console.error(
      "New episodes found but Telegram is not configured. Set telegramBotToken and classifierTelegramChatId in config.js.",
    );
    return;
  }

  await ensureClassifierTelegramRecipient(
    subscriberRepo,
    telegram.classifierChatId,
  );
  const recipientIds = resolveTelegramAlertChatIds(
    telegram.classifierChatId,
    await subscriberRepo.listChatIds(),
  );

  let deliveredChats = 0;
  let failedChats = 0;
  let messageCount = 0;
  for (const chatId of recipientIds) {
    try {
      const sentAlerts = await sendEpisodeAlerts(
        { ...telegram, chatId },
        pumpsToAlert,
        currentDumps,
        {
          votingButtons: true,
          onSent: async (alert) => {
            await votingRepo.recordMessage(
              alert.episodeId,
              alert.chatId,
              alert.messageId,
            );
          },
        },
      );
      messageCount += sentAlerts.length;
      deliveredChats += 1;
    } catch (error) {
      failedChats += 1;
      const cleanup = await cleanupUnavailableTelegramRecipient(
        subscriberRepo,
        chatId,
        error,
      );
      if (cleanup.permanent) {
        if (cleanup.cleanupError) {
          console.error(
            `Failed to mark Telegram chat ${chatId} unsubscribed: ${
              cleanup.cleanupError instanceof Error
                ? cleanup.cleanupError.message
                : String(cleanup.cleanupError)
            }`,
          );
        } else if (cleanup.unsubscribed) {
          console.error(
            `Marked permanently unavailable Telegram chat ${chatId} unsubscribed`,
          );
        } else {
          console.error(
            `Permanently unavailable Telegram chat ${chatId} was not an active subscriber`,
          );
        }
      }
      console.error(
        `Telegram alert failed for chat ${chatId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  console.error(
    `Telegram alerts sent to ${deliveredChats}/${recipientIds.length} recipient(s) for ${pumpsToAlert.length} new pump(s) and ${currentDumps.length} new dump(s) (${messageCount} message${messageCount === 1 ? "" : "s"}${failedChats > 0 ? `, ${failedChats} failed chat(s)` : ""})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

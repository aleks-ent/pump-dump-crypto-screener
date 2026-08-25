import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createDbClient,
  loadDatabaseConfig,
  MonitorRunRepository,
  PumpRepository,
  TelegramEpisodeVotingRepository,
  TelegramSubscriberRepository,
  type PumpClassification,
  type TelegramMessageKind,
} from "@screener/db";
import { findRepoRoot, resolveRepoPath } from "@screener/core";
import {
  buildClassificationKeyboard,
  parseClassificationCallback,
} from "./telegram-callback.js";
import {
  cleanupUnavailableTelegramRecipient,
  ensureClassifierTelegramRecipient,
} from "./telegram-delivery.js";
import {
  loadLegacyTelegramSubscriberIds,
  markLegacyTelegramSubscribersMigrated,
} from "./telegram-subscribers.js";
import {
  answerCallbackQuery,
  editMessageCaption,
  editMessageText,
  formatAboutMessage,
  formatMonitorRunsMessage,
  formatPumpStatsMessages,
  formatStartMessage,
  formatVotedEpisodeAlertMessage,
  buildCommandReplyKeyboard,
  fetchTelegramSubscriberData,
  normalizeTelegramChatId,
  sendTelegramMessage,
  type TelegramConfig,
  type TelegramRuntimeConfig,
} from "./telegram.js";

export interface PumpConfig {
  minScore: number;
  minDumpScore: number;
}

export interface PumpBotConfig {
  telegram: TelegramRuntimeConfig;
  pump: PumpConfig;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      message_id: number;
      photo?: unknown[];
      chat: { id: number };
    };
  };
}

export interface TelegramBotRepositories {
  pumpRepo: PumpRepository;
  subscriberRepo: TelegramSubscriberRepository;
  votingRepo: TelegramEpisodeVotingRepository;
}

function parseCommand(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const head = trimmed.split(/\s+/)[0] ?? "";
  return head.split("@")[0]!.toLowerCase();
}

export async function loadPumpBotConfig(): Promise<PumpBotConfig | null> {
  const mod = await import(pathToFileURL(resolveRepoPath("config.js")).href);
  const cfg = (mod.default ?? mod) as {
    telegramBotToken?: string;
    classifierTelegramChatId?: string | number;
    pump?: {
      minScore?: number;
      minDumpScore?: number;
      statsMinScore?: number;
    };
  };
  const botToken = cfg.telegramBotToken?.trim() ?? "";
  const classifierChatId = normalizeTelegramChatId(
    cfg.classifierTelegramChatId,
  );
  if (!botToken || !classifierChatId) return null;

  const pumpCfg = cfg.pump ?? {};
  const minScore = Number(pumpCfg.minScore ?? pumpCfg.statsMinScore ?? 80);
  const minDumpScore = Number(pumpCfg.minDumpScore ?? 55);
  return {
    telegram: { botToken, classifierChatId },
    pump: { minScore, minDumpScore },
  };
}

async function createMonitorRunRepository(): Promise<MonitorRunRepository> {
  const dbConfig = await loadDatabaseConfig();
  const client = createDbClient(dbConfig);
  const repo = new MonitorRunRepository(client);
  await new PumpRepository(client).applySchema();
  return repo;
}

async function withTelegramSubscriberRepository<T>(
  action: (repo: TelegramSubscriberRepository) => Promise<T>,
): Promise<T> {
  const dbConfig = await loadDatabaseConfig();
  const client = createDbClient(dbConfig);
  try {
    await new PumpRepository(client).applySchema();
    return await action(new TelegramSubscriberRepository(client));
  } finally {
    client.close();
  }
}

async function withTelegramBotRepositories<T>(
  action: (repos: TelegramBotRepositories) => Promise<T>,
): Promise<T> {
  const dbConfig = await loadDatabaseConfig();
  const client = createDbClient(dbConfig);
  try {
    await new PumpRepository(client).applySchema();
    return await action({
      pumpRepo: new PumpRepository(client),
      subscriberRepo: new TelegramSubscriberRepository(client),
      votingRepo: new TelegramEpisodeVotingRepository(client),
    });
  } finally {
    client.close();
  }
}

async function initializeTelegramSubscribers(
  baseDir: string,
  classifierChatId: string,
  log: (msg: string) => void,
): Promise<void> {
  const legacyChatIds = loadLegacyTelegramSubscriberIds(baseDir);
  const subscribedAt = new Date().toISOString();
  const { classifierAdded, migrated, activeSubscriberCount } =
    await withTelegramSubscriberRepository(async (repo) => {
      const classifierAdded = await ensureClassifierTelegramRecipient(
        repo,
        classifierChatId,
        subscribedAt,
      );
      let count = 0;
      for (const chatId of legacyChatIds) {
        if (await repo.subscribe(chatId, subscribedAt)) count += 1;
      }
      const activeSubscriberCount = await repo.countActive();
      return { classifierAdded, migrated: count, activeSubscriberCount };
    });
  if (legacyChatIds.length > 0) {
    markLegacyTelegramSubscribersMigrated(baseDir);
  }
  if (classifierAdded) {
    log(`Added classifier Telegram chat ${classifierChatId} to subscribers`);
  }
  if (migrated > 0) {
    log(`Migrated ${migrated} legacy Telegram subscriber(s) to the database`);
  }
  log(`Active Telegram subscriber count: ${activeSubscriberCount}`);
}

function offsetPath(baseDir: string): string {
  return join(baseDir, "reports", "telegram_bot_offset.json");
}

function loadUpdateOffset(baseDir: string): number {
  try {
    const raw = JSON.parse(readFileSync(offsetPath(baseDir), "utf-8")) as {
      offset?: number;
    };
    return Number.isInteger(raw.offset) ? raw.offset! : 0;
  } catch {
    return 0;
  }
}

function saveUpdateOffset(baseDir: string, offset: number): void {
  const path = offsetPath(baseDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ offset }, null, 2)}\n`, "utf-8");
}

async function fetchUpdates(
  config: TelegramRuntimeConfig,
  offset: number,
): Promise<TelegramUpdate[]> {
  const url = new URL(`https://api.telegram.org/bot${config.botToken}/getUpdates`);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("timeout", "30");
  url.searchParams.set("allowed_updates", JSON.stringify(["message", "callback_query"]));

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram getUpdates failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as { ok: boolean; result: TelegramUpdate[] };
  if (!payload.ok) throw new Error("Telegram getUpdates returned ok=false");
  return payload.result;
}

const STATS_EPISODES_LIMIT = 5;
export const TELEGRAM_START_RATE_LIMIT_MS = 60_000;

export class TelegramStartRateLimiter {
  private readonly acceptedAtByChatId = new Map<string, number>();

  constructor(
    private readonly windowMs = TELEGRAM_START_RATE_LIMIT_MS,
    private readonly now: () => number = Date.now,
  ) {}

  tryAcquire(chatId: string): boolean {
    const now = this.now();
    for (const [storedChatId, acceptedAt] of this.acceptedAtByChatId) {
      if (now - acceptedAt < this.windowMs) break;
      this.acceptedAtByChatId.delete(storedChatId);
    }

    if (this.acceptedAtByChatId.has(chatId)) return false;
    this.acceptedAtByChatId.set(chatId, now);
    return true;
  }
}

function telegramConfigForChat(
  config: PumpBotConfig,
  chatId: string,
): TelegramConfig {
  return { ...config.telegram, chatId };
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchSubscriberDataForStart(
  config: TelegramRuntimeConfig,
  chatId: string,
  capturedAt: string,
  log: (msg: string) => void,
): Promise<string | null> {
  try {
    return await fetchTelegramSubscriberData(config, chatId, capturedAt);
  } catch (error) {
    log(
      `Failed to fetch Telegram subscriber data for ${chatId}: ${formatUnknownError(error)}`,
    );
    return null;
  }
}

export type TelegramStartCommandResult =
  | "rate-limited"
  | "subscribed"
  | "already-subscribed";

export async function handleStartCommand(
  config: PumpBotConfig,
  chatId: string,
  log: (msg: string) => void,
  rateLimiter: TelegramStartRateLimiter,
  subscriberRepository?: TelegramSubscriberRepository,
): Promise<TelegramStartCommandResult> {
  if (!rateLimiter.tryAcquire(chatId)) {
    log(`Ignored rate-limited /start for ${chatId}`);
    return "rate-limited";
  }

  const subscribe = async (repo: TelegramSubscriberRepository) => {
    if (await repo.isSubscribed(chatId)) {
      return { added: false, activeSubscriberCount: null };
    }

    const subscribedAt = new Date().toISOString();
    const subscriberData = await fetchSubscriberDataForStart(
      config.telegram,
      chatId,
      subscribedAt,
      log,
    );
    const added = await repo.subscribe(chatId, subscribedAt, subscriberData);
    return {
      added,
      activeSubscriberCount: added ? await repo.countActive() : null,
    };
  };

  const { added, activeSubscriberCount } = subscriberRepository
    ? await subscribe(subscriberRepository)
    : await withTelegramSubscriberRepository(subscribe);
  await sendTelegramMessage(
    telegramConfigForChat(config, chatId),
    formatStartMessage(),
    { replyMarkup: buildCommandReplyKeyboard() },
  );
  log(
    `${added ? "Subscribed" : "Confirmed subscription for"} ${chatId} and sent command keyboard`,
  );
  if (activeSubscriberCount != null) {
    log(`Active Telegram subscriber count: ${activeSubscriberCount}`);
  }
  return added ? "subscribed" : "already-subscribed";
}

export async function handleStatsCommand(
  config: PumpBotConfig,
  chatId: string,
  repositories?: Pick<TelegramBotRepositories, "pumpRepo" | "subscriberRepo">,
): Promise<number> {
  const loadMessages = async ({
    pumpRepo,
    subscriberRepo,
  }: Pick<
    TelegramBotRepositories,
    "pumpRepo" | "subscriberRepo"
  >): Promise<string[]> => {
    const [pumps, activeSubscriberCount] = await Promise.all([
      pumpRepo.listStoredPumps({
        minScore: config.pump.minScore,
        limit: STATS_EPISODES_LIMIT,
        episodeType: "pump",
      }),
      subscriberRepo.countActive(),
    ]);
    return formatPumpStatsMessages(
      pumps,
      config.pump.minScore,
      STATS_EPISODES_LIMIT,
      activeSubscriberCount,
    );
  };
  const messages = repositories
    ? await loadMessages(repositories)
    : await withTelegramBotRepositories(loadMessages);

  for (const message of messages) {
    await sendTelegramMessage(telegramConfigForChat(config, chatId), message);
  }
  return messages.length;
}

const MONITOR_RUNS_LIMIT = 5;

export function isClassifierTelegramChat(
  classifierChatId: string,
  chatId: number | undefined,
): boolean {
  return chatId != null && String(chatId) === classifierChatId;
}

export async function handleRunsCommand(
  config: PumpBotConfig,
  chatId: string,
): Promise<void> {
  const repo = await createMonitorRunRepository();
  const runs = await repo.listRecentRuns(MONITOR_RUNS_LIMIT);
  const message = formatMonitorRunsMessage(runs, MONITOR_RUNS_LIMIT);
  await sendTelegramMessage(telegramConfigForChat(config, chatId), message);
}

export async function handleClassificationCallback(
  config: PumpBotConfig,
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>,
  log: (msg: string) => void,
  repositories?: TelegramBotRepositories,
): Promise<void> {
  const parsed = parseClassificationCallback(callbackQuery.data ?? "");
  if (!parsed) {
    await answerCallbackQuery(config.telegram, callbackQuery.id, "Unknown action");
    return;
  }

  const rawChatId = callbackQuery.message?.chat.id;
  if (rawChatId == null) {
    await answerCallbackQuery(
      config.telegram,
      callbackQuery.id,
      "Voting is not available for this message",
    );
    return;
  }

  const chatId = String(rawChatId);
  const handleVote = async ({
    pumpRepo,
    subscriberRepo,
    votingRepo,
  }: TelegramBotRepositories): Promise<void> => {
    const isClassifier = isClassifierTelegramChat(
      config.telegram.classifierChatId,
      rawChatId,
    );
    if (isClassifier) {
      await ensureClassifierTelegramRecipient(
        subscriberRepo,
        config.telegram.classifierChatId,
      );
    } else if (!(await subscriberRepo.isSubscribed(chatId))) {
      log(`Ignored vote callback from unsubscribed chat ${chatId}`);
      await answerCallbackQuery(
        config.telegram,
        callbackQuery.id,
        "Send /start before voting",
      );
      return;
    }

    const episode = await pumpRepo.getStoredPump(parsed.pumpId);
    if (!episode) {
      await answerCallbackQuery(
        config.telegram,
        callbackQuery.id,
        "Event was not found",
      );
      return;
    }

    await votingRepo.upsertVote(parsed.pumpId, chatId, parsed.classification);
    if (isClassifier) {
      await pumpRepo.setClassification(parsed.pumpId, parsed.classification);
    }

    const voteCounts = await votingRepo.countVotes(parsed.pumpId);
    const text = formatVotedEpisodeAlertMessage(episode, voteCounts);
    const replyMarkup = buildClassificationKeyboard(parsed.pumpId);
    const currentMessageKind: TelegramMessageKind = callbackQuery.message?.photo?.length
      ? "photo"
      : "text";
    const recordedMessages = await votingRepo.listMessages(parsed.pumpId);
    const targets = [...recordedMessages];
    const hasCurrentMessage = targets.some(
      (message) =>
        message.chatId === chatId &&
        message.messageId === callbackQuery.message?.message_id,
    );
    if (!hasCurrentMessage && callbackQuery.message) {
      await votingRepo.recordMessage(
        parsed.pumpId,
        chatId,
        callbackQuery.message.message_id,
        undefined,
        currentMessageKind,
      );
      targets.push({
        episodeId: parsed.pumpId,
        chatId,
        messageId: callbackQuery.message.message_id,
        messageKind: currentMessageKind,
        sentAt: new Date().toISOString(),
      });
    }

    for (const message of targets) {
      try {
        const editAlert = message.messageKind === "photo"
          ? editMessageCaption
          : editMessageText;
        await editAlert(
          config.telegram,
          message.chatId,
          message.messageId,
          text,
          { replyMarkup },
        );
      } catch (error) {
        if (isTelegramMessageNotModified(error)) continue;
        const cleanup = await cleanupUnavailableTelegramRecipient(
          subscriberRepo,
          message.chatId,
          error,
        );
        if (cleanup.permanent && cleanup.unsubscribed) {
          log(`Marked unavailable Telegram chat ${message.chatId} unsubscribed`);
        }
        log(
          `Failed to update vote stats in chat ${message.chatId}: ${formatUnknownError(error)}`,
        );
      }
    }

    await answerCallbackQuery(
      config.telegram,
      callbackQuery.id,
      labelAck(parsed.classification),
    );
    log(`Vote ${parsed.classification} saved for ${parsed.pumpId} by ${chatId}`);
  };

  if (repositories) {
    await handleVote(repositories);
  } else {
    await withTelegramBotRepositories(handleVote);
  }
}

function isTelegramMessageNotModified(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("message is not modified")
  );
}

function labelAck(classification: PumpClassification): string {
  switch (classification) {
    case "pump":
      return "Saved as Pump";
    case "dump":
      return "Saved as Dump";
    case "none":
      return "Saved as None";
  }
}

export async function runTelegramBot(
  config: PumpBotConfig,
  opts?: {
    log?: (msg: string) => void;
    migrateLegacySubscribers?: boolean;
  },
): Promise<never> {
  const log = opts?.log ?? ((msg: string) => console.error(msg));
  const repoRoot = findRepoRoot();
  const baseDir = resolveRepoPath("data/market_stats", repoRoot);
  let offset = loadUpdateOffset(baseDir);
  const startRateLimiter = new TelegramStartRateLimiter();

  log(
    `Public Telegram bot listening (/start, /stats, /runs, /about, /stop; event voting enabled for subscribers, admin chat ${config.telegram.classifierChatId})`,
  );
  if (opts?.migrateLegacySubscribers !== false) {
    await initializeTelegramSubscribers(
      baseDir,
      config.telegram.classifierChatId,
      log,
    );
  }

  for (;;) {
    const updates = await fetchUpdates(config.telegram, offset);
    for (const update of updates) {
      offset = update.update_id + 1;
      saveUpdateOffset(baseDir, offset);

      if (update.callback_query) {
        await handleClassificationCallback(config, update.callback_query, log);
        continue;
      }

      const message = update.message;
      if (!message?.text) continue;

      const chatId = String(message.chat.id);
      const command = parseCommand(message.text);
      const replyConfig = telegramConfigForChat(config, chatId);

      if (command === "/start") {
        await handleStartCommand(config, chatId, log, startRateLimiter);
      } else if (command === "/stats") {
        log(`Handling /stats for ${chatId}`);
        const count = await handleStatsCommand(config, chatId);
        log(
          `Sent /stats reply to ${chatId} (${count} message${count === 1 ? "" : "s"})`,
        );
      } else if (command === "/runs") {
        log(`Handling /runs for ${chatId}`);
        await handleRunsCommand(config, chatId);
        log(`Sent /runs reply to ${chatId}`);
      } else if (command === "/about") {
        log(`Handling /about for ${chatId}`);
        await sendTelegramMessage(replyConfig, formatAboutMessage(), {
          replyMarkup: buildCommandReplyKeyboard(),
        });
        log(`Sent /about reply to ${chatId}`);
      } else if (command === "/stop") {
        if (chatId === config.telegram.classifierChatId) {
          await sendTelegramMessage(
            replyConfig,
            "This is the classifier chat, so it always remains subscribed to automatic alerts.",
            { replyMarkup: buildCommandReplyKeyboard() },
          );
          log(`Kept classifier Telegram chat ${chatId} subscribed`);
          continue;
        }
        const unsubscribed = await withTelegramSubscriberRepository((repo) =>
          repo.unsubscribe(chatId),
        );
        await sendTelegramMessage(
          replyConfig,
          unsubscribed
            ? "You are unsubscribed from automatic alerts. You can still use /stats, /runs, and /about, or press /start to subscribe again."
            : "You are not subscribed to automatic alerts. Press /start to subscribe.",
          { replyMarkup: buildCommandReplyKeyboard() },
        );
        log(
          `${unsubscribed ? "Unsubscribed" : "Active subscription not found for"} ${chatId}`,
        );
      }
    }
  }
}

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createDbClient,
  loadDatabaseConfig,
  MonitorRunRepository,
  PumpRepository,
  type PumpClassification,
} from "@screener/db";
import { findRepoRoot, resolveRepoPath } from "@screener/core";
import { parseClassificationCallback } from "./telegram-callback.js";
import {
  addTelegramSubscriber,
  removeTelegramSubscriber,
} from "./telegram-subscribers.js";
import {
  answerCallbackQuery,
  editMessageText,
  formatClassifiedPumpMessage,
  formatMonitorRunsMessage,
  formatPumpStatsMessages,
  formatStartMessage,
  buildCommandReplyKeyboard,
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
      chat: { id: number };
    };
  };
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

async function createPumpRepository(): Promise<PumpRepository> {
  const dbConfig = await loadDatabaseConfig();
  const client = createDbClient(dbConfig);
  return new PumpRepository(client);
}

async function createMonitorRunRepository(): Promise<MonitorRunRepository> {
  const dbConfig = await loadDatabaseConfig();
  const client = createDbClient(dbConfig);
  const repo = new MonitorRunRepository(client);
  await new PumpRepository(client).applySchema();
  return repo;
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

function telegramConfigForChat(
  config: PumpBotConfig,
  chatId: string,
): TelegramConfig {
  return { ...config.telegram, chatId };
}

export async function handleStatsCommand(
  config: PumpBotConfig,
  chatId: string,
): Promise<number> {
  const repo = await createPumpRepository();
  const pumps = await repo.listStoredPumps({
    minScore: config.pump.minScore,
    limit: STATS_EPISODES_LIMIT,
    episodeType: "pump",
  });
  const messages = formatPumpStatsMessages(
    pumps,
    config.pump.minScore,
    STATS_EPISODES_LIMIT,
  );

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
): Promise<void> {
  const chatId = callbackQuery.message?.chat.id;
  if (!isClassifierTelegramChat(config.telegram.classifierChatId, chatId)) {
    log(`Ignored classification callback from chat ${chatId ?? "unknown"}`);
    await answerCallbackQuery(
      config.telegram,
      callbackQuery.id,
      "Classification is not available in this chat",
    );
    return;
  }

  const parsed = parseClassificationCallback(callbackQuery.data ?? "");
  if (!parsed) {
    await answerCallbackQuery(config.telegram, callbackQuery.id, "Unknown action");
    return;
  }

  const repo = await createPumpRepository();
  await repo.setClassification(parsed.pumpId, parsed.classification);

  const pumps = await repo.listStoredPumps();
  const pump = pumps.find((p) => p.index === parsed.pumpId);
  if (pump && callbackQuery.message) {
    const text = formatClassifiedPumpMessage(pump, parsed.classification);
    await editMessageText(
      config.telegram,
      String(chatId),
      callbackQuery.message.message_id,
      text,
    );
  }

  await answerCallbackQuery(
    config.telegram,
    callbackQuery.id,
    labelAck(parsed.classification),
  );
  log(`Classification ${parsed.classification} saved for ${parsed.pumpId}`);
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
  opts?: { log?: (msg: string) => void },
): Promise<never> {
  const log = opts?.log ?? ((msg: string) => console.error(msg));
  const repoRoot = findRepoRoot();
  const baseDir = resolveRepoPath("data/market_stats", repoRoot);
  let offset = loadUpdateOffset(baseDir);

  log(
    `Public Telegram bot listening (/start, /stats, /runs, /stop; classification restricted to chat ${config.telegram.classifierChatId})`,
  );

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
        const added = addTelegramSubscriber(baseDir, chatId);
        await sendTelegramMessage(
          replyConfig,
          formatStartMessage(),
          { replyMarkup: buildCommandReplyKeyboard() },
        );
        log(
          `${added ? "Subscribed" : "Confirmed subscription for"} ${chatId} and sent command keyboard`,
        );
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
      } else if (command === "/stop") {
        const removed = removeTelegramSubscriber(baseDir, chatId);
        await sendTelegramMessage(
          replyConfig,
          removed
            ? "You are unsubscribed from automatic alerts. You can still use /stats and /runs, or press /start to subscribe again."
            : "You are not subscribed to automatic alerts. Press /start to subscribe.",
          { replyMarkup: buildCommandReplyKeyboard() },
        );
        log(`${removed ? "Unsubscribed" : "Subscription not found for"} ${chatId}`);
      }
    }
  }
}

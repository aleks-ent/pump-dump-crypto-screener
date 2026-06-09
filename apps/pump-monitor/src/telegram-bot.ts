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
  answerCallbackQuery,
  editMessageText,
  formatClassifiedPumpMessage,
  formatMonitorRunsMessage,
  formatPumpStatsMessages,
  buildCommandReplyKeyboard,
  sendTelegramMessage,
  type TelegramConfig,
} from "./telegram.js";

export interface PumpConfig {
  minScore: number;
}

export interface PumpBotConfig {
  telegram: TelegramConfig;
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
    telegramChatId?: string;
    pump?: {
      minScore?: number;
      statsMinScore?: number;
    };
  };
  const botToken = cfg.telegramBotToken?.trim() ?? "";
  const chatId = cfg.telegramChatId?.trim() ?? "";
  if (!botToken || !chatId) return null;

  const pumpCfg = cfg.pump ?? {};
  const minScore = Number(pumpCfg.minScore ?? pumpCfg.statsMinScore ?? 80);
  return {
    telegram: { botToken, chatId },
    pump: { minScore },
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
  config: TelegramConfig,
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

export async function handleStatsCommand(config: PumpBotConfig): Promise<number> {
  const repo = await createPumpRepository();
  const pumps = await repo.listStoredPumps({ minScore: config.pump.minScore });
  const messages = formatPumpStatsMessages(pumps, config.pump.minScore);
  const replyConfig = { ...config.telegram };

  for (const message of messages) {
    await sendTelegramMessage(replyConfig, message);
  }
  return messages.length;
}

const MONITOR_RUNS_LIMIT = 5;

export async function handleRunsCommand(config: PumpBotConfig): Promise<void> {
  const repo = await createMonitorRunRepository();
  const runs = await repo.listRecentRuns(MONITOR_RUNS_LIMIT);
  const message = formatMonitorRunsMessage(runs, MONITOR_RUNS_LIMIT);
  await sendTelegramMessage(config.telegram, message);
}

export async function handleClassificationCallback(
  config: PumpBotConfig,
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>,
  log: (msg: string) => void,
): Promise<void> {
  const chatId = callbackQuery.message?.chat.id;
  if (chatId == null || String(chatId) !== config.telegram.chatId) {
    log(`Ignored callback from unauthorized chat ${chatId ?? "unknown"}`);
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
    `Telegram bot listening (chat ${config.telegram.chatId}, /stats, /runs, classification buttons enabled)`,
  );

  await sendTelegramMessage(config.telegram, "Tap a button for /stats or /runs.", {
    replyMarkup: buildCommandReplyKeyboard(),
  });
  log("Sent command reply keyboard");

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
      if (chatId !== config.telegram.chatId) {
        log(`Ignored message from unauthorized chat ${chatId}`);
        continue;
      }

      const command = parseCommand(message.text);
      if (command === "/stats") {
        log("Handling /stats");
        const count = await handleStatsCommand(config);
        log(`Sent /stats reply (${count} message${count === 1 ? "" : "s"})`);
      } else if (command === "/runs") {
        log("Handling /runs");
        await handleRunsCommand(config);
        log("Sent /runs reply");
      }
    }
  }
}

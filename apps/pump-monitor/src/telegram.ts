import { pathToFileURL } from "node:url";
import { resolveRepoPath } from "@screener/core";
import type { MonitorRunRecord, PumpClassification, StoredPump } from "@screener/db";
import {
  buildClassificationKeyboard,
  classificationLabel,
} from "./telegram-callback.js";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

export interface ReplyKeyboardMarkup {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard?: boolean;
  is_persistent?: boolean;
}

export type TelegramReplyMarkup = InlineKeyboardMarkup | ReplyKeyboardMarkup;

export function buildCommandReplyKeyboard(): ReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: "/stats" }, { text: "/runs" }]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export async function loadTelegramConfig(): Promise<TelegramConfig | null> {
  const mod = await import(pathToFileURL(resolveRepoPath("config.js")).href);
  const cfg = (mod.default ?? mod) as {
    telegramBotToken?: string;
    telegramChatId?: string;
  };
  const botToken = cfg.telegramBotToken?.trim() ?? "";
  const chatId = cfg.telegramChatId?.trim() ?? "";
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

function fmtIsoUtc(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

function fmtRunDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "—";
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return fmtDuration(Math.round(ms / 60_000));
}

function formatRunResult(run: MonitorRunRecord): string {
  if (run.endedAt == null) {
    return "running";
  }
  if (run.newPumpsCount == null) {
    return "failed";
  }
  if (run.newPumpsCount === 0) {
    return "no new pumps";
  }
  const label = run.newPumpsCount === 1 ? "new pump" : "new pumps";
  return `${run.newPumpsCount} ${label}`;
}

export function formatMonitorRunsMessage(
  runs: MonitorRunRecord[],
  limit = 5,
): string {
  if (runs.length === 0) {
    return "<b>Monitor runs</b>\nNo runs recorded yet.";
  }

  const blocks = runs.map((run) => {
    const result = formatRunResult(run);
    const lines = [
      `<b>#${run.id}</b> · ${escapeHtml(result)}`,
      `Started: ${fmtIsoUtc(run.startedAt)} UTC`,
    ];
    if (run.endedAt) {
      lines.push(
        `Finished: ${fmtIsoUtc(run.endedAt)} UTC (${fmtRunDuration(run.startedAt, run.endedAt)})`,
      );
    }
    return lines.join("\n");
  });

  return [`<b>Monitor runs</b> · last ${limit}`, "", blocks.join("\n\n")].join("\n");
}

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const TELEGRAM_MESSAGE_LIMIT = 4096;

function sortPumpsRecentFirst(pumps: StoredPump[]): StoredPump[] {
  return pumps.slice().sort((a, b) => b.startMs - a.startMs || b.peakScore - a.peakScore);
}

export function formatPumpBlock(pump: StoredPump): string {
  const exchanges =
    pump.confirmedExchanges.length > 0
      ? pump.confirmedExchanges.join(", ")
      : pump.leadingExchange;
  const lines = [
    `<b>${escapeHtml(pump.coin)}</b> · peak ${pump.peakScore}`,
    `${fmtUtc(pump.startMs)} → ${fmtUtc(pump.endMs)} UTC (${fmtDuration(pump.durationMinutes)})`,
    `Exchange: ${escapeHtml(exchanges)}`,
    `<a href="${escapeHtml(pump.tradingViewUrl)}">TradingView chart</a>`,
  ];
  if (pump.classification) {
    lines.push(`Classification: ${classificationLabel(pump.classification)}`);
  }
  return lines.join("\n");
}

export function formatPumpAlertMessage(pump: StoredPump): string {
  return ["<b>New pump detected</b>", formatPumpBlock(pump)].join("\n");
}

function formatPumpStatsHeader(
  total: number,
  minScore: number,
  part?: { index: number; total: number },
): string {
  const label = `<b>Pumps</b> · score &gt; ${minScore} · ${total} total`;
  if (part && part.total > 1) return `${label} (${part.index}/${part.total})`;
  return label;
}

function packingStatsHeader(minScore: number): string {
  return formatPumpStatsHeader(999, minScore, { index: 999, total: 999 });
}

export function formatPumpStatsMessages(pumps: StoredPump[], minScore: number): string[] {
  if (pumps.length === 0) {
    return [`No pumps with score &gt; ${minScore} in index.`];
  }
  const blocks = sortPumpsRecentFirst(pumps).map((pump) => `\n${formatPumpBlock(pump)}`);
  return chunkPumpMessages(
    (total, part) => formatPumpStatsHeader(total, minScore, part),
    packingStatsHeader(minScore),
    pumps.length,
    blocks,
  );
}

function chunkPumpMessages(
  headerForCount: (total: number, part?: { index: number; total: number }) => string,
  packingHeaderText: string,
  total: number,
  blocks: string[],
): string[] {
  if (blocks.length === 0) return [];

  const chunks: string[][] = [];
  let current: string[] = [];

  for (const block of blocks) {
    const candidate = [...current, block];
    const testMessage = [packingHeaderText, ...candidate].join("\n");
    if (testMessage.length > TELEGRAM_MESSAGE_LIMIT && current.length > 0) {
      chunks.push(current);
      current = [block];
      continue;
    }
    current = candidate;
  }
  if (current.length > 0) chunks.push(current);

  const partTotal = chunks.length;
  return chunks.map((chunkBlocks, index) =>
    [
      headerForCount(total, partTotal > 1 ? { index: index + 1, total: partTotal } : undefined),
      ...chunkBlocks,
    ].join("\n"),
  );
}

async function telegramPost(config: TelegramConfig, method: string, body: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${config.botToken}/${method}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram ${method} failed (${response.status}): ${text}`);
  }
}

export async function sendTelegramMessage(
  config: TelegramConfig,
  text: string,
  opts?: { replyMarkup?: TelegramReplyMarkup },
): Promise<void> {
  await telegramPost(config, "sendMessage", {
    chat_id: config.chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: false,
    reply_markup: opts?.replyMarkup,
  });
}

export async function sendPumpAlertMessage(
  config: TelegramConfig,
  pump: StoredPump,
): Promise<void> {
  await sendTelegramMessage(config, formatPumpAlertMessage(pump), {
    replyMarkup: buildClassificationKeyboard(pump.index),
  });
}

export async function sendPumpAlert(
  config: TelegramConfig,
  pumps: StoredPump[],
): Promise<number> {
  for (const pump of pumps) {
    await sendPumpAlertMessage(config, pump);
  }
  return pumps.length;
}

export async function answerCallbackQuery(
  config: TelegramConfig,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await telegramPost(config, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

export async function editMessageText(
  config: TelegramConfig,
  chatId: string,
  messageId: number,
  text: string,
  opts?: { replyMarkup?: InlineKeyboardMarkup },
): Promise<void> {
  await telegramPost(config, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: false,
    reply_markup: opts?.replyMarkup,
  });
}

export function formatClassifiedPumpMessage(
  pump: StoredPump,
  classification: PumpClassification,
): string {
  return [
    "<b>New pump detected</b>",
    formatPumpBlock({ ...pump, classification }),
  ].join("\n");
}

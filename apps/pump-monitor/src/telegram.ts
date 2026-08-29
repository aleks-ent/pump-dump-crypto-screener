import { pathToFileURL } from "node:url";
import { resolveRepoPath } from "@screener/core";
import type {
  MonitorRunRecord,
  PumpClassification,
  StoredPump,
  TelegramEpisodeVoteCounts,
  TelegramMessageKind,
} from "@screener/db";
import { normalizeTelegramChatId } from "./telegram-subscribers.js";
import {
  buildClassificationKeyboard,
  classificationLabel,
} from "./telegram-callback.js";
import type { TelegramChartImage } from "./telegram-chart.js";

export interface TelegramApiConfig {
  botToken: string;
}

export interface TelegramRuntimeConfig extends TelegramApiConfig {
  classifierChatId: string;
  publicChatId?: string;
}

export interface TelegramConfig extends TelegramApiConfig {
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

export { normalizeTelegramChatId };

const CONTACT_EMAIL = "aleksent@yahoo.com";
const PROJECT_REPO_URL =
  "https://github.com/aleks-ent/pump-dump-crypto-screener";

interface TelegramErrorPayload {
  error_code?: unknown;
  description?: unknown;
}

interface TelegramSuccessPayload {
  ok?: unknown;
  result?: unknown;
  error_code?: unknown;
  description?: unknown;
}

export interface SentEpisodeAlert {
  episodeId: string;
  chatId: string;
  messageId: number;
  messageKind: TelegramMessageKind;
}

interface DeliveredEpisodeAlert {
  messageId: number;
  messageKind: TelegramMessageKind;
}

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    readonly errorCode: number,
    readonly description: string,
  ) {
    super(
      `Telegram ${method} failed (${status}/${errorCode}): ${description}`,
    );
    this.name = "TelegramApiError";
  }
}

export function isPermanentTelegramRecipientError(error: unknown): boolean {
  if (!(error instanceof TelegramApiError)) return false;

  const description = error.description.toLowerCase();
  if (error.errorCode === 403) {
    return [
      "bot was blocked by the user",
      "user is deactivated",
      "bot was kicked",
      "bot is not a member",
    ].some((message) => description.includes(message));
  }
  return (
    error.errorCode === 400 &&
    (description.includes("chat not found") ||
      description.includes("user not found"))
  );
}

export function buildCommandReplyKeyboard(): ReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: "/stats" }, { text: "/runs" }], [{ text: "/about" }]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export function formatAboutMessage(): string {
  return [
    "<b>About Pump &amp; Dump Crypto Screener</b>",
    "",
    "This bot scans Binance and Bybit market data for unusual crypto pump and dump activity and sends TradingView chart links for detected events.",
    "",
    `Project: <a href="${PROJECT_REPO_URL}">aleks-ent/pump-dump-crypto-screener</a>`,
    `Contact: ${CONTACT_EMAIL}`,
    "<i>Signals are informational only, not financial advice.</i>",
  ].join("\n");
}

export function formatStartMessage(): string {
  return [
    "<b>Pump &amp; Dump Crypto Screener</b>",
    "",
    "This bot scans Binance and Bybit market data for unusual crypto pump activity and provides TradingView chart links for detected events.",
    "",
    "<b>How to use</b>",
    "/stats — view the latest detected pumps",
    "/runs — check recent scanner runs and status",
    "/about — view project details and contact info",
    "/stop — unsubscribe from automatic alerts",
    "",
    "You are subscribed to new pump and dump alerts after pressing Start.",
    "Use the buttons below at any time.",
    `Contact: ${CONTACT_EMAIL}`,
    "<i>Signals are informational only, not financial advice.</i>",
  ].join("\n");
}

export async function loadTelegramConfig(): Promise<TelegramRuntimeConfig | null> {
  const mod = await import(pathToFileURL(resolveRepoPath("config.js")).href);
  const cfg = (mod.default ?? mod) as {
    telegramBotToken?: string;
    classifierTelegramChatId?: string | number;
    publicTelegramChatId?: string | number;
  };
  const botToken = cfg.telegramBotToken?.trim() ?? "";
  const classifierChatId = normalizeTelegramChatId(
    cfg.classifierTelegramChatId,
  );
  if (!botToken || !classifierChatId) return null;
  const publicChatId = normalizePublicTelegramChatId(
    cfg.publicTelegramChatId,
    classifierChatId,
  );
  return { botToken, classifierChatId, publicChatId };
}

export function normalizePublicTelegramChatId(
  value: unknown,
  classifierChatId: string,
): string | undefined {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return undefined;
  }

  const publicChatId = normalizeTelegramChatId(value);
  if (!publicChatId) {
    throw new Error(
      "publicTelegramChatId must be a numeric Telegram chat ID",
    );
  }
  if (publicChatId === classifierChatId) {
    throw new Error(
      "publicTelegramChatId must differ from classifierTelegramChatId",
    );
  }
  return publicChatId;
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

export function formatEpisodeBlock(episode: StoredPump): string {
  const exchanges =
    episode.confirmedExchanges.length > 0
      ? episode.confirmedExchanges.join(", ")
      : episode.leadingExchange;
  const lines = [
    `<b>${escapeHtml(episode.coin)}</b> · peak ${episode.peakScore}`,
    `${fmtUtc(episode.startMs)} → ${fmtUtc(episode.endMs)} UTC (${fmtDuration(episode.durationMinutes)})`,
    `Exchange: ${escapeHtml(exchanges)}`,
    `<a href="${escapeHtml(episode.tradingViewUrl)}">TradingView chart</a>`,
  ];
  if (episode.classification) {
    lines.push(`Classification: ${classificationLabel(episode.classification)}`);
  }
  return lines.join("\n");
}

/** @deprecated Use {@link formatEpisodeBlock}. */
export function formatPumpBlock(pump: StoredPump): string {
  return formatEpisodeBlock(pump);
}

export function formatPumpAlertMessage(pump: StoredPump): string {
  return ["<b>New pump detected</b>", formatEpisodeBlock(pump)].join("\n");
}

export function formatDumpAlertMessage(dump: StoredPump): string {
  return ["<b>New dump detected</b>", formatEpisodeBlock(dump)].join("\n");
}

const ZERO_VOTE_COUNTS: TelegramEpisodeVoteCounts = {
  pump: 0,
  dump: 0,
  none: 0,
};

export function formatEpisodeVoteStats(
  counts: TelegramEpisodeVoteCounts,
): string {
  return `Votes: 📈 ${counts.pump} · 📉 ${counts.dump} · ⚪ ${counts.none}`;
}

export function formatVotedEpisodeAlertMessage(
  episode: StoredPump,
  voteCounts: TelegramEpisodeVoteCounts = ZERO_VOTE_COUNTS,
): string {
  const title = episode.episodeType === "dump" ? "New dump detected" : "New pump detected";
  const lines = [
    `<b>${title}</b>`,
    formatEpisodeBlock({ ...episode, classification: null }),
  ];
  if (voteCounts.pump + voteCounts.dump + voteCounts.none > 0) {
    lines.push(formatEpisodeVoteStats(voteCounts));
  }
  return lines.join("\n");
}

function formatPumpStatsHeader(
  minScore: number,
  limit: number,
  part?: { index: number; total: number },
): string {
  const label = `<b>Pumps</b> · score &gt; ${minScore} · last ${limit}`;
  if (part && part.total > 1) return `${label} (${part.index}/${part.total})`;
  return label;
}

function formatDumpStatsHeader(
  minScore: number,
  limit: number,
  part?: { index: number; total: number },
): string {
  const label = `<b>Dumps</b> · score &gt; ${minScore} · last ${limit}`;
  if (part && part.total > 1) return `${label} (${part.index}/${part.total})`;
  return label;
}

function formatEpisodeStatsSection(
  episodes: StoredPump[],
  headerFor: (minScore: number, limit: number, part?: { index: number; total: number }) => string,
  packingHeader: (minScore: number, limit: number) => string,
  emptyMessage: (minScore: number) => string,
  minScore: number,
  limit: number,
): string[] {
  if (episodes.length === 0) {
    return [emptyMessage(minScore)];
  }
  const blocks = sortPumpsRecentFirst(episodes).map((ep) => `\n${formatEpisodeBlock(ep)}`);
  return chunkEpisodeMessages(
    (_total, part) => headerFor(minScore, limit, part),
    packingHeader(minScore, limit),
    episodes.length,
    blocks,
  );
}

export function formatPumpStatsMessages(
  pumps: StoredPump[],
  minScore: number,
  limit = 5,
  activeSubscriberCount?: number,
): string[] {
  const withSubscriberCount = (message: string): string =>
    activeSubscriberCount == null
      ? message
      : `${message}\nActive subscribers: ${activeSubscriberCount}`;
  return formatEpisodeStatsSection(
    pumps,
    (min, lim, part) =>
      withSubscriberCount(formatPumpStatsHeader(min, lim, part)),
    (min, lim) =>
      withSubscriberCount(
        formatPumpStatsHeader(min, lim, { index: 999, total: 999 }),
      ),
    (min) =>
      withSubscriberCount(`No pumps with score &gt; ${min} stored yet.`),
    minScore,
    limit,
  );
}

export function formatDumpStatsMessages(
  dumps: StoredPump[],
  minScore: number,
  limit = 5,
): string[] {
  return formatEpisodeStatsSection(
    dumps,
    formatDumpStatsHeader,
    (min, lim) => formatDumpStatsHeader(min, lim, { index: 999, total: 999 }),
    (min) => `No dumps with score &gt; ${min} in index.`,
    minScore,
    limit,
  );
}

export function formatEpisodeStatsMessages(
  pumps: StoredPump[],
  dumps: StoredPump[],
  minPumpScore: number,
  minDumpScore: number,
  limit = 5,
): string[] {
  if (pumps.length === 0 && dumps.length === 0) {
    return [
      `No pumps (&gt; ${minPumpScore}) or dumps (&gt; ${minDumpScore}) in index.`,
    ];
  }
  return [
    ...formatPumpStatsMessages(pumps, minPumpScore, limit),
    ...formatDumpStatsMessages(dumps, minDumpScore, limit),
  ];
}

function chunkEpisodeMessages(
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

async function telegramRequest(
  config: TelegramApiConfig,
  method: string,
  init: RequestInit,
): Promise<Response> {
  const url = `https://api.telegram.org/bot${config.botToken}/${method}`;
  const response = await fetch(url, init);

  if (!response.ok) {
    const text = await response.text();
    let payload: TelegramErrorPayload = {};
    try {
      payload = JSON.parse(text) as TelegramErrorPayload;
    } catch {
      // Keep the raw response when Telegram does not return JSON.
    }
    const errorCode =
      typeof payload.error_code === "number"
        ? payload.error_code
        : response.status;
    const description =
      typeof payload.description === "string" ? payload.description : text;
    throw new TelegramApiError(
      method,
      response.status,
      errorCode,
      description,
    );
  }

  return response;
}

async function telegramPost(
  config: TelegramApiConfig,
  method: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return telegramRequest(config, method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function telegramProfileDescription(chat: unknown): string | null {
  if (chat == null || typeof chat !== "object") return null;
  const record = chat as Record<string, unknown>;
  if (typeof record.bio === "string") return record.bio;
  if (typeof record.description === "string") return record.description;
  return null;
}

export function serializeTelegramSubscriberData(
  chat: unknown,
  capturedAt: string = new Date().toISOString(),
): string {
  return JSON.stringify({
    source: "telegram.getChat",
    captured_at: capturedAt,
    description: telegramProfileDescription(chat),
    chat,
  });
}

export async function fetchTelegramSubscriberData(
  config: TelegramApiConfig,
  chatId: string,
  capturedAt: string = new Date().toISOString(),
): Promise<string> {
  const response = await telegramPost(config, "getChat", { chat_id: chatId });
  const payload = (await response.json()) as TelegramSuccessPayload;
  if (payload.ok !== true) {
    const errorCode =
      typeof payload.error_code === "number" ? payload.error_code : response.status;
    const description =
      typeof payload.description === "string"
        ? payload.description
        : "Telegram getChat returned ok=false";
    throw new TelegramApiError(
      "getChat",
      response.status,
      errorCode,
      description,
    );
  }
  return serializeTelegramSubscriberData(payload.result, capturedAt);
}

export async function sendTelegramMessage(
  config: TelegramConfig,
  text: string,
  opts?: { replyMarkup?: TelegramReplyMarkup },
): Promise<number> {
  const response = await telegramPost(config, "sendMessage", {
    chat_id: config.chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: opts?.replyMarkup,
  });
  const payload = (await response.json()) as TelegramSuccessPayload;
  if (payload.ok !== true) {
    const errorCode =
      typeof payload.error_code === "number" ? payload.error_code : response.status;
    const description =
      typeof payload.description === "string"
        ? payload.description
        : "Telegram sendMessage returned ok=false";
    throw new TelegramApiError(
      "sendMessage",
      response.status,
      errorCode,
      description,
    );
  }

  if (
    payload.result == null ||
    typeof payload.result !== "object" ||
    typeof (payload.result as { message_id?: unknown }).message_id !== "number"
  ) {
    throw new TelegramApiError(
      "sendMessage",
      response.status,
      response.status,
      "Telegram sendMessage did not return a message_id",
    );
  }

  return (payload.result as { message_id: number }).message_id;
}

export async function sendTelegramPhoto(
  config: TelegramConfig,
  photo: TelegramChartImage,
  caption: string,
  opts?: { replyMarkup?: InlineKeyboardMarkup },
): Promise<number> {
  const form = new FormData();
  form.set("chat_id", config.chatId);
  form.set(
    "photo",
    new Blob([new Uint8Array(photo.buffer)], { type: "image/png" }),
    photo.filename,
  );
  form.set("caption", caption);
  form.set("parse_mode", "HTML");
  if (opts?.replyMarkup) {
    form.set("reply_markup", JSON.stringify(opts.replyMarkup));
  }

  const response = await telegramRequest(config, "sendPhoto", {
    method: "POST",
    body: form,
  });
  const payload = (await response.json()) as TelegramSuccessPayload;
  if (payload.ok !== true) {
    const errorCode =
      typeof payload.error_code === "number" ? payload.error_code : response.status;
    const description =
      typeof payload.description === "string"
        ? payload.description
        : "Telegram sendPhoto returned ok=false";
    throw new TelegramApiError(
      "sendPhoto",
      response.status,
      errorCode,
      description,
    );
  }

  if (
    payload.result == null ||
    typeof payload.result !== "object" ||
    typeof (payload.result as { message_id?: unknown }).message_id !== "number"
  ) {
    throw new TelegramApiError(
      "sendPhoto",
      response.status,
      response.status,
      "Telegram sendPhoto did not return a message_id",
    );
  }

  return (payload.result as { message_id: number }).message_id;
}

async function sendEpisodeAlertMessage(
  config: TelegramConfig,
  episode: StoredPump,
  opts?: {
    voteCounts?: TelegramEpisodeVoteCounts;
    votingButtons?: boolean;
    chartImage?: TelegramChartImage;
    onChartError?: (episode: StoredPump, error: unknown) => void;
  },
): Promise<DeliveredEpisodeAlert> {
  const text = formatVotedEpisodeAlertMessage(episode, opts?.voteCounts);
  const messageOptions = opts?.votingButtons !== false
    ? { replyMarkup: buildClassificationKeyboard(episode.index) }
    : undefined;

  if (opts?.chartImage) {
    try {
      return {
        messageId: await sendTelegramPhoto(config, opts.chartImage, text, messageOptions),
        messageKind: "photo",
      };
    } catch (error) {
      opts.onChartError?.(episode, error);
    }
  }

  return {
    messageId: await sendTelegramMessage(config, text, messageOptions),
    messageKind: "text",
  };
}

export async function sendPumpAlertMessage(
  config: TelegramConfig,
  pump: StoredPump,
  opts?: {
    voteCounts?: TelegramEpisodeVoteCounts;
    votingButtons?: boolean;
    chartImage?: TelegramChartImage;
    onChartError?: (episode: StoredPump, error: unknown) => void;
  },
): Promise<number> {
  return (await sendEpisodeAlertMessage(config, pump, opts)).messageId;
}

export async function sendDumpAlertMessage(
  config: TelegramConfig,
  dump: StoredPump,
  opts?: {
    voteCounts?: TelegramEpisodeVoteCounts;
    votingButtons?: boolean;
    chartImage?: TelegramChartImage;
    onChartError?: (episode: StoredPump, error: unknown) => void;
  },
): Promise<number> {
  return (await sendEpisodeAlertMessage(config, dump, opts)).messageId;
}

export async function sendPumpAlert(
  config: TelegramConfig,
  pumps: StoredPump[],
  opts?: { votingButtons?: boolean },
): Promise<number> {
  for (const pump of pumps) {
    await sendPumpAlertMessage(config, pump, opts);
  }
  return pumps.length;
}

export async function sendEpisodeAlerts(
  config: TelegramConfig,
  pumps: StoredPump[],
  dumps: StoredPump[],
  opts?: {
    voteCountsByEpisode?: ReadonlyMap<string, TelegramEpisodeVoteCounts>;
    votingButtons?: boolean;
    chartImagesByEpisode?: ReadonlyMap<string, TelegramChartImage>;
    onChartError?: (episode: StoredPump, error: unknown) => void;
    onSent?: (alert: SentEpisodeAlert) => Promise<void>;
  },
): Promise<SentEpisodeAlert[]> {
  const sent: SentEpisodeAlert[] = [];
  for (const pump of pumps) {
    const delivered = await sendEpisodeAlertMessage(config, pump, {
      voteCounts: opts?.voteCountsByEpisode?.get(pump.index),
      votingButtons: opts?.votingButtons,
      chartImage: opts?.chartImagesByEpisode?.get(pump.index),
      onChartError: opts?.onChartError,
    });
    const alert = {
      episodeId: pump.index,
      chatId: config.chatId,
      ...delivered,
    };
    sent.push(alert);
    await opts?.onSent?.(alert);
  }
  for (const dump of dumps) {
    const delivered = await sendEpisodeAlertMessage(config, dump, {
      voteCounts: opts?.voteCountsByEpisode?.get(dump.index),
      votingButtons: opts?.votingButtons,
      chartImage: opts?.chartImagesByEpisode?.get(dump.index),
      onChartError: opts?.onChartError,
    });
    const alert = {
      episodeId: dump.index,
      chatId: config.chatId,
      ...delivered,
    };
    sent.push(alert);
    await opts?.onSent?.(alert);
  }
  return sent;
}

export async function answerCallbackQuery(
  config: TelegramApiConfig,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await telegramPost(config, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

export async function editMessageText(
  config: TelegramApiConfig,
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
    link_preview_options: { is_disabled: true },
    reply_markup: opts?.replyMarkup,
  });
}

export async function editMessageCaption(
  config: TelegramApiConfig,
  chatId: string,
  messageId: number,
  caption: string,
  opts?: { replyMarkup?: InlineKeyboardMarkup },
): Promise<void> {
  await telegramPost(config, "editMessageCaption", {
    chat_id: chatId,
    message_id: messageId,
    caption,
    parse_mode: "HTML",
    reply_markup: opts?.replyMarkup,
  });
}

export function formatClassifiedEpisodeMessage(
  episode: StoredPump,
  classification: PumpClassification,
): string {
  const title = episode.episodeType === "dump" ? "New dump detected" : "New pump detected";
  return [ `<b>${title}</b>`, formatEpisodeBlock({ ...episode, classification }) ].join("\n");
}

/** @deprecated Use {@link formatClassifiedEpisodeMessage}. */
export function formatClassifiedPumpMessage(
  pump: StoredPump,
  classification: PumpClassification,
): string {
  return formatClassifiedEpisodeMessage(pump, classification);
}

import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

interface TelegramSubscribersFile {
  chatIds?: unknown;
}

export function normalizeTelegramChatId(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? String(value) : null;
  }
  if (typeof value !== "string") return null;

  const chatId = value.trim();
  return /^-?\d+$/.test(chatId) ? chatId : null;
}

export function telegramSubscribersPath(baseDir: string): string {
  return join(baseDir, "reports", "telegram_subscribers.json");
}

export function loadTelegramSubscriberIds(baseDir: string): string[] {
  try {
    const parsed = JSON.parse(
      readFileSync(telegramSubscribersPath(baseDir), "utf-8"),
    ) as TelegramSubscribersFile;
    if (!Array.isArray(parsed.chatIds)) return [];

    const chatIds = new Set<string>();
    for (const value of parsed.chatIds) {
      const chatId = normalizeTelegramChatId(value);
      if (chatId) chatIds.add(chatId);
    }
    return [...chatIds];
  } catch {
    return [];
  }
}

export function resolveTelegramAlertChatIds(
  classifierChatId: string,
  subscriberIds: readonly string[],
): string[] {
  return [...new Set([classifierChatId, ...subscriberIds])];
}

function saveTelegramSubscriberIds(baseDir: string, chatIds: readonly string[]): void {
  const path = telegramSubscribersPath(baseDir);
  const tempPath = `${path}.tmp-${process.pid}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    tempPath,
    `${JSON.stringify({ chatIds: [...chatIds] }, null, 2)}\n`,
    "utf-8",
  );
  renameSync(tempPath, path);
}

export function addTelegramSubscriber(baseDir: string, chatId: string): boolean {
  const subscribers = new Set(loadTelegramSubscriberIds(baseDir));
  const previousSize = subscribers.size;
  subscribers.add(chatId);
  if (subscribers.size === previousSize) return false;
  saveTelegramSubscriberIds(baseDir, [...subscribers]);
  return true;
}

export function removeTelegramSubscriber(baseDir: string, chatId: string): boolean {
  const subscribers = new Set(loadTelegramSubscriberIds(baseDir));
  if (!subscribers.delete(chatId)) return false;
  saveTelegramSubscriberIds(baseDir, [...subscribers]);
  return true;
}

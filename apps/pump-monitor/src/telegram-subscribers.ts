import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

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

export function migratedTelegramSubscribersPath(baseDir: string): string {
  return `${telegramSubscribersPath(baseDir)}.migrated`;
}

export function loadLegacyTelegramSubscriberIds(baseDir: string): string[] {
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

export type TelegramAlertRecipientRole =
  | "classifier"
  | "subscriber"
  | "public";

export interface TelegramAlertRecipient {
  chatId: string;
  role: TelegramAlertRecipientRole;
  votingButtons: boolean;
}

export function resolveTelegramAlertRecipients(
  classifierChatId: string,
  publicChatId: string | undefined,
  subscriberIds: readonly string[],
): TelegramAlertRecipient[] {
  const recipients = new Map<string, TelegramAlertRecipient>();
  recipients.set(classifierChatId, {
    chatId: classifierChatId,
    role: "classifier",
    votingButtons: true,
  });

  for (const chatId of subscriberIds) {
    if (recipients.has(chatId)) continue;
    recipients.set(chatId, {
      chatId,
      role: "subscriber",
      votingButtons: true,
    });
  }

  if (publicChatId) {
    recipients.set(publicChatId, {
      chatId: publicChatId,
      role: "public",
      votingButtons: false,
    });
  }

  return [...recipients.values()];
}

export function markLegacyTelegramSubscribersMigrated(baseDir: string): void {
  const source = telegramSubscribersPath(baseDir);
  if (!existsSync(source)) return;
  renameSync(source, migratedTelegramSubscribersPath(baseDir));
}

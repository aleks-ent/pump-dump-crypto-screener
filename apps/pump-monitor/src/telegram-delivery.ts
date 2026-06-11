import { isPermanentTelegramRecipientError } from "./telegram.js";

interface TelegramSubscriberRemover {
  unsubscribe(chatId: string): Promise<boolean>;
}

interface TelegramSubscriberEnsurer {
  subscribe(chatId: string, subscribedAt: string): Promise<boolean>;
}

export interface TelegramRecipientCleanupResult {
  permanent: boolean;
  removed: boolean;
  cleanupError?: unknown;
}

export async function ensureClassifierTelegramRecipient(
  repo: TelegramSubscriberEnsurer,
  classifierChatId: string,
  subscribedAt: string = new Date().toISOString(),
): Promise<boolean> {
  return repo.subscribe(classifierChatId, subscribedAt);
}

export async function cleanupUnavailableTelegramRecipient(
  repo: TelegramSubscriberRemover,
  chatId: string,
  error: unknown,
): Promise<TelegramRecipientCleanupResult> {
  if (!isPermanentTelegramRecipientError(error)) {
    return { permanent: false, removed: false };
  }
  try {
    return {
      permanent: true,
      removed: await repo.unsubscribe(chatId),
    };
  } catch (cleanupError) {
    return {
      permanent: true,
      removed: false,
      cleanupError,
    };
  }
}

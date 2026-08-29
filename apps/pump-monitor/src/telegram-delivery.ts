import { isPermanentTelegramRecipientError } from "./telegram.js";

interface TelegramSubscriberRemover {
  unsubscribe(chatId: string): Promise<boolean>;
}

interface TelegramSubscriberEnsurer {
  subscribe(
    chatId: string,
    subscribedAt: string,
    subscriberData?: string | null,
    votingEnabled?: boolean,
  ): Promise<boolean>;
}

export interface TelegramRecipientCleanupResult {
  permanent: boolean;
  unsubscribed: boolean;
  cleanupError?: unknown;
}

export async function ensureClassifierTelegramRecipient(
  repo: TelegramSubscriberEnsurer,
  classifierChatId: string,
  subscribedAt: string = new Date().toISOString(),
): Promise<boolean> {
  return repo.subscribe(classifierChatId, subscribedAt);
}

export async function ensureReadOnlyTelegramRecipient(
  repo: TelegramSubscriberEnsurer,
  chatId: string,
  subscribedAt: string = new Date().toISOString(),
): Promise<boolean> {
  return repo.subscribe(chatId, subscribedAt, null, false);
}

export async function cleanupUnavailableTelegramRecipient(
  repo: TelegramSubscriberRemover,
  chatId: string,
  error: unknown,
): Promise<TelegramRecipientCleanupResult> {
  if (!isPermanentTelegramRecipientError(error)) {
    return { permanent: false, unsubscribed: false };
  }
  try {
    return {
      permanent: true,
      unsubscribed: await repo.unsubscribe(chatId),
    };
  } catch (cleanupError) {
    return {
      permanent: true,
      unsubscribed: false,
      cleanupError,
    };
  }
}

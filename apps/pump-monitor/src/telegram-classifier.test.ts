import { describe, expect, it, vi } from "vitest";
import {
  handleClassificationCallback,
  isClassifierTelegramChat,
  runTelegramBot,
} from "./telegram-bot.js";

describe("Telegram classifier chat", () => {
  it("allows only the configured Telegram chat ID", () => {
    expect(isClassifierTelegramChat("36772199", 36772199)).toBe(true);
    expect(isClassifierTelegramChat("36772199", 12345678)).toBe(false);
    expect(isClassifierTelegramChat("36772199", undefined)).toBe(false);
  });

  it("rejects a callback from another chat before classification", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const log = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await handleClassificationCallback(
        {
          telegram: { botToken: "token", classifierChatId: "36772199" },
          pump: { minScore: 80, minDumpScore: 55 },
        },
        {
          id: "callback-1",
          data: "classify:pump:anything",
          message: { message_id: 1, chat: { id: 12345678 } },
        },
        log,
      );
    } finally {
      vi.unstubAllGlobals();
    }

    expect(log).toHaveBeenCalledWith(
      "Ignored classification callback from chat 12345678",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("answerCallbackQuery");
  });

  it("does not send a Telegram message when the bot process starts", async () => {
    const fetchMock = vi.fn(
      () => new Promise<Response>(() => undefined),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      void runTelegramBot(
        {
          telegram: { botToken: "token", classifierChatId: "36772199" },
          pump: { minScore: 80, minDumpScore: 55 },
        },
        { log: vi.fn(), migrateLegacySubscribers: false },
      );
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    } finally {
      vi.unstubAllGlobals();
    }

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/getUpdates");
    expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
  });
});

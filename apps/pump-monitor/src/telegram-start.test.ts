import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryDbClient,
  PumpRepository,
  TelegramSubscriberRepository,
} from "@screener/db";
import {
  handleStartCommand,
  TelegramStartRateLimiter,
  TELEGRAM_START_RATE_LIMIT_MS,
  type PumpBotConfig,
} from "./telegram-bot.js";

const config: PumpBotConfig = {
  telegram: { botToken: "token", classifierChatId: "36772199" },
  pump: { minScore: 80, minDumpScore: 55 },
};

describe("Telegram /start rate limiting", () => {
  let now: number;

  beforeEach(() => {
    now = Date.parse("2026-08-19T10:00:00.000Z");
  });

  it("limits each chat independently for the configured window", () => {
    const limiter = new TelegramStartRateLimiter(
      TELEGRAM_START_RATE_LIMIT_MS,
      () => now,
    );

    expect(limiter.tryAcquire("111")).toBe(true);
    expect(limiter.tryAcquire("111")).toBe(false);
    expect(limiter.tryAcquire("222")).toBe(true);

    now += TELEGRAM_START_RATE_LIMIT_MS;
    expect(limiter.tryAcquire("111")).toBe(true);
  });

  it("avoids repeated database writes and Telegram replies for rapid starts", async () => {
    const client = createMemoryDbClient();
    await new PumpRepository(client).applySchema();
    const repo = new TelegramSubscriberRepository(client);
    const subscribeSpy = vi.spyOn(repo, "subscribe");
    const log = vi.fn();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/getChat")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: { id: 12345, type: "private", username: "alex" },
          }),
        );
      }
      if (url.includes("/sendMessage")) {
        return new Response(
          JSON.stringify({ ok: true, result: { message_id: 1 } }),
        );
      }
      throw new Error(`Unexpected Telegram request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const limiter = new TelegramStartRateLimiter(
        TELEGRAM_START_RATE_LIMIT_MS,
        () => now,
      );
      expect(
        await handleStartCommand(config, "12345", log, limiter, repo),
      ).toBe("subscribed");
      expect(
        await handleStartCommand(config, "12345", log, limiter, repo),
      ).toBe("rate-limited");
    } finally {
      vi.unstubAllGlobals();
    }

    expect(subscribeSpy).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await repo.countActive()).toBe(1);
    expect(log).toHaveBeenCalledWith("Active Telegram subscriber count: 1");
    expect(log).toHaveBeenCalledWith(
      "Ignored rate-limited /start for 12345",
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import type { PumpEpisode } from "@screener/pump-detector";
import {
  createMemoryDbClient,
  PumpRepository,
  TelegramEpisodeVotingRepository,
  TelegramSubscriberRepository,
} from "@screener/db";
import { encodeClassificationCallback } from "./telegram-callback.js";
import {
  handleClassificationCallback,
  isClassifierTelegramChat,
  runTelegramBot,
  type TelegramBotRepositories,
} from "./telegram-bot.js";

function samplePump(coin: string, startMs: number): PumpEpisode {
  return {
    coin,
    type: "pump",
    startMs,
    endMs: startMs + 300_000,
    durationMinutes: 5,
    peakScore: 90,
    dominantPhase: "active_pump",
    leadingExchange: "binance",
    symbolNative: "BTCUSDT",
    instrumentType: "linear_perp",
    tradingViewUrl: "https://example.com/chart",
    confirmed: true,
    confirmedExchanges: ["binance"],
    eventCount: 3,
  };
}

function mockTelegramSuccess() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, result: true }),
  });
}

async function setupVotingRepos(): Promise<
  TelegramBotRepositories & { episodeId: string }
> {
  const client = createMemoryDbClient();
  const pumpRepo = new PumpRepository(client);
  await pumpRepo.applySchema();
  const subscriberRepo = new TelegramSubscriberRepository(client);
  const votingRepo = new TelegramEpisodeVotingRepository(client);
  const { newPumps } = await pumpRepo.upsertPumpEpisodes([
    samplePump("WLD/USDT", Date.parse("2026-06-07T00:50:00.000Z")),
  ]);
  const episodeId = newPumps[0]!.index;

  await subscriberRepo.subscribe("36772199", "2026-06-11T10:00:00.000Z");
  await subscriberRepo.subscribe("12345678", "2026-06-11T10:01:00.000Z");
  await votingRepo.recordMessage(
    episodeId,
    "36772199",
    10,
    "2026-06-11T10:02:00.000Z",
  );
  await votingRepo.recordMessage(
    episodeId,
    "12345678",
    20,
    "2026-06-11T10:03:00.000Z",
  );

  return { pumpRepo, subscriberRepo, votingRepo, episodeId };
}

describe("Telegram classifier chat", () => {
  it("allows only the configured Telegram chat ID", () => {
    expect(isClassifierTelegramChat("36772199", 36772199)).toBe(true);
    expect(isClassifierTelegramChat("36772199", 12345678)).toBe(false);
    expect(isClassifierTelegramChat("36772199", undefined)).toBe(false);
  });

  it("rejects a vote callback from an unsubscribed chat", async () => {
    const repos = await setupVotingRepos();
    await repos.subscriberRepo.unsubscribe("12345678");
    const fetchMock = mockTelegramSuccess();
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
          data: encodeClassificationCallback("pump", repos.episodeId),
          message: { message_id: 1, chat: { id: 12345678 } },
        },
        log,
        repos,
      );
    } finally {
      vi.unstubAllGlobals();
    }

    expect(log).toHaveBeenCalledWith(
      "Ignored vote callback from unsubscribed chat 12345678",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("answerCallbackQuery");
    expect(await repos.votingRepo.countVotes(repos.episodeId)).toEqual({
      pump: 0,
      dump: 0,
      none: 0,
    });
  });

  it("accepts subscriber votes and edits all recorded event messages", async () => {
    const repos = await setupVotingRepos();
    const fetchMock = mockTelegramSuccess();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await handleClassificationCallback(
        {
          telegram: { botToken: "token", classifierChatId: "36772199" },
          pump: { minScore: 80, minDumpScore: 55 },
        },
        {
          id: "callback-2",
          data: encodeClassificationCallback("dump", repos.episodeId),
          message: { message_id: 20, chat: { id: 12345678 } },
        },
        vi.fn(),
        repos,
      );
    } finally {
      vi.unstubAllGlobals();
    }

    expect(await repos.votingRepo.countVotes(repos.episodeId)).toEqual({
      pump: 0,
      dump: 1,
      none: 0,
    });
    expect(await repos.pumpRepo.getClassification(repos.episodeId)).toBeNull();

    const editCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("editMessageText"),
    );
    expect(editCalls).toHaveLength(2);
    for (const call of editCalls) {
      const body = JSON.parse(String((call[1] as RequestInit).body)) as Record<
        string,
        unknown
      >;
      expect(body.text).toContain("Votes: 📈 0 · 📉 1 · ⚪ 0");
      expect(body.reply_markup).toBeDefined();
      expect(body.link_preview_options).toEqual({ is_disabled: true });
    }
  });

  it("counts admin votes and syncs the legacy classification field", async () => {
    const repos = await setupVotingRepos();
    const fetchMock = mockTelegramSuccess();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await handleClassificationCallback(
        {
          telegram: { botToken: "token", classifierChatId: "36772199" },
          pump: { minScore: 80, minDumpScore: 55 },
        },
        {
          id: "callback-3",
          data: encodeClassificationCallback("pump", repos.episodeId),
          message: { message_id: 10, chat: { id: 36772199 } },
        },
        vi.fn(),
        repos,
      );
    } finally {
      vi.unstubAllGlobals();
    }

    expect(await repos.votingRepo.countVotes(repos.episodeId)).toEqual({
      pump: 1,
      dump: 0,
      none: 0,
    });
    expect(await repos.pumpRepo.getClassification(repos.episodeId)).toBe("pump");

    const editCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("editMessageText"),
    );
    expect(editCalls).toHaveLength(2);
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

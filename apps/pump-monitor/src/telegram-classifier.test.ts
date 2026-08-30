import { describe, expect, it, vi } from "vitest";
import type { PumpEpisode } from "@screener/pump-detector";
import {
  createMemoryDbClient,
  PumpRepository,
  TelegramEpisodeVotingRepository,
  TelegramSubscriberRepository,
  type TelegramMessageKind,
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

async function setupVotingRepos(messageKind: TelegramMessageKind = "text"): Promise<
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
    messageKind,
  );
  await votingRepo.recordMessage(
    episodeId,
    "12345678",
    20,
    "2026-06-11T10:03:00.000Z",
    messageKind,
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

  it("rejects vote callbacks from the read-only public destination", async () => {
    const repos = await setupVotingRepos();
    const fetchMock = mockTelegramSuccess();
    const log = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await handleClassificationCallback(
        {
          telegram: {
            botToken: "token",
            classifierChatId: "36772199",
            publicChatId: "-10098765",
            publicChatUrl: "https://t.me/public_chat",
          },
          pump: { minScore: 80, minDumpScore: 55 },
        },
        {
          id: "callback-public",
          data: encodeClassificationCallback("pump", repos.episodeId),
          message: { message_id: 30, chat: { id: -10098765 } },
        },
        log,
        repos,
      );
    } finally {
      vi.unstubAllGlobals();
    }

    expect(log).toHaveBeenCalledWith(
      "Ignored vote callback from read-only public chat -10098765",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "answerCallbackQuery",
    );
    const answerBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(answerBody.text).toBe("Voting is not available in this chat");
    expect(await repos.votingRepo.countVotes(repos.episodeId)).toEqual({
      pump: 0,
      dump: 0,
      none: 0,
    });
  });

  it("edits mixed photo and text deliveries with the matching Telegram method", async () => {
    const repos = await setupVotingRepos("photo");
    await repos.votingRepo.recordMessage(
      repos.episodeId,
      "36772199",
      10,
      "2026-06-11T10:02:00.000Z",
      "text",
    );
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
          message: { message_id: 20, photo: [{}], chat: { id: 12345678 } },
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

    const captionCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("editMessageCaption"),
    );
    const textCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("editMessageText"),
    );
    expect(captionCalls).toHaveLength(1);
    expect(textCalls).toHaveLength(1);

    const captionBody = JSON.parse(
      String((captionCalls[0]![1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(captionBody.caption).toContain("Votes: 📈 0 · 📉 1 · ⚪ 0");
    expect(captionBody.reply_markup).toBeDefined();
    expect(captionBody).not.toHaveProperty("link_preview_options");

    const textBody = JSON.parse(
      String((textCalls[0]![1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(textBody.text).toContain("Votes: 📈 0 · 📉 1 · ⚪ 0");
    expect(textBody.reply_markup).toBeDefined();
    expect(textBody.link_preview_options).toEqual({ is_disabled: true });
  });

  it("updates public vote totals while explicitly clearing its keyboard", async () => {
    const repos = await setupVotingRepos();
    await repos.subscriberRepo.subscribe(
      "-10098765",
      "2026-06-11T10:04:00.000Z",
      null,
      false,
    );
    await repos.votingRepo.recordMessage(
      repos.episodeId,
      "-10098765",
      30,
      "2026-06-11T10:05:00.000Z",
      "text",
    );
    const fetchMock = mockTelegramSuccess();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await handleClassificationCallback(
        {
          telegram: {
            botToken: "token",
            classifierChatId: "36772199",
            publicChatId: "-10098765",
            publicChatUrl: "https://t.me/public_chat",
          },
          pump: { minScore: 80, minDumpScore: 55 },
        },
        {
          id: "callback-public-sync",
          data: encodeClassificationCallback("pump", repos.episodeId),
          message: { message_id: 20, chat: { id: 12345678 } },
        },
        vi.fn(),
        repos,
      );
    } finally {
      vi.unstubAllGlobals();
    }

    const editBodies = fetchMock.mock.calls
      .filter((call) => String(call[0]).includes("editMessageText"))
      .map(
        (call) =>
          JSON.parse(String((call[1] as RequestInit).body)) as Record<
            string,
            unknown
          >,
      );
    expect(editBodies).toHaveLength(3);

    const publicBody = editBodies.find(
      (body) => body.chat_id === "-10098765",
    );
    expect(publicBody?.text).toContain("Votes: 📈 1 · 📉 0 · ⚪ 0");
    expect(publicBody?.text).not.toContain("Discuss");
    expect(publicBody?.reply_markup).toEqual({ inline_keyboard: [] });

    for (const body of editBodies.filter(
      (candidate) => candidate.chat_id !== "-10098765",
    )) {
      expect(body.text).toContain(
        '<a href="https://t.me/public_chat">💬 Discuss</a> in the public chat',
      );
      expect(body.reply_markup).toEqual({
        inline_keyboard: expect.any(Array),
      });
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

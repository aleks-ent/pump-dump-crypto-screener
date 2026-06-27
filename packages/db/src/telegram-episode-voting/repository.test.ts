import { beforeEach, describe, expect, it } from "vitest";
import type { PumpEpisode } from "@screener/pump-detector";
import { createMemoryDbClient } from "../client.js";
import { PumpRepository } from "../pumps/repository.js";
import { TelegramSubscriberRepository } from "../telegram-subscribers/repository.js";
import { TelegramEpisodeVotingRepository } from "./repository.js";

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

describe("TelegramEpisodeVotingRepository", () => {
  let pumpRepo: PumpRepository;
  let subscriberRepo: TelegramSubscriberRepository;
  let votingRepo: TelegramEpisodeVotingRepository;
  let episodeId: string;

  beforeEach(async () => {
    const client = createMemoryDbClient();
    pumpRepo = new PumpRepository(client);
    await pumpRepo.applySchema();
    subscriberRepo = new TelegramSubscriberRepository(client);
    votingRepo = new TelegramEpisodeVotingRepository(client);

    await subscriberRepo.subscribe("111", "2026-06-11T10:00:00.000Z");
    await subscriberRepo.subscribe("222", "2026-06-11T10:01:00.000Z");
    const { newPumps } = await pumpRepo.upsertPumpEpisodes([
      samplePump("WLD/USDT", Date.parse("2026-06-07T00:50:00.000Z")),
    ]);
    episodeId = newPumps[0]!.index;
  });

  it("counts one vote per chat and updates changed votes", async () => {
    expect(await votingRepo.countVotes(episodeId)).toEqual({
      pump: 0,
      dump: 0,
      none: 0,
    });

    await votingRepo.upsertVote(
      episodeId,
      "111",
      "pump",
      "2026-06-11T10:02:00.000Z",
    );
    await votingRepo.upsertVote(
      episodeId,
      "222",
      "none",
      "2026-06-11T10:03:00.000Z",
    );
    expect(await votingRepo.countVotes(episodeId)).toEqual({
      pump: 1,
      dump: 0,
      none: 1,
    });

    await votingRepo.upsertVote(
      episodeId,
      "111",
      "dump",
      "2026-06-11T10:04:00.000Z",
    );
    expect(await votingRepo.countVotes(episodeId)).toEqual({
      pump: 0,
      dump: 1,
      none: 1,
    });
  });

  it("records and replaces Telegram message references", async () => {
    await votingRepo.recordMessage(
      episodeId,
      "111",
      10,
      "2026-06-11T10:02:00.000Z",
    );
    await votingRepo.recordMessage(
      episodeId,
      "222",
      20,
      "2026-06-11T10:03:00.000Z",
    );
    await votingRepo.recordMessage(
      episodeId,
      "111",
      11,
      "2026-06-11T10:04:00.000Z",
    );

    expect(await votingRepo.listMessages(episodeId)).toEqual([
      {
        episodeId,
        chatId: "222",
        messageId: 20,
        sentAt: "2026-06-11T10:03:00.000Z",
      },
      {
        episodeId,
        chatId: "111",
        messageId: 11,
        sentAt: "2026-06-11T10:04:00.000Z",
      },
    ]);
  });
});

import { describe, expect, it, beforeEach, vi } from "vitest";
import type { PumpEpisode } from "@screener/pump-detector";
import { createMemoryDbClient, PumpRepository } from "@screener/db";
import {
  buildCommandReplyKeyboard,
  formatAboutMessage,
  formatMonitorRunsMessage,
  formatPumpAlertMessage,
  formatPumpStatsMessages,
  formatStartMessage,
  formatEpisodeStatsMessages,
  formatEpisodeVoteStats,
  formatVotedEpisodeAlertMessage,
  formatDumpStatsMessages,
  normalizeTelegramChatId,
  sendEpisodeAlerts,
  sendTelegramMessage,
  sendTelegramPhoto,
  editMessageCaption,
  editMessageText,
} from "./telegram.js";
import { buildClassificationKeyboard } from "./telegram-callback.js";

function samplePump(coin: string, startMs: number, peakScore: number): PumpEpisode {
  return {
    coin,
    type: "pump",
    startMs,
    endMs: startMs + 300_000,
    durationMinutes: 5,
    peakScore,
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

function sampleDump(coin: string, startMs: number, peakScore: number): PumpEpisode {
  return {
    ...samplePump(coin, startMs, peakScore),
    type: "dump",
    dominantPhase: "distribution_or_fade",
  };
}

function mockTelegramSuccess(startMessageId = 100) {
  let nextMessageId = startMessageId;
  return vi.fn().mockImplementation(() =>
    Promise.resolve({
      ok: true,
      json: async () => ({
        ok: true,
        result: { message_id: nextMessageId++ },
      }),
    }),
  );
}

describe("PumpRepository list + telegram formatting", () => {
  let repo: PumpRepository;

  beforeEach(async () => {
    const client = createMemoryDbClient();
    repo = new PumpRepository(client);
    await repo.applySchema();
  });

  it("sorts newest first and filters by score", async () => {
    await repo.upsertPumpEpisodes([
      samplePump("OLD/USDT", Date.parse("2026-06-05T10:00:00.000Z"), 90),
      samplePump("NEW/USDT", Date.parse("2026-06-06T10:00:00.000Z"), 85),
      samplePump("LOW/USDT", Date.parse("2026-06-06T11:00:00.000Z"), 80),
    ]);

    const pumps = await repo.listStoredPumps({ minScore: 80 });
    expect(pumps.map((p) => p.coin)).toEqual(["NEW/USDT", "OLD/USDT"]);
    expect(pumps.every((p) => p.peakScore > 80)).toBe(true);
  });

  it("formats one alert message per pump with classification keyboard", async () => {
    const { newPumps } = await repo.upsertPumpEpisodes([
      samplePump("WLD/USDT", Date.parse("2026-06-07T00:50:00.000Z"), 100),
    ]);
    const pump = newPumps[0]!;
    const message = formatPumpAlertMessage(pump);
    expect(message).toContain("New pump detected");
    expect(message).toContain("WLD/USDT");
    const keyboard = buildClassificationKeyboard(pump.index);
    expect(keyboard.inline_keyboard[0]).toHaveLength(3);
  });

  it("shows compact vote stats only after a vote is submitted", async () => {
    const { newPumps } = await repo.upsertPumpEpisodes([
      samplePump("WLD/USDT", Date.parse("2026-06-07T00:50:00.000Z"), 100),
    ]);
    const episode = newPumps[0]!;
    const unvotedMessage = formatVotedEpisodeAlertMessage(episode);
    const votedMessage = formatVotedEpisodeAlertMessage(episode, {
      pump: 2,
      dump: 1,
      none: 0,
    });

    expect(formatEpisodeVoteStats({ pump: 2, dump: 1, none: 0 })).toBe(
      "Votes: 📈 2 · 📉 1 · ⚪ 0",
    );
    expect(unvotedMessage).toContain("New pump detected");
    expect(unvotedMessage).not.toContain("Votes:");
    expect(votedMessage).toContain("Votes: 📈 2 · 📉 1 · ⚪ 0");
  });
});

describe("buildCommandReplyKeyboard", () => {
  it("exposes public commands as persistent reply buttons", () => {
    const keyboard = buildCommandReplyKeyboard();
    expect(keyboard.keyboard).toEqual([
      [{ text: "/stats" }, { text: "/runs" }],
      [{ text: "/about" }],
    ]);
    expect(keyboard.resize_keyboard).toBe(true);
    expect(keyboard.is_persistent).toBe(true);
  });
});

describe("formatAboutMessage", () => {
  it("includes project contact and repository link", () => {
    const message = formatAboutMessage();
    expect(message).toContain("About Pump &amp; Dump Crypto Screener");
    expect(message).toContain("aleksent@yahoo.com");
    expect(message).toContain("https://github.com/aleks-ent/pump-dump-crypto-screener");
    expect(message).toContain("aleks-ent/pump-dump-crypto-screener");
  });
});

describe("formatStartMessage", () => {
  it("introduces the bot and explains the public commands", () => {
    const message = formatStartMessage();
    expect(message).toContain("Pump &amp; Dump Crypto Screener");
    expect(message).toContain("Binance and Bybit");
    expect(message).toContain("/stats");
    expect(message).toContain("/runs");
    expect(message).toContain("/about");
    expect(message).toContain("/stop");
    expect(message).toContain("subscribed");
    expect(message).toContain("aleksent@yahoo.com");
    expect(message).toContain("not financial advice");
  });
});

describe("normalizeTelegramChatId", () => {
  it("normalizes valid private and group chat IDs", () => {
    expect(normalizeTelegramChatId(" 36772199 ")).toBe("36772199");
    expect(normalizeTelegramChatId(-1001234567890)).toBe("-1001234567890");
  });

  it("rejects malformed or unsafe chat IDs", () => {
    expect(normalizeTelegramChatId("friend")).toBeNull();
    expect(normalizeTelegramChatId(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });
});

describe("formatMonitorRunsMessage", () => {
  it("returns empty-state message", () => {
    expect(formatMonitorRunsMessage([])).toBe(
      "<b>Monitor runs</b>\nNo runs recorded yet.",
    );
  });

  it("formats completed, failed, and running runs", () => {
    const message = formatMonitorRunsMessage([
      {
        id: 3,
        startedAt: "2026-06-08T14:00:00.000Z",
        endedAt: null,
        newPumpsCount: null,
      },
      {
        id: 2,
        startedAt: "2026-06-08T13:00:00.000Z",
        endedAt: "2026-06-08T13:42:00.000Z",
        newPumpsCount: 2,
      },
      {
        id: 1,
        startedAt: "2026-06-08T12:00:00.000Z",
        endedAt: "2026-06-08T12:05:00.000Z",
        newPumpsCount: null,
      },
    ]);

    expect(message).toContain("<b>Monitor runs</b> · last 5");
    expect(message.indexOf("#3")).toBeLessThan(message.indexOf("#2"));
    expect(message).toContain("#3</b> · running");
    expect(message).toContain("#2</b> · 2 new pumps");
    expect(message).toContain("#1</b> · failed");
    expect(message).toContain("Finished: 2026-06-08 13:42 UTC (42m)");
  });
});

describe("formatPumpStatsMessages", () => {
  it("returns empty-state message", () => {
    expect(formatPumpStatsMessages([], 80)).toEqual([
      "No pumps with score &gt; 80 stored yet.",
    ]);
  });

  it("orders recent first in output", async () => {
    const client = createMemoryDbClient();
    const repo = new PumpRepository(client);
    await repo.applySchema();
    await repo.upsertPumpEpisodes([
      samplePump("OLD/USDT", Date.parse("2026-06-05T10:00:00.000Z"), 90),
      samplePump("NEW/USDT", Date.parse("2026-06-06T10:00:00.000Z"), 85),
    ]);
    const pumps = await repo.listStoredPumps({ minScore: 80, limit: 5 });
    const message = formatPumpStatsMessages(pumps, 80)[0] ?? "";
    expect(message).toContain("<b>Pumps</b> · score &gt; 80 · last 5");
    expect(message.indexOf("NEW/USDT")).toBeLessThan(message.indexOf("OLD/USDT"));
  });
});

describe("formatDumpStatsMessages", () => {
  it("returns empty-state message", () => {
    expect(formatDumpStatsMessages([], 55)).toEqual(["No dumps with score &gt; 55 in index."]);
  });
});

describe("formatEpisodeStatsMessages", () => {
  it("returns combined empty-state when both lists are empty", () => {
    expect(formatEpisodeStatsMessages([], [], 80, 55)).toEqual([
      "No pumps (&gt; 80) or dumps (&gt; 55) in index.",
    ]);
  });

  it("includes pump and dump sections", async () => {
    const client = createMemoryDbClient();
    const repo = new PumpRepository(client);
    await repo.applySchema();
    await repo.upsertPumpEpisodes([
      samplePump("BTC/USDT", Date.parse("2026-06-06T10:00:00.000Z"), 90),
      sampleDump("ETH/USDT", Date.parse("2026-06-06T11:00:00.000Z"), 60),
    ]);
    const pumps = await repo.listStoredPumps({ minScore: 80, episodeType: "pump" });
    const dumps = await repo.listStoredPumps({ minScore: 55, episodeType: "dump" });
    const messages = formatEpisodeStatsMessages(pumps, dumps, 80, 55);
    expect(messages.join("\n")).toContain("<b>Pumps</b>");
    expect(messages.join("\n")).toContain("<b>Dumps</b>");
    expect(messages.join("\n")).toContain("BTC/USDT");
    expect(messages.join("\n")).toContain("ETH/USDT");
  });
});

describe("Telegram message delivery", () => {
  it("returns the sent message id and disables link previews", async () => {
    const fetchMock = mockTelegramSuccess(42);
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(
        sendTelegramMessage(
          { botToken: "token", chatId: "public-user" },
          "<a href=\"https://example.com/chart\">TradingView chart</a>",
        ),
      ).resolves.toBe(42);
    } finally {
      vi.unstubAllGlobals();
    }

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(body.link_preview_options).toEqual({ is_disabled: true });
    expect(body).not.toHaveProperty("disable_web_page_preview");
  });

  it("uploads a generated PNG using Telegram sendPhoto multipart form data", async () => {
    const fetchMock = mockTelegramSuccess(77);
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(
        sendTelegramPhoto(
          { botToken: "token", chatId: "public-user" },
          {
            buffer: Buffer.from([137, 80, 78, 71]),
            filename: "FUEL-USDT-5m.png",
          },
          "<b>New pump detected</b>",
          { replyMarkup: buildClassificationKeyboard("fuel-event") },
        ),
      ).resolves.toBe(77);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/sendPhoto");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toBeUndefined();
    const form = init.body as FormData;
    expect(form.get("chat_id")).toBe("public-user");
    expect(form.get("caption")).toBe("<b>New pump detected</b>");
    expect(form.get("parse_mode")).toBe("HTML");
    expect(JSON.parse(String(form.get("reply_markup")))).toEqual(
      buildClassificationKeyboard("fuel-event"),
    );
    const photo = form.get("photo") as File;
    expect(photo.name).toBe("FUEL-USDT-5m.png");
    expect(photo.type).toBe("image/png");
  });

  it("disables link previews when editing messages", async () => {
    const fetchMock = mockTelegramSuccess();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await editMessageText(
        { botToken: "token" },
        "public-user",
        42,
        "<a href=\"https://example.com/chart\">TradingView chart</a>",
      );
    } finally {
      vi.unstubAllGlobals();
    }

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(body.link_preview_options).toEqual({ is_disabled: true });
    expect(body).not.toHaveProperty("disable_web_page_preview");
  });

  it("edits alert captions and preserves their voting keyboard", async () => {
    const fetchMock = mockTelegramSuccess();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await editMessageCaption(
        { botToken: "token" },
        "public-user",
        42,
        "Votes: 📈 1 · 📉 0 · ⚪ 0",
        { replyMarkup: buildClassificationKeyboard("fuel-event") },
      );
    } finally {
      vi.unstubAllGlobals();
    }

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/editMessageCaption");
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(body.caption).toBe("Votes: 📈 1 · 📉 0 · ⚪ 0");
    expect(body.reply_markup).toEqual(buildClassificationKeyboard("fuel-event"));
    expect(body).not.toHaveProperty("link_preview_options");
  });

  it("adds voting buttons for every alert recipient", async () => {
    const client = createMemoryDbClient();
    const repo = new PumpRepository(client);
    await repo.applySchema();
    const { newPumps } = await repo.upsertPumpEpisodes([
      samplePump("WLD/USDT", Date.parse("2026-06-07T00:50:00.000Z"), 100),
    ]);
    const pump = newPumps[0]!;
    const fetchMock = mockTelegramSuccess();
    vi.stubGlobal("fetch", fetchMock);

    try {
      const publicAlerts = await sendEpisodeAlerts(
        { botToken: "token", chatId: "public-user" },
        [pump],
        [],
      );
      const adminAlerts = await sendEpisodeAlerts(
        { botToken: "token", chatId: "admin-user" },
        [pump],
        [],
      );
      expect(publicAlerts).toEqual([
        {
          episodeId: pump.index,
          chatId: "public-user",
          messageId: 100,
          messageKind: "text",
        },
      ]);
      expect(adminAlerts).toEqual([
        {
          episodeId: pump.index,
          chatId: "admin-user",
          messageId: 101,
          messageKind: "text",
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }

    const publicBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as Record<string, unknown>;
    const adminBody = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(publicBody.reply_markup).toEqual(buildClassificationKeyboard(pump.index));
    expect(adminBody.reply_markup).toEqual(buildClassificationKeyboard(pump.index));
    expect(String(publicBody.text)).not.toContain("Votes:");
  });

  it("sends and records one chart message with alert caption and voting buttons", async () => {
    const client = createMemoryDbClient();
    const repo = new PumpRepository(client);
    await repo.applySchema();
    const { newPumps } = await repo.upsertPumpEpisodes([
      samplePump("FUEL/USDT", Date.parse("2026-06-07T00:50:00.000Z"), 96),
    ]);
    const pump = newPumps[0]!;
    const fetchMock = mockTelegramSuccess(500);
    const onSent = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(
        sendEpisodeAlerts(
          { botToken: "token", chatId: "public-user" },
          [pump],
          [],
          {
            chartImagesByEpisode: new Map([
              [
                pump.index,
                {
                  buffer: Buffer.from([137, 80, 78, 71]),
                  filename: "FUEL-USDT-5m.png",
                },
              ],
            ]),
            onSent,
          },
        ),
      ).resolves.toEqual([
        {
          episodeId: pump.index,
          chatId: "public-user",
          messageId: 500,
          messageKind: "photo",
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/sendPhoto");
    const form = (fetchMock.mock.calls[0]?.[1] as RequestInit).body as FormData;
    expect(String(form.get("caption"))).toContain("<b>New pump detected</b>");
    expect(String(form.get("caption"))).toContain("FUEL/USDT");
    expect(JSON.parse(String(form.get("reply_markup")))).toEqual(
      buildClassificationKeyboard(pump.index),
    );
    expect(onSent).toHaveBeenCalledWith({
      episodeId: pump.index,
      chatId: "public-user",
      messageId: 500,
      messageKind: "photo",
    });
  });

  it("falls back to one text alert when the chart upload fails", async () => {
    const client = createMemoryDbClient();
    const repo = new PumpRepository(client);
    await repo.applySchema();
    const { newPumps } = await repo.upsertPumpEpisodes([
      samplePump("FUEL/USDT", Date.parse("2026-06-07T00:50:00.000Z"), 96),
    ]);
    const pump = newPumps[0]!;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error_code: 429, description: "Too Many Requests" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 900 } }),
      });
    const onChartError = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(
        sendEpisodeAlerts(
          { botToken: "token", chatId: "public-user" },
          [pump],
          [],
          {
            chartImagesByEpisode: new Map([
              [
                pump.index,
                {
                  buffer: Buffer.from([137, 80, 78, 71]),
                  filename: "FUEL-USDT-5m.png",
                },
              ],
            ]),
            onChartError,
          },
        ),
      ).resolves.toEqual([
        {
          episodeId: pump.index,
          chatId: "public-user",
          messageId: 900,
          messageKind: "text",
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(onChartError).toHaveBeenCalledWith(
      pump,
      expect.objectContaining({ method: "sendPhoto", errorCode: 429 }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/sendPhoto");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/sendMessage");
  });

  it("sends every event individually even above the old detail limit", async () => {
    const client = createMemoryDbClient();
    const repo = new PumpRepository(client);
    await repo.applySchema();
    const { newPumps } = await repo.upsertPumpEpisodes(
      Array.from({ length: 6 }, (_value, index) =>
        samplePump(
          `P${index}/USDT`,
          Date.parse("2026-06-07T00:00:00.000Z") + index * 300_000,
          100,
        ),
      ),
    );
    const fetchMock = mockTelegramSuccess();
    vi.stubGlobal("fetch", fetchMock);

    try {
      const sent = await sendEpisodeAlerts(
        { botToken: "token", chatId: "public-user" },
        newPumps,
        [],
      );
      expect(sent).toHaveLength(6);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>,
    );
    expect(bodies.every((body) => !String(body.text).includes("Votes:"))).toBe(true);
    expect(bodies.some((body) => String(body.text).includes("Many new episodes"))).toBe(false);
  });
});

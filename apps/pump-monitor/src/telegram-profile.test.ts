import { describe, expect, it, vi } from "vitest";
import {
  fetchTelegramSubscriberData,
  serializeTelegramSubscriberData,
} from "./telegram.js";

describe("Telegram subscriber data", () => {
  it("serializes the getChat result with a top-level profile description", () => {
    const data = serializeTelegramSubscriberData(
      {
        id: 12345,
        type: "private",
        username: "alex",
        bio: "Momentum scanner alerts",
      },
      "2026-06-11T10:00:00.000Z",
    );

    expect(JSON.parse(data)).toEqual({
      source: "telegram.getChat",
      captured_at: "2026-06-11T10:00:00.000Z",
      description: "Momentum scanner alerts",
      chat: {
        id: 12345,
        type: "private",
        username: "alex",
        bio: "Momentum scanner alerts",
      },
    });
  });

  it("fetches subscriber data from Telegram getChat", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: {
          id: 12345,
          type: "private",
          first_name: "Alex",
          bio: "Crypto alerts",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const data = await fetchTelegramSubscriberData(
        { botToken: "token" },
        "12345",
        "2026-06-11T10:00:00.000Z",
      );

      expect(JSON.parse(data)).toEqual({
        source: "telegram.getChat",
        captured_at: "2026-06-11T10:00:00.000Z",
        description: "Crypto alerts",
        chat: {
          id: 12345,
          type: "private",
          first_name: "Alex",
          bio: "Crypto alerts",
        },
      });
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        "https://api.telegram.org/bottoken/getChat",
      );
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: "12345" }),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

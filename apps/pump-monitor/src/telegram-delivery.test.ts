import { describe, expect, it, vi } from "vitest";
import { TelegramApiError } from "./telegram.js";
import {
  cleanupUnavailableTelegramRecipient,
  ensureClassifierTelegramRecipient,
  ensureReadOnlyTelegramRecipient,
} from "./telegram-delivery.js";

describe("Telegram recipient cleanup", () => {
  it("persists the classifier chat as a subscriber", async () => {
    const subscribe = vi.fn().mockResolvedValue(true);
    expect(
      await ensureClassifierTelegramRecipient(
        { subscribe },
        "36772199",
        "2026-06-11T10:00:00.000Z",
      ),
    ).toBe(true);
    expect(subscribe).toHaveBeenCalledWith(
      "36772199",
      "2026-06-11T10:00:00.000Z",
    );
  });

  it("persists the public destination without voting capability", async () => {
    const subscribe = vi.fn().mockResolvedValue(true);
    expect(
      await ensureReadOnlyTelegramRecipient(
        { subscribe },
        "-10098765",
        "2026-06-11T10:00:00.000Z",
      ),
    ).toBe(true);
    expect(subscribe).toHaveBeenCalledWith(
      "-10098765",
      "2026-06-11T10:00:00.000Z",
      null,
      false,
    );
  });

  it.each([
    [403, "Forbidden: bot was blocked by the user"],
    [403, "Forbidden: user is deactivated"],
    [403, "Forbidden: bot was kicked from the group chat"],
    [400, "Bad Request: chat not found"],
  ])("unsubscribes a permanently unavailable recipient", async (code, description) => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const result = await cleanupUnavailableTelegramRecipient(
      { unsubscribe },
      "12345",
      new TelegramApiError("sendMessage", code, code, description),
    );

    expect(result).toEqual({ permanent: true, unsubscribed: true });
    expect(unsubscribe).toHaveBeenCalledWith("12345");
  });

  it.each([
    new TelegramApiError("sendMessage", 429, 429, "Too Many Requests"),
    new TelegramApiError("sendMessage", 500, 500, "Internal Server Error"),
    new TypeError("fetch failed"),
  ])("keeps a recipient after a temporary failure", async (error) => {
    const unsubscribe = vi.fn();
    const result = await cleanupUnavailableTelegramRecipient(
      { unsubscribe },
      "12345",
      error,
    );

    expect(result).toEqual({ permanent: false, unsubscribed: false });
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("does not throw when subscriber cleanup fails", async () => {
    const cleanupError = new Error("database unavailable");
    const result = await cleanupUnavailableTelegramRecipient(
      { unsubscribe: vi.fn().mockRejectedValue(cleanupError) },
      "12345",
      new TelegramApiError(
        "sendMessage",
        403,
        403,
        "Forbidden: bot was blocked by the user",
      ),
    );

    expect(result).toEqual({
      permanent: true,
      unsubscribed: false,
      cleanupError,
    });
  });
});

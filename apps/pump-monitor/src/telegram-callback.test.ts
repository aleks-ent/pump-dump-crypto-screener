import { describe, expect, it } from "vitest";
import {
  buildClassificationKeyboard,
  encodeClassificationCallback,
  parseClassificationCallback,
} from "./telegram-callback.js";

describe("telegram classification callbacks", () => {
  const pumpId = "WLD/USDT|2026-06-07T00:50:00.000Z";

  it("round-trips pump id through callback_data", () => {
    for (const classification of ["pump", "dump", "none"] as const) {
      const data = encodeClassificationCallback(classification, pumpId);
      expect(parseClassificationCallback(data)).toEqual({ classification, pumpId });
    }
  });

  it("fits Telegram callback_data byte limit for long coin names", () => {
    const longId = "1000LUNC/USDT|2026-06-07T01:15:00.000Z";
    const data = encodeClassificationCallback("dump", longId);
    expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
  });

  it("builds keyboard with three buttons", () => {
    const keyboard = buildClassificationKeyboard(pumpId);
    expect(keyboard.inline_keyboard).toHaveLength(1);
    expect(keyboard.inline_keyboard[0]).toHaveLength(3);
    expect(keyboard.inline_keyboard[0]!.map((b) => b.text)).toEqual([
      "📈 Pump",
      "📉 Dump",
      "⚪ None",
    ]);
  });

  it("rejects invalid callback data", () => {
    expect(parseClassificationCallback("stats:1")).toBeNull();
    expect(parseClassificationCallback("classify:bad:id")).toBeNull();
  });
});

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addTelegramSubscriber,
  loadTelegramSubscriberIds,
  normalizeTelegramChatId,
  removeTelegramSubscriber,
  resolveTelegramAlertChatIds,
  telegramSubscribersPath,
} from "./telegram-subscribers.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "telegram-subscribers-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Telegram subscribers", () => {
  it("normalizes valid private and group chat IDs", () => {
    expect(normalizeTelegramChatId(" 36772199 ")).toBe("36772199");
    expect(normalizeTelegramChatId(-1001234567890)).toBe("-1001234567890");
  });

  it("rejects malformed or unsafe chat IDs", () => {
    expect(normalizeTelegramChatId("friend")).toBeNull();
    expect(normalizeTelegramChatId(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });

  it("adds, deduplicates, and removes subscribers", () => {
    const baseDir = createTempDir();
    expect(loadTelegramSubscriberIds(baseDir)).toEqual([]);
    expect(addTelegramSubscriber(baseDir, "12345")).toBe(true);
    expect(addTelegramSubscriber(baseDir, "12345")).toBe(false);
    expect(addTelegramSubscriber(baseDir, "-10098765")).toBe(true);
    expect(loadTelegramSubscriberIds(baseDir)).toEqual(["12345", "-10098765"]);
    expect(removeTelegramSubscriber(baseDir, "12345")).toBe(true);
    expect(removeTelegramSubscriber(baseDir, "12345")).toBe(false);
    expect(loadTelegramSubscriberIds(baseDir)).toEqual(["-10098765"]);
  });

  it("stores subscriber IDs in the reports directory", () => {
    const baseDir = createTempDir();
    addTelegramSubscriber(baseDir, "12345");
    const stored = JSON.parse(
      readFileSync(telegramSubscribersPath(baseDir), "utf-8"),
    ) as { chatIds: string[] };
    expect(stored.chatIds).toEqual(["12345"]);
  });

  it("always includes the classifier chat in alert recipients", () => {
    expect(resolveTelegramAlertChatIds("36772199", [])).toEqual(["36772199"]);
    expect(
      resolveTelegramAlertChatIds("36772199", ["12345", "36772199"]),
    ).toEqual(["36772199", "12345"]);
  });
});

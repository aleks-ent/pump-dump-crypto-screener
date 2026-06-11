import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadLegacyTelegramSubscriberIds,
  markLegacyTelegramSubscribersMigrated,
  migratedTelegramSubscribersPath,
  normalizeTelegramChatId,
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

  it("loads and deduplicates legacy subscriber IDs", () => {
    const baseDir = createTempDir();
    mkdirSync(join(baseDir, "reports"), { recursive: true });
    writeFileSync(
      telegramSubscribersPath(baseDir),
      JSON.stringify({
        chatIds: ["12345", "12345", -10098765, "invalid"],
      }),
    );
    expect(loadLegacyTelegramSubscriberIds(baseDir)).toEqual([
      "12345",
      "-10098765",
    ]);
  });

  it("marks the legacy file after migration", () => {
    const baseDir = createTempDir();
    mkdirSync(join(baseDir, "reports"), { recursive: true });
    writeFileSync(
      telegramSubscribersPath(baseDir),
      JSON.stringify({ chatIds: ["12345"] }),
    );

    markLegacyTelegramSubscribersMigrated(baseDir);

    expect(loadLegacyTelegramSubscriberIds(baseDir)).toEqual([]);
    expect(
      JSON.parse(
        readFileSync(migratedTelegramSubscribersPath(baseDir), "utf-8"),
      ),
    ).toEqual({ chatIds: ["12345"] });
  });

  it("always includes the classifier chat in alert recipients", () => {
    expect(resolveTelegramAlertChatIds("36772199", [])).toEqual(["36772199"]);
    expect(
      resolveTelegramAlertChatIds("36772199", ["12345", "36772199"]),
    ).toEqual(["36772199", "12345"]);
  });
});

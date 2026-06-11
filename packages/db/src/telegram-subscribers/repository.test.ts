import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDbClient } from "../client.js";
import { PumpRepository } from "../pumps/repository.js";
import { TelegramSubscriberRepository } from "./repository.js";

describe("TelegramSubscriberRepository", () => {
  let repo: TelegramSubscriberRepository;

  beforeEach(async () => {
    const client = createMemoryDbClient();
    await new PumpRepository(client).applySchema();
    repo = new TelegramSubscriberRepository(client);
  });

  it("subscribes each chat once and lists all subscribers", async () => {
    expect(
      await repo.subscribe("12345", "2026-06-11T10:00:00.000Z"),
    ).toBe(true);
    expect(
      await repo.subscribe("12345", "2026-06-11T10:01:00.000Z"),
    ).toBe(false);
    expect(
      await repo.subscribe("-10098765", "2026-06-11T10:02:00.000Z"),
    ).toBe(true);

    expect(await repo.listChatIds()).toEqual(["12345", "-10098765"]);
  });

  it("unsubscribes an existing chat", async () => {
    await repo.subscribe("12345", "2026-06-11T10:00:00.000Z");
    expect(await repo.unsubscribe("12345")).toBe(true);
    expect(await repo.unsubscribe("12345")).toBe(false);
    expect(await repo.listChatIds()).toEqual([]);
  });
});

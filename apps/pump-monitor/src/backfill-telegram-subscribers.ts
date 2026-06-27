import { Command } from "commander";
import {
  createDbClient,
  loadDatabaseConfig,
  PumpRepository,
} from "@screener/db";
import { backfillTelegramSubscribers } from "./telegram-subscriber-backfill.js";
import { loadTelegramConfig } from "./telegram.js";

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function normalizeForwardedArgs(argv: string[]): string[] {
  const separatorIndex = argv.indexOf("--", 2);
  if (separatorIndex === -1) return argv;
  return [...argv.slice(0, separatorIndex), ...argv.slice(separatorIndex + 1)];
}

async function main(): Promise<void> {
  const program = new Command()
    .name("backfill-telegram-subscribers")
    .description(
      "Backfill telegram_subscribers state columns and subscriber_data from Telegram getChat",
    )
    .option("--all", "refresh subscriber_data even when it is already present")
    .option("--dry-run", "show how many rows would be backfilled without writing")
    .option("--limit <n>", "maximum number of subscriber rows to fetch")
    .option("--delay-ms <n>", "delay between Telegram API calls", "100");

  program.parse(normalizeForwardedArgs(process.argv));
  const opts = program.opts<{
    all?: boolean;
    dryRun?: boolean;
    limit?: string;
    delayMs: string;
  }>();

  const limit =
    opts.limit == null
      ? undefined
      : parseNonNegativeInteger(opts.limit, "--limit");
  const delayMs = parseNonNegativeInteger(opts.delayMs, "--delay-ms");
  const telegram = await loadTelegramConfig();
  if (!telegram) {
    throw new Error(
      "Telegram is not configured. Set telegramBotToken and classifierTelegramChatId in config.js.",
    );
  }

  const client = createDbClient(await loadDatabaseConfig());
  try {
    await new PumpRepository(client).applySchema();
    const result = await backfillTelegramSubscribers(client, telegram, {
      refreshExistingData: opts.all,
      dryRun: opts.dryRun,
      limit,
      delayMs,
      log: (message) => console.error(message),
    });

    console.error(
      [
        "Telegram subscriber backfill complete:",
        `${result.candidates} candidate(s)`,
        `${result.updated} updated`,
        `${result.failed} failed`,
        `${result.normalizedSubscribed} subscribed value(s) normalized`,
        `${result.clearedActiveUnsubscribedAt} active unsubscribed_at value(s) cleared`,
      ].join(" "),
    );
  } finally {
    client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

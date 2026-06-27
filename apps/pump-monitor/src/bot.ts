#!/usr/bin/env node
import { Command } from "commander";
import { loadPumpBotConfig, runTelegramBot } from "./telegram-bot.js";

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("pump-bot")
    .description("Telegram bot for alerts and commands (/start, /stats, /runs, /about, /stop)")
    .parse(process.argv.slice(2).filter((a) => a !== "--"), { from: "user" });

  const config = await loadPumpBotConfig();
  if (!config) {
    throw new Error(
      "Telegram bot not configured. Set telegramBotToken and classifierTelegramChatId in config.js.",
    );
  }

  await runTelegramBot(config);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

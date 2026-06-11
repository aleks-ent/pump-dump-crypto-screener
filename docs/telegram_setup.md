# Telegram setup

Pump alerts (`pnpm pump:monitor`) and the interactive bot (`pnpm pump:bot`) need a
Telegram bot token and your classifier chat ID. They go in `config.js` (copy from
[`config.example.js`](../config.example.js) if you have not already).

```javascript
telegramBotToken: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
classifierTelegramChatId: "36772199",
```

Anyone who discovers the bot can use it without approval. Sending `/start`
automatically subscribes that private chat or group to new pump and dump alerts.
Subscribers can use `/stats` and `/runs`. Only `classifierTelegramChatId` can classify
episodes; that chat's alerts include **Pump | Dump | None** buttons, while other
subscribers receive alerts without those buttons.

The classifier chat always receives alerts, even before it sends `/start`. Other chats
must send `/start` to subscribe.

After deploying the schema change to the VDS, apply it to Turso once:

```bash
pnpm db:bootstrap
```

The bot and monitor also apply the schema defensively when they start. Both processes
insert `classifierTelegramChatId` into `telegram_subscribers` with
`INSERT OR IGNORE`, so it is always in the stored recipient list without duplicates.
Running `./update.sh` performs the build and `pnpm db:bootstrap` automatically before
restarting PM2.

## 1. Create a bot and get the token

1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts (display name and username ending in `bot`).
3. BotFather replies with an HTTP API token, for example:
   `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`
4. Put that value in `config.js` as `telegramBotToken`.
5. Message [@userinfobot](https://t.me/userinfobot) to get your private chat ID, then
   set it as `classifierTelegramChatId`.

Use your private chat for `classifierTelegramChatId`. If you configure a group chat,
anyone in that group who can press its classification buttons can classify alerts.

Keep the token secret. Anyone with it can control your bot.

## 2. Start the services

```bash
pnpm build
pm2 start ecosystem.config.cjs
```

The bot and monitor must both be running: the bot receives commands and button clicks,
while the monitor scans markets and broadcasts new alerts.

## 3. Subscribe and share

1. Open `t.me/<bot_username>`.
2. Press **Start** or send `/start`.
3. The chat is subscribed immediately and receives the command keyboard.
4. Share the same link with other people. No configuration change or restart is needed.

Available commands:

| Command | Action |
|---------|--------|
| `/start` | Subscribe to automatic pump and dump alerts |
| `/stats` | Show the latest detected pumps |
| `/runs` | Show recent scanner runs and status |
| `/stop` | Unsubscribe from automatic alerts; commands still work |

`/stop` does not remove `classifierTelegramChatId`; that chat is intentionally always
subscribed.

Groups work too: add the bot to a group and send `/start` there. A group is one
subscription, so `/stop` from any group member unsubscribes that group.

Subscriber chat IDs are stored in the shared Turso database and survive bot restarts
and code deployments. Existing IDs from the old
`data/market_stats/reports/telegram_subscribers.json` file are imported once
automatically.

If Telegram reports that a user blocked the bot, deactivated their account, or that a
chat no longer exists, the monitor removes that chat from the subscriber table and
continues sending to everyone else. Temporary network errors and rate limits do not
unsubscribe users.

The commands query your Turso database, so public usage increases database and Telegram
API traffic. Do not publish the bot token itself.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Bot does not reply in a group | Add the bot to the group; some groups need `/setprivacy` disabled in BotFather (`/setprivacy` → your bot → **Disable**) so it sees all messages |
| User does not receive alerts | Send `/start` in that exact private chat or group |
| User no longer wants alerts | Send `/stop`; `/stats` and `/runs` remain available |
| Classifier chat does not see buttons | Send `/start` in that chat and verify `classifierTelegramChatId` matches its chat ID |
| Alerts work, buttons do not | Run `pnpm pump:bot` alongside or after `pump:monitor` |

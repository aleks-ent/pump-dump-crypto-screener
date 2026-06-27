# Telegram setup

Pump alerts (`pnpm pump:monitor`) and the interactive bot (`pnpm pump:bot`) need a
Telegram bot token and your admin/classifier chat ID. They go in `config.js` (copy from
[`config.example.js`](../config.example.js) if you have not already).

```javascript
telegramBotToken: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
classifierTelegramChatId: "36772199",
```

Anyone who discovers the bot can use it without approval. Sending `/start`
automatically subscribes that private chat or group to new pump and dump alerts.
Subscribers can use `/stats`, `/runs`, and `/about`. Every alert includes **📈 Pump |
📉 Dump | ⚪ None** voting buttons. Each subscribed chat gets one vote per event; when
anyone votes, the bot edits every recorded alert message for that event with compact
totals like `Votes: 📈 3 · 📉 1 · ⚪ 0`.

`classifierTelegramChatId` is the always-subscribed admin chat. Its vote also updates
the legacy episode `classification` field so existing stats/history behavior remains
compatible.

The admin/classifier chat always receives alerts, even before it sends `/start`. Other chats
must send `/start` to subscribe.

After deploying the schema change to the VDS, apply it to Turso once:

```bash
pnpm db:bootstrap
```

The bot and monitor also apply the schema defensively when they start. Both processes
ensure `classifierTelegramChatId` is marked `subscribed = 1` in
`telegram_subscribers`, so it is always in the active recipient list without
duplicates. Running `./update.sh` performs the build and `pnpm db:bootstrap`
automatically before restarting PM2.

## 1. Create a bot and get the token

1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts (display name and username ending in `bot`).
3. BotFather replies with an HTTP API token, for example:
   `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`
4. Put that value in `config.js` as `telegramBotToken`.
5. Message [@userinfobot](https://t.me/userinfobot) to get your private chat ID, then
   set it as `classifierTelegramChatId`.

Use your private chat for `classifierTelegramChatId`. If you configure a group chat,
anyone in that group who can press its voting buttons controls that chat's one event
vote and, for the admin chat, the legacy classification sync.

Keep the token secret. Anyone with it can control your bot.

## 2. Start the services

```bash
pnpm build
pm2 start ecosystem.config.cjs
```

The bot and monitor must both be running: the bot receives commands and button clicks,
while the monitor scans markets, broadcasts new alerts, and records each alert message
ID so vote totals can be refreshed later.

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
| `/about` | Show project details, repository link, and contact email |
| `/stop` | Unsubscribe from automatic alerts; commands still work |

`/stop` does not remove `classifierTelegramChatId`; that chat is intentionally always
subscribed.

Groups work too: add the bot to a group and send `/start` there. A group is one
subscription and one vote per event, so `/stop` from any group member unsubscribes
that group.

Subscriber chat IDs are stored in the shared Turso database and survive bot restarts
and code deployments. `/stop` keeps the row, sets `subscribed = 0`, and records
`unsubscribed_at`; `/start` sets `subscribed = 1` again and clears
`unsubscribed_at`. When a chat sends `/start`, the bot also calls Telegram `getChat`
and stores a JSON snapshot in `subscriber_data`; the top-level `description` field is
filled from Telegram `bio` for private chats or `description` for groups when
Telegram exposes it. Existing IDs from the old
`data/market_stats/reports/telegram_subscribers.json` file are imported once
automatically with `subscriber_data = NULL`.

If Telegram reports that a user blocked the bot, deactivated their account, or that a
chat no longer exists, the monitor marks that chat unsubscribed and continues sending
to everyone else. Temporary network errors and rate limits do not unsubscribe users.

To backfill the new subscriber columns for rows already in Turso, run:

```bash
pnpm telegram:backfill-subscribers
```

The script applies the schema first, normalizes active rows, and fills missing
`subscriber_data` with Telegram `getChat`. Use `pnpm telegram:backfill-subscribers
-- --dry-run` to count rows without writing, `--all` to refresh existing snapshots,
`--limit N` for a partial run, and `--delay-ms N` to change the pause between
Telegram API calls. It cannot reconstruct rows that were deleted before subscriber
retention was added.

The commands query your Turso database, so public usage increases database and Telegram
API traffic. Do not publish the bot token itself.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Bot does not reply in a group | Add the bot to the group; some groups need `/setprivacy` disabled in BotFather (`/setprivacy` → your bot → **Disable**) so it sees all messages |
| User does not receive alerts | Send `/start` in that exact private chat or group |
| User no longer wants alerts | Send `/stop`; `/stats`, `/runs`, and `/about` remain available |
| Alert does not show voting buttons | Verify both `pnpm pump:monitor` and `pnpm pump:bot` are deployed from the voting build |
| Alerts work, buttons do not | Run `pnpm pump:bot` alongside or after `pump:monitor` |

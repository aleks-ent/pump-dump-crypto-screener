# Telegram setup

Pump alerts (`pnpm pump:monitor`) and the interactive bot (`pnpm pump:bot`) need a
Telegram bot token and a chat ID. Both go in `config.js` (copy from
[`config.example.js`](../config.example.js) if you have not already).

```javascript
telegramBotToken: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
telegramChatId: "36772199",
```

Only the configured chat can receive alerts, run `/stats` and `/runs`, and use
classification buttons. This is intentional — the bot can read and update your pump
database.

## 1. Create a bot and get the token

1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts (display name and username ending in `bot`).
3. BotFather replies with an HTTP API token, for example:
   `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`
4. Put that value in `config.js` as `telegramBotToken`.

Keep the token secret. Anyone with it can control your bot.

## 2. Choose where alerts go

Pick one:

| Destination | When to use |
|-------------|-------------|
| **Direct message** | Alerts and commands only for you |
| **Private group** | Share alerts with a small team (add the bot to the group) |

Message the bot (DM) or post in the group so Telegram creates a chat the bot can see.

## 3. Get your chat ID

Telegram uses a numeric chat ID per conversation. Personal chats are positive;
group chats are negative (e.g. `-1001234567890`).

### Option A — `getUpdates` (recommended)

With `telegramBotToken` set in `config.js` but `telegramChatId` still empty:

1. Start the bot process so it can receive messages, or just send a message to the bot
   in Telegram (`/start` or `hello`).
2. Call the Bot API (replace `YOUR_TOKEN`):

   ```bash
   curl -s "https://api.telegram.org/botYOUR_TOKEN/getUpdates" | jq .
   ```

3. In the JSON, find the latest `message.chat.id` (or `callback_query.message.chat.id`
   if you already clicked a button):

   ```json
   "chat": {
     "id": 36772199,
     "type": "private"
   }
   ```

4. Copy that number (as a string) into `config.js` as `telegramChatId`.

If the result is empty, send another message to the bot and run `getUpdates` again.

### Option B — @userinfobot (personal chat only)

For a **direct message** setup only:

1. Message [@userinfobot](https://t.me/userinfobot).
2. It replies with your user id — use that value as `telegramChatId` when the bot talks
   to you in DM.

This does not work for group chats; use Option A for groups.

## 4. Verify

```bash
# Interactive commands (/stats, /runs, classification buttons):
pnpm pump:bot

# In Telegram, send /stats or /runs to your bot or group.

# End-to-end alert (needs Turso + market data):
pnpm pump:monitor
```

If commands are ignored, check the bot log for `Ignored message from unauthorized chat`
— the ID in the log must match `telegramChatId` in `config.js`.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `getUpdates` returns `[]` | Send a new message to the bot, then retry |
| Bot does not reply in a group | Add the bot to the group; some groups need `/setprivacy` disabled in BotFather (`/setprivacy` → your bot → **Disable**) so it sees all messages |
| Wrong chat ID | Use the `chat.id` from the same chat where you want alerts, not your user id from a different context |
| Alerts work, buttons do not | Run `pnpm pump:bot` alongside or after `pump:monitor` |

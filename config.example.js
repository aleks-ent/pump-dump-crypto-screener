// Copy to config.js and fill in your values:
//   cp config.example.js config.js

export default {
  telegramBotToken: "",
  // Private chat that is always subscribed and syncs its vote to the legacy classification field.
  classifierTelegramChatId: "",
  fetch: {
    intervals: ["5m"],
  },
  database: {
    url: "",
    authToken: "",
  },
  web: {
    port: 3000,
    host: "127.0.0.1",
  },
  pump: {
    days: 5,
    minScore: 80,
    scanCache: true,
  },
};

// Copy to config.js and fill in your values:
//   cp config.example.js config.js

export default {
  telegramBotToken: "",
  // Private chat that receives classification buttons and can classify alerts.
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

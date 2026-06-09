// Copy to config.js and fill in your values:
//   cp config.example.js config.js

export default {
  telegramBotToken: "",
  telegramChatId: "",
  fetch: {
    intervals: ["5m"],
  },
  database: {
    url: "",
    authToken: "",
  },
  pump: {
    days: 5,
    minScore: 80,
    scanCache: true,
  },
};

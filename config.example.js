// Copy to config.js and fill in your values:
//   cp config.example.js config.js

export default {
  telegramBotToken: "",
  // Private chat that is always subscribed and syncs its vote to the legacy classification field.
  classifierTelegramChatId: "",
  // Optional read-only group/channel that always receives alerts without voting buttons.
  publicTelegramChatId: "",
  fetch: {
    intervals: ["1m", "5m"],
  },
  database: {
    url: "",
    authToken: "",
  },
  web: {
    port: 3000,
    host: "127.0.0.1",
    // Optional for loopback. Required before binding to a non-loopback host.
    // Prefer PUMP_REVIEW_AUTH_USERNAME / PUMP_REVIEW_AUTH_PASSWORD in production.
    reviewAuth: {
      username: "",
      password: "",
      realm: "Pump Event Review",
    },
  },
  pump: {
    days: 5,
    // Re-discover exchange listings and rebuild symbol_universe.json every 4 days.
    universeRefreshDays: 4,
    minScore: 80,
    scanCache: true,
    // Feature flag: only report pumps preceded by a calm, low-oscillation 2h period.
    requireCalmPrePump: false,
  },
};

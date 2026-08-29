CREATE TABLE IF NOT EXISTS pumps (
  id                  TEXT PRIMARY KEY NOT NULL,
  coin                TEXT NOT NULL,
  start_ms            INTEGER NOT NULL,
  start_utc           TEXT NOT NULL,
  end_ms              INTEGER NOT NULL,
  end_utc             TEXT NOT NULL,
  duration_minutes    INTEGER NOT NULL,
  peak_score          REAL NOT NULL,
  dominant_phase      TEXT NOT NULL,
  leading_exchange    TEXT NOT NULL,
  symbol_native       TEXT NOT NULL,
  instrument_type     TEXT NOT NULL,
  trading_view_url    TEXT NOT NULL,
  confirmed           INTEGER NOT NULL DEFAULT 0,
  confirmed_exchanges TEXT NOT NULL,
  event_count         INTEGER NOT NULL,
  first_seen_at       TEXT NOT NULL,
  last_seen_at        TEXT NOT NULL,
  classification      TEXT CHECK (classification IS NULL OR classification IN ('pump', 'dump', 'none')),
  episode_type        TEXT NOT NULL DEFAULT 'pump' CHECK (episode_type IN ('pump', 'dump'))
);

CREATE INDEX IF NOT EXISTS idx_pumps_start_ms ON pumps(start_ms DESC);
CREATE INDEX IF NOT EXISTS idx_pumps_peak_score ON pumps(peak_score);
CREATE INDEX IF NOT EXISTS idx_pumps_classification ON pumps(classification);
CREATE INDEX IF NOT EXISTS idx_pumps_episode_type ON pumps(episode_type);
CREATE INDEX IF NOT EXISTS idx_pumps_leading_exchange
  ON pumps(leading_exchange COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS pump_annotations (
  id         TEXT PRIMARY KEY NOT NULL,
  event_id   TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'human'
             CHECK (source IN ('human', 'ai')),
  category   TEXT NOT NULL
             CHECK (category IN (
               'wick_spike',
               'weak_pump',
               'sustained_move',
               'volume_only',
               'illiquid_noise',
               'unclear'
             )),
  confidence TEXT
             CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low')),
  comment    TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_id, source),
  FOREIGN KEY (event_id) REFERENCES pumps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pump_annotations_source_category
  ON pump_annotations(source, category);
CREATE INDEX IF NOT EXISTS idx_pump_annotations_updated_at
  ON pump_annotations(updated_at DESC);

CREATE TABLE IF NOT EXISTS monitor_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  new_pumps_count   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_monitor_runs_started_at ON monitor_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS telegram_subscribers (
  chat_id         TEXT PRIMARY KEY NOT NULL,
  subscribed_at   TEXT NOT NULL,
  subscribed      INTEGER NOT NULL DEFAULT 1 CHECK (subscribed IN (0, 1)),
  voting_enabled  INTEGER NOT NULL DEFAULT 1 CHECK (voting_enabled IN (0, 1)),
  unsubscribed_at TEXT,
  subscriber_data TEXT
);

CREATE TABLE IF NOT EXISTS telegram_subscriber_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     TEXT NOT NULL,
  event_type  TEXT NOT NULL CHECK (event_type IN ('subscribe', 'unsubscribe')),
  occurred_at TEXT NOT NULL,
  UNIQUE (chat_id, event_type, occurred_at),
  FOREIGN KEY (chat_id) REFERENCES telegram_subscribers(chat_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_telegram_subscriber_events_occurred_at
  ON telegram_subscriber_events(occurred_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS telegram_episode_votes (
  episode_id     TEXT NOT NULL,
  chat_id        TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('pump', 'dump', 'none')),
  voted_at       TEXT NOT NULL,
  PRIMARY KEY (episode_id, chat_id),
  FOREIGN KEY (episode_id) REFERENCES pumps(id) ON DELETE CASCADE,
  FOREIGN KEY (chat_id) REFERENCES telegram_subscribers(chat_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_telegram_episode_votes_episode_id
  ON telegram_episode_votes(episode_id);

CREATE TABLE IF NOT EXISTS telegram_episode_messages (
  episode_id TEXT NOT NULL,
  chat_id    TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  message_kind TEXT NOT NULL DEFAULT 'text' CHECK (message_kind IN ('text', 'photo')),
  sent_at    TEXT NOT NULL,
  PRIMARY KEY (episode_id, chat_id),
  FOREIGN KEY (episode_id) REFERENCES pumps(id) ON DELETE CASCADE,
  FOREIGN KEY (chat_id) REFERENCES telegram_subscribers(chat_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_telegram_episode_messages_episode_id
  ON telegram_episode_messages(episode_id);

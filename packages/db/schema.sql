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

CREATE TABLE IF NOT EXISTS monitor_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  new_pumps_count   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_monitor_runs_started_at ON monitor_runs(started_at DESC);

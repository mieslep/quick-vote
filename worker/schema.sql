CREATE TABLE IF NOT EXISTS polls (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  max_ranks      INTEGER NOT NULL,
  -- Longest time a booth stays open, in minutes. NULL means no limit.
  booth_minutes  INTEGER,
  -- open: voting. closed: no new votes, late ballots cast before closed_at still count. final: nothing more is accepted.
  status         TEXT NOT NULL DEFAULT 'open',
  results_public INTEGER NOT NULL DEFAULT 0,
  -- ballot: every ballot is one vote. site: each group is one vote.
  count_mode     TEXT NOT NULL DEFAULT 'ballot',
  -- first: a show of hands counts as first choices only. estimate: later choices are estimated from ranked ballots.
  hands_mode     TEXT NOT NULL DEFAULT 'first',
  booth_salt     TEXT NOT NULL,
  booth_hash     TEXT NOT NULL,
  admin_hash     TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  closed_at      INTEGER
);

CREATE TABLE IF NOT EXISTS choices (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id  TEXT NOT NULL REFERENCES polls(id),
  position INTEGER NOT NULL,
  label    TEXT NOT NULL,
  image    TEXT
);

-- A ballot holds no voter identity. client_id makes a re-sent ballot harmless.
CREATE TABLE IF NOT EXISTS ballots (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id   TEXT NOT NULL REFERENCES polls(id),
  client_id TEXT NOT NULL,
  booth_id  TEXT NOT NULL,
  booth     TEXT NOT NULL,
  ranking   TEXT NOT NULL,
  UNIQUE (poll_id, client_id)
);

-- Each booth device reports how many ballots it cast. The admin page compares this with the ballots received.
CREATE TABLE IF NOT EXISTS booth_reports (
  poll_id    TEXT NOT NULL REFERENCES polls(id),
  booth_id   TEXT NOT NULL,
  booth      TEXT NOT NULL,
  cast_total INTEGER NOT NULL DEFAULT 0,
  discarded  INTEGER NOT NULL DEFAULT 0,
  -- ranked: voters cast ranked ballots on the booth. hands: the booth enters show-of-hands totals.
  mode       TEXT NOT NULL DEFAULT 'ranked',
  start_at   INTEGER,
  end_at     INTEGER,
  PRIMARY KEY (poll_id, booth_id)
);

-- First-preference counts that the organiser enters for a group that did not use a booth.
CREATE TABLE IF NOT EXISTS manual_counts (
  poll_id TEXT NOT NULL REFERENCES polls(id),
  booth   TEXT NOT NULL,
  counts  TEXT NOT NULL,
  PRIMARY KEY (poll_id, booth)
);

-- Show-of-hands totals that a booth sends. One row for each booth device. A new send replaces the old row.
CREATE TABLE IF NOT EXISTS hand_counts (
  poll_id  TEXT NOT NULL REFERENCES polls(id),
  booth_id TEXT NOT NULL,
  booth    TEXT NOT NULL,
  counts   TEXT NOT NULL,
  total    INTEGER NOT NULL,
  cast_at  INTEGER NOT NULL,
  PRIMARY KEY (poll_id, booth_id)
);

CREATE INDEX IF NOT EXISTS idx_choices_poll ON choices(poll_id);
CREATE INDEX IF NOT EXISTS idx_ballots_poll ON ballots(poll_id);

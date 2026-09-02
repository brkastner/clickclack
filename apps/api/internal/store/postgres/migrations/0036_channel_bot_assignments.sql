CREATE TABLE channel_bot_assignments (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  bot_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (channel_id)
);

CREATE INDEX idx_channel_bot_assignments_bot_user
ON channel_bot_assignments(bot_user_id, channel_id);

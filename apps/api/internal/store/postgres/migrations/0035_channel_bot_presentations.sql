CREATE TABLE channel_bot_presentations (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  bot_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, bot_user_id)
);

CREATE INDEX idx_channel_bot_presentations_bot_user
ON channel_bot_presentations(bot_user_id, channel_id);

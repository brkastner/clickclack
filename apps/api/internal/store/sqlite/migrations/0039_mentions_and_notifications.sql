ALTER TABLE events ADD COLUMN mentioned_user_ids TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS channel_notification_settings (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preference TEXT NOT NULL DEFAULT 'all' CHECK (preference IN ('all', 'mentions', 'muted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_notification_settings_user
  ON channel_notification_settings(user_id, channel_id);

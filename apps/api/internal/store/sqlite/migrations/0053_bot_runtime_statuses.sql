CREATE TABLE bot_runtime_statuses (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL DEFAULT '',
  direct_conversation_id TEXT NOT NULL DEFAULT '',
  bot_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  runtime TEXT NOT NULL,
  model_provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  fast_mode INTEGER,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, channel_id, direct_conversation_id, bot_user_id),
  CHECK ((channel_id <> '' AND direct_conversation_id = '') OR (channel_id = '' AND direct_conversation_id <> '')),
  CHECK (fast_mode IS NULL OR fast_mode IN (0, 1))
);

CREATE INDEX bot_runtime_statuses_target_idx
  ON bot_runtime_statuses (workspace_id, channel_id, direct_conversation_id, expires_at);

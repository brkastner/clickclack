-- Keep the most recently updated presentation per channel, since assignments
-- allow a single bot per channel.
INSERT INTO channel_bot_assignments (channel_id, bot_user_id, updated_by, updated_at)
SELECT p.channel_id, p.bot_user_id, p.updated_by, p.updated_at
FROM channel_bot_presentations p
WHERE p.rowid = (
  SELECT q.rowid FROM channel_bot_presentations q
  WHERE q.channel_id = p.channel_id
  ORDER BY q.updated_at DESC, q.bot_user_id ASC
  LIMIT 1
)
ON CONFLICT(channel_id) DO NOTHING;

DROP TABLE channel_bot_presentations;

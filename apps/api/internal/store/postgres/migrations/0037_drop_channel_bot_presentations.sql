-- Keep the most recently updated presentation per channel, since assignments
-- allow a single bot per channel.
INSERT INTO channel_bot_assignments (channel_id, bot_user_id, updated_by, updated_at)
SELECT DISTINCT ON (channel_id) channel_id, bot_user_id, updated_by, updated_at
FROM channel_bot_presentations
ORDER BY channel_id, updated_at DESC, bot_user_id ASC
ON CONFLICT(channel_id) DO NOTHING;

DROP TABLE channel_bot_presentations;

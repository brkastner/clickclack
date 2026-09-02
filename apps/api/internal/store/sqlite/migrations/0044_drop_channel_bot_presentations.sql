INSERT INTO channel_bot_assignments (channel_id, bot_user_id, updated_by, updated_at)
SELECT channel_id, bot_user_id, updated_by, updated_at
FROM channel_bot_presentations;

DROP TABLE channel_bot_presentations;

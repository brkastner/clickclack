ALTER TABLE gallery_sessions ADD COLUMN retain_until BIGINT NOT NULL DEFAULT 0;
UPDATE gallery_sessions SET retain_until = COALESCE(CAST(data_json::jsonb->>'expires_at' AS BIGINT), 0) + 86400;
CREATE INDEX gallery_sessions_retention ON gallery_sessions(retain_until, id);
CREATE INDEX gallery_requests_session ON gallery_requests(session_id);

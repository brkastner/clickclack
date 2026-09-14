
CREATE TABLE gallery_capabilities (
 installation_id TEXT PRIMARY KEY REFERENCES app_installations(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL,
 token_id TEXT NOT NULL,
 generation TEXT NOT NULL,
 descriptors_json TEXT NOT NULL
);
CREATE TABLE gallery_sessions (
 id TEXT PRIMARY KEY,
 version BIGINT NOT NULL,
 data_json TEXT NOT NULL
);
CREATE TABLE gallery_requests (
 id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL REFERENCES gallery_sessions(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,
 digest TEXT NOT NULL,
 envelope_json TEXT NOT NULL,
 data_json TEXT NOT NULL
);
CREATE TABLE gallery_outbox (
 request_id TEXT PRIMARY KEY REFERENCES gallery_requests(id) ON DELETE CASCADE,
 due_at BIGINT NOT NULL,
 attempts BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX gallery_outbox_due ON gallery_outbox(due_at);

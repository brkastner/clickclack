CREATE TABLE workflow_run_snapshots (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL DEFAULT '',
    direct_conversation_id TEXT NOT NULL DEFAULT '',
    producer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    session_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    revision BIGINT NOT NULL CHECK (revision >= 0),
    digest TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((channel_id <> '' AND direct_conversation_id = '') OR (channel_id = '' AND direct_conversation_id <> '')),
    UNIQUE (workspace_id, channel_id, direct_conversation_id, producer_id, provider, session_id, run_id)
);
CREATE INDEX workflow_run_snapshot_page ON workflow_run_snapshots (workspace_id, channel_id, direct_conversation_id, id DESC);

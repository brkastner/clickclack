CREATE INDEX IF NOT EXISTS idx_messages_direct_recency
ON messages(direct_conversation_id, created_at DESC)
WHERE direct_conversation_id IS NOT NULL;

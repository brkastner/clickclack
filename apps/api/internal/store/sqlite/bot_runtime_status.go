package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/openclaw/clickclack/apps/api/internal/store"
	"github.com/openclaw/clickclack/apps/api/internal/store/sqlite/storedb"
)

func sqliteRuntimeStatus(row storedb.BotRuntimeStatus) store.BotRuntimeStatus {
	var fast *bool
	if row.FastMode.Valid {
		value := row.FastMode.Int64 != 0
		fast = &value
	}
	return store.BotRuntimeStatus{WorkspaceID: row.WorkspaceID, ChannelID: row.ChannelID, DirectConversationID: row.DirectConversationID, BotUserID: row.BotUserID, BotRuntimeStatusSnapshot: store.BotRuntimeStatusSnapshot{Runtime: row.Runtime, ModelProvider: row.ModelProvider, ModelID: row.ModelID, Reasoning: row.Reasoning, FastMode: fast}, UpdatedAt: row.UpdatedAt, ExpiresAt: row.ExpiresAt}
}

func (s *Store) PublishBotRuntimeStatus(ctx context.Context, in store.PublishBotRuntimeStatusInput) (store.BotRuntimeStatus, error) {
	var empty store.BotRuntimeStatus
	if err := in.Snapshot.Validate(); err != nil {
		return empty, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return empty, err
	}
	defer func() { _ = tx.Rollback() }()
	if err = authorizeWorkflowTargetTx(ctx, tx, in.WorkspaceID, in.ChannelID, in.DirectConversationID, in.BotUserID, false); err != nil {
		return empty, err
	}
	at := now()
	expires := time.Now().UTC().Add(store.BotRuntimeStatusTTLSeconds * time.Second).Format(time.RFC3339Nano)
	var fast sql.NullInt64
	if in.Snapshot.FastMode != nil {
		fast = sql.NullInt64{Int64: int64(boolToInt(*in.Snapshot.FastMode)), Valid: true}
	}
	q := s.q.WithTx(tx)
	if err = q.UpsertBotRuntimeStatus(ctx, storedb.UpsertBotRuntimeStatusParams{WorkspaceID: in.WorkspaceID, ChannelID: in.ChannelID, DirectConversationID: in.DirectConversationID, BotUserID: in.BotUserID, Runtime: in.Snapshot.Runtime, ModelProvider: in.Snapshot.ModelProvider, ModelID: in.Snapshot.ModelID, Reasoning: in.Snapshot.Reasoning, FastMode: fast, UpdatedAt: at, ExpiresAt: expires}); err != nil {
		return empty, err
	}
	row, err := q.GetBotRuntimeStatus(ctx, storedb.GetBotRuntimeStatusParams{WorkspaceID: in.WorkspaceID, ChannelID: in.ChannelID, DirectConversationID: in.DirectConversationID, BotUserID: in.BotUserID})
	if err != nil {
		return empty, err
	}
	if err = tx.Commit(); err != nil {
		return empty, err
	}
	return sqliteRuntimeStatus(row), nil
}

func (s *Store) ListBotRuntimeStatuses(ctx context.Context, workspaceID, channelID, dmID, requesterID string) ([]store.BotRuntimeStatus, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if err = authorizeWorkflowTargetTx(ctx, tx, workspaceID, channelID, dmID, requesterID, false); err != nil {
		return nil, err
	}
	rows, err := s.q.WithTx(tx).ListBotRuntimeStatuses(ctx, storedb.ListBotRuntimeStatusesParams{WorkspaceID: workspaceID, ChannelID: channelID, DirectConversationID: dmID})
	if err != nil {
		return nil, err
	}
	out := make([]store.BotRuntimeStatus, 0, len(rows))
	for _, row := range rows {
		out = append(out, sqliteRuntimeStatus(row))
	}
	return out, tx.Commit()
}

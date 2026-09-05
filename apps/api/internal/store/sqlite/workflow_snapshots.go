package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/openclaw/clickclack/apps/api/internal/store"
	"github.com/openclaw/clickclack/apps/api/internal/store/sqlite/storedb"
)

// authorizeWorkflowTargetTx resolves the target inside the same transaction as
// storage; caller-supplied workspace IDs cannot cross a conversation boundary.
func authorizeWorkflowTargetTx(ctx context.Context, tx *sql.Tx, workspaceID, channelID, dmID, userID string, write bool) error {
	if workspaceID == "" || (channelID == "") == (dmID == "") {
		return errors.New("workflow snapshot requires one target")
	}
	q := storedb.New(tx)
	var actual string
	var err error
	if channelID != "" {
		actual, err = q.GetChannelWorkspace(ctx, channelID)
	} else {
		actual, err = q.GetDirectConversationWorkspace(ctx, dmID)
	}
	if err != nil {
		return err
	}
	if actual != workspaceID {
		return errors.New("workflow target is not in workspace")
	}
	if err = requireMembershipTx(ctx, tx, workspaceID, userID); err != nil {
		return err
	}
	if channelID != "" {
		if err = requireGuestChannelAccessTx(ctx, tx, workspaceID, channelID, userID); err != nil {
			return err
		}
		if write {
			return requireCanPostTx(ctx, tx, workspaceID, channelID, userID)
		}
		return nil
	}
	if err = requireDirectAccessTx(ctx, tx, dmID, userID); err != nil {
		return err
	}
	if write {
		if err = requireCanSendDirectTx(ctx, tx, workspaceID, userID); err != nil {
			return err
		}
		return requireDirectActivePeerTx(ctx, tx, dmID, userID)
	}
	return nil
}
func workflowRecord(row storedb.WorkflowRunSnapshot) (store.WorkflowRunRecord, error) {
	record := store.WorkflowRunRecord{ID: row.ID, WorkspaceID: row.WorkspaceID, ChannelID: row.ChannelID, DirectConversationID: row.DirectConversationID, ProducerID: row.ProducerID, UpdatedAt: row.UpdatedAt}
	err := json.Unmarshal([]byte(row.SnapshotJson), &record.Snapshot)
	return record, err
}
func (s *Store) PublishWorkflowSnapshot(ctx context.Context, in store.PublishWorkflowSnapshotInput) (store.WorkflowRunRecord, bool, error) {
	var empty store.WorkflowRunRecord
	payload, digest, err := store.CanonicalWorkflowSnapshot(in.Snapshot)
	if err != nil {
		return empty, false, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return empty, false, err
	}
	defer func() { _ = tx.Rollback() }() // Cleanup only; commit/read errors are returned below.
	if err = authorizeWorkflowTargetTx(ctx, tx, in.WorkspaceID, in.ChannelID, in.DirectConversationID, in.ProducerID, true); err != nil {
		return empty, false, err
	}
	q := s.q.WithTx(tx)
	source := in.Snapshot.Source
	at := now()
	changed, err := q.UpsertWorkflowSnapshot(ctx, storedb.UpsertWorkflowSnapshotParams{ID: newID("wfr"), WorkspaceID: in.WorkspaceID, ChannelID: in.ChannelID, DirectConversationID: in.DirectConversationID, ProducerID: in.ProducerID, Provider: source.Provider, SessionID: source.SessionID, RunID: source.RunID, Revision: source.Revision, Digest: digest, SnapshotJson: payload, CreatedAt: at, UpdatedAt: at})
	if err != nil {
		return empty, false, err
	}
	row, err := q.GetWorkflowSnapshot(ctx, storedb.GetWorkflowSnapshotParams{WorkspaceID: in.WorkspaceID, ChannelID: in.ChannelID, DirectConversationID: in.DirectConversationID, ProducerID: in.ProducerID, Provider: source.Provider, SessionID: source.SessionID, RunID: source.RunID})
	if err != nil {
		return empty, false, err
	}
	if row.Revision == source.Revision && row.Digest != digest {
		return empty, false, store.ErrWorkflowRevisionConflict
	}
	record, err := workflowRecord(row)
	if err != nil {
		return empty, false, err
	}
	if err = tx.Commit(); err != nil {
		return empty, false, err
	}
	return record, changed > 0, nil
}
func (s *Store) ListWorkflowSnapshots(ctx context.Context, workspaceID, channelID, dmID, requesterID, cursor string, limit int) (store.WorkflowRunPage, error) {
	page := store.WorkflowRunPage{Runs: []store.WorkflowRunRecord{}}
	if limit < 1 || limit > 20 {
		return page, errors.New("workflow page limit must be 1..20")
	}
	if cursor != "" && (len(cursor) != 30 || !strings.HasPrefix(cursor, "wfr_")) {
		return page, errors.New("invalid workflow cursor")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return page, err
	}
	defer func() { _ = tx.Rollback() }() // Cleanup only; commit/read errors are returned below.
	if err = authorizeWorkflowTargetTx(ctx, tx, workspaceID, channelID, dmID, requesterID, false); err != nil {
		return page, err
	}
	rows, err := s.q.WithTx(tx).ListWorkflowSnapshots(ctx, storedb.ListWorkflowSnapshotsParams{WorkspaceID: workspaceID, ChannelID: channelID, DirectConversationID: dmID, CursorID: cursor, PageLimit: int64(limit + 1)})
	if err != nil {
		return page, err
	}
	if len(rows) > limit {
		rows = rows[:limit]
		page.NextCursor = rows[len(rows)-1].ID
	}
	for _, row := range rows {
		record, err := workflowRecord(row)
		if err != nil {
			return page, err
		}
		page.Runs = append(page.Runs, record)
	}
	return page, nil
}

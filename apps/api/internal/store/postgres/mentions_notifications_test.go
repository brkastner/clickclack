package postgres

import (
	"context"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func TestMentionsNotificationMigrationUpgradesExistingDatabase(t *testing.T) {
	ctx := context.Background()
	st := newIsolatedPostgresTestStore(t)
	applyPostgresMigrationsBefore(t, ctx, st, "0032_mentions_and_notifications.sql")
	ownerID, workspaceID, channelID := seedPostgresMigrationChannel(t, ctx, st)
	if _, err := st.db.ExecContext(ctx, `INSERT INTO events (id, cursor, workspace_id, channel_id, type, seq, payload_json, created_at, is_private) VALUES ('evt_upgrade', 'cur_upgrade', $1, $2, 'message.created', 1, '{}', $3, 0)`, workspaceID, channelID, now()); err != nil {
		t.Fatal(err)
	}
	if err := st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	var mentionedJSON string
	if err := st.db.QueryRowContext(ctx, `SELECT mentioned_user_ids::text FROM events WHERE id = 'evt_upgrade'`).Scan(&mentionedJSON); err != nil {
		t.Fatal(err)
	}
	if mentionedJSON != "[]" {
		t.Fatalf("expected existing event to receive an empty mention list, got %q", mentionedJSON)
	}
	preference, err := st.GetChannelNotificationPreference(ctx, channelID, ownerID)
	if err != nil || preference != store.ChannelNotifyAll {
		t.Fatalf("expected upgraded database to default to all, got %q: %v", preference, err)
	}
}

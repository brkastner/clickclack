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
	owner, err := st.EnsureBootstrap(ctx, "Upgrade Owner", "postgres-mentions-upgrade@example.com")
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	channels, err := st.ListChannels(ctx, workspaces[0].ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.db.ExecContext(ctx, `INSERT INTO events (id, cursor, workspace_id, channel_id, type, seq, payload_json, created_at, is_private) VALUES ('evt_upgrade', 'cur_upgrade', $1, $2, 'message.created', 1, '{}', $3, 0)`, workspaces[0].ID, channels[0].ID, now()); err != nil {
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
	preference, err := st.GetChannelNotificationPreference(ctx, channels[0].ID, owner.ID)
	if err != nil || preference != store.ChannelNotifyAll {
		t.Fatalf("expected upgraded database to default to all, got %q: %v", preference, err)
	}
}

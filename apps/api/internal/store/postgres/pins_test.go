package postgres

import (
	"context"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func TestPinnedMessagesMigrationUpgradesExistingDatabase(t *testing.T) {
	ctx := context.Background()
	st := newIsolatedPostgresTestStore(t)
	applyPostgresMigrationsBefore(t, ctx, st, "0033_pinned_messages.sql")
	owner, err := st.EnsureBootstrap(ctx, "Pin Upgrade", "postgres-pin-upgrade@example.com")
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
	message, _, err := st.CreateMessage(ctx, store.CreateMessageInput{
		ChannelID: channels[0].ID, AuthorID: owner.ID, Body: "existing postgres message",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.PinMessage(ctx, channels[0].ID, message.ID, owner.ID); err != nil {
		t.Fatal(err)
	}
	pinned, err := st.ListPinnedMessages(ctx, channels[0].ID, owner.ID, 100)
	if err != nil || len(pinned) != 1 || pinned[0].ID != message.ID {
		t.Fatalf("unexpected upgraded pin list: %#v: %v", pinned, err)
	}
	if _, err := st.UnpinMessage(ctx, channels[0].ID, message.ID, owner.ID); err != nil {
		t.Fatal(err)
	}
}

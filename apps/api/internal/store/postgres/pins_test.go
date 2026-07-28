package postgres

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/openclaw/clickclack/apps/api/internal/store"
	"github.com/openclaw/clickclack/apps/api/internal/store/postgres/storedb"
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

func TestPinMessageWaitsForConcurrentDelete(t *testing.T) {
	ctx := context.Background()
	st := newIsolatedPostgresTestStore(t)
	owner, err := st.EnsureBootstrap(ctx, "Pin Race", "postgres-pin-race@example.com")
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := st.EnsureDefaultWorkspaceMember(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	channels, err := st.ListChannels(ctx, workspace.ID, owner.ID)
	if err != nil || len(channels) == 0 {
		t.Fatalf("expected a channel, got %v: %v", channels, err)
	}
	message, _, err := st.CreateMessage(ctx, store.CreateMessageInput{
		ChannelID: channels[0].ID, AuthorID: owner.ID, Body: "race target",
	})
	if err != nil {
		t.Fatal(err)
	}

	deleteTx, err := st.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer deleteTx.Rollback()
	if _, err := deleteTx.ExecContext(ctx, `UPDATE messages SET deleted_at = NOW() WHERE id = $1`, message.ID); err != nil {
		t.Fatal(err)
	}

	result := make(chan error, 1)
	go func() {
		_, _, pinErr := st.PinMessage(ctx, channels[0].ID, message.ID, owner.ID)
		result <- pinErr
	}()
	select {
	case pinErr := <-result:
		t.Fatalf("pin returned before concurrent delete committed: %v", pinErr)
	case <-time.After(150 * time.Millisecond):
	}
	if err := deleteTx.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case pinErr := <-result:
		if pinErr == nil || pinErr.Error() != "deleted messages cannot be pinned" {
			t.Fatalf("expected deleted-message validation after lock release, got %v", pinErr)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("pin did not resume after concurrent delete committed")
	}
	count, err := st.q.CountPinnedMessage(ctx, storedb.CountPinnedMessageParams{
		ChannelID: channels[0].ID,
		MessageID: message.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("expected no pin rows after concurrent delete, got %d", count)
	}
}

func TestDeletePinnedMessageRemovesPinAndOrdersEvents(t *testing.T) {
	ctx := context.Background()
	st := newIsolatedPostgresTestStore(t)
	owner, err := st.EnsureBootstrap(ctx, "Pin Delete", "postgres-pin-delete@example.com")
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := st.EnsureDefaultWorkspaceMember(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	channels, err := st.ListChannels(ctx, workspace.ID, owner.ID)
	if err != nil || len(channels) == 0 {
		t.Fatalf("expected a channel, got %v: %v", channels, err)
	}
	message, _, err := st.CreateMessage(ctx, store.CreateMessageInput{
		ChannelID: channels[0].ID, AuthorID: owner.ID, Body: "delete this pin",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.PinMessage(ctx, channels[0].ID, message.ID, owner.ID); err != nil {
		t.Fatal(err)
	}

	deleted, events, err := st.DeleteMessage(ctx, store.DeleteMessageInput{MessageID: message.ID, UserID: owner.ID})
	if err != nil {
		t.Fatal(err)
	}
	if deleted.DeletedAt == nil || len(events) != 2 || events[0].Type != "pin.removed" || events[1].Type != "message.deleted" {
		t.Fatalf("unexpected delete result: %#v %#v", deleted, events)
	}
	count, err := st.q.CountPinnedMessage(ctx, storedb.CountPinnedMessageParams{
		ChannelID: channels[0].ID,
		MessageID: message.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("expected deleted message pin to be removed, got %d rows", count)
	}
}

func TestExportJSONIncludesPinnedMessages(t *testing.T) {
	ctx := context.Background()
	st := newIsolatedPostgresTestStore(t)
	owner, err := st.EnsureBootstrap(ctx, "Pin Export", "postgres-pin-export@example.com")
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := st.EnsureDefaultWorkspaceMember(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	channels, err := st.ListChannels(ctx, workspace.ID, owner.ID)
	if err != nil || len(channels) == 0 {
		t.Fatalf("expected a channel, got %v: %v", channels, err)
	}
	message, _, err := st.CreateMessage(ctx, store.CreateMessageInput{
		ChannelID: channels[0].ID, AuthorID: owner.ID, Body: "export this pin",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.PinMessage(ctx, channels[0].ID, message.ID, owner.ID); err != nil {
		t.Fatal(err)
	}

	var exported bytes.Buffer
	if err := st.ExportJSON(ctx, &exported); err != nil {
		t.Fatal(err)
	}
	var body map[string][]map[string]any
	if err := json.Unmarshal(exported.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body["pinned_messages"]) != 1 || body["pinned_messages"][0]["message_id"] != message.ID {
		t.Fatalf("expected pinned message in export, got %#v", body["pinned_messages"])
	}
}

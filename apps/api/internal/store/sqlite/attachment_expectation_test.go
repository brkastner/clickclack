package sqlite

import (
	"context"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func TestCreateMessagePublishesExpectedAttachmentCount(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	st := newTestStore(t)
	owner, err := st.EnsureBootstrap(ctx, "Owner", "owner@example.com")
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

	_, event, err := st.CreateMessage(ctx, store.CreateMessageInput{
		ChannelID:               channels[0].ID,
		AuthorID:                owner.ID,
		Body:                    "message with uploads",
		ExpectedAttachmentCount: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
	payload, ok := event.Payload.(map[string]string)
	if !ok {
		t.Fatalf("unexpected event payload type %T", event.Payload)
	}
	if payload["expected_attachment_count"] != "3" {
		t.Fatalf("expected attachment count 3, got %#v", payload)
	}
}

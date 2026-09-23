package sqlite

import (
	"context"
	"errors"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func TestRenameChannelKeepsIdentityAndRejectsDuplicateTitles(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	owner, err := st.EnsureBootstrap(ctx, "Owner", "rename-owner@example.com")
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	workspace := workspaces[0]
	first, _, err := st.CreateChannel(ctx, store.CreateChannelInput{WorkspaceID: workspace.ID, UserID: owner.ID, Name: "first", Kind: "public"})
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := st.CreateChannel(ctx, store.CreateChannelInput{WorkspaceID: workspace.ID, UserID: owner.ID, Name: "second", Kind: "public"})
	if err != nil {
		t.Fatal(err)
	}
	bot, _, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: workspace.ID, DisplayName: "Helper", Handle: "rename-helper", CreatedBy: owner.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.UpsertChannelBotAssignment(ctx, store.UpsertChannelBotAssignmentInput{ChannelID: first.ID, BotUserID: bot.ID, ActorUserID: owner.ID}); err != nil {
		t.Fatal(err)
	}

	duplicate := "  SECOND  "
	if _, _, err := st.UpdateChannel(ctx, store.UpdateChannelInput{ChannelID: first.ID, UserID: owner.ID, DisplayTitle: &duplicate}); !errors.Is(err, store.ErrChannelTitleTaken) {
		t.Fatalf("duplicate name error = %v", err)
	}
	title := "New display name"
	updated, _, err := st.UpdateChannel(ctx, store.UpdateChannelInput{ChannelID: first.ID, UserID: owner.ID, DisplayTitle: &title})
	if err != nil {
		t.Fatal(err)
	}
	if updated.ID != first.ID || updated.Name != first.Name || updated.DisplayTitle == nil || *updated.DisplayTitle != title {
		t.Fatalf("rename changed channel identity or name: %#v", updated)
	}
	listed, err := st.ListChannels(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, channel := range listed {
		if channel.ID == first.ID {
			if len(channel.BotAssignments) != 1 || channel.BotAssignments[0].BotUserID != bot.ID {
				t.Fatalf("rename lost bot assignment: %#v", channel)
			}
		}
	}
	duplicate = " NEW DISPLAY NAME "
	if _, _, err := st.UpdateChannel(ctx, store.UpdateChannelInput{ChannelID: second.ID, UserID: owner.ID, DisplayTitle: &duplicate}); !errors.Is(err, store.ErrChannelTitleTaken) {
		t.Fatalf("duplicate display title error = %v", err)
	}
}

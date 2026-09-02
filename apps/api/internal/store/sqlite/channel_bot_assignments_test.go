package sqlite

import (
	"context"
	"errors"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func TestChannelBotAssignmentsAuthorizationAndHydration(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	st := newTestStore(t)

	owner, err := st.EnsureBootstrap(ctx, "Owner", "assignment-owner@example.com")
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	workspace := workspaces[0]
	channels, err := st.ListChannels(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	channel := channels[0]
	member, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Member", Email: "assignment-member@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddWorkspaceMember(ctx, workspace.ID, member.ID, store.WorkspaceRoleMember); err != nil {
		t.Fatal(err)
	}
	bot, _, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: workspace.ID, DisplayName: "Career", Handle: "career", CreatedBy: owner.ID})
	if err != nil {
		t.Fatal(err)
	}

	input := store.UpsertChannelBotAssignmentInput{ChannelID: channel.ID, BotUserID: bot.ID, ActorUserID: member.ID}
	if _, _, err := st.UpsertChannelBotAssignment(ctx, input); !errors.Is(err, store.ErrNotWorkspaceManager) {
		t.Fatalf("member assignment error = %v, want ErrNotWorkspaceManager", err)
	}
	input.ActorUserID = owner.ID
	assignment, _, err := st.UpsertChannelBotAssignment(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if assignment.ChannelID != channel.ID || assignment.BotUserID != bot.ID {
		t.Fatalf("unexpected assignment: %#v", assignment)
	}
	listed, err := st.ListChannels(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed[0].BotAssignments) != 1 || listed[0].BotAssignments[0] != assignment {
		t.Fatalf("assignment not hydrated: %#v", listed[0].BotAssignments)
	}

	otherWorkspace, err := st.CreateWorkspace(ctx, store.CreateWorkspaceInput{Name: "Other", Slug: "other-assignment"}, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	otherBot, _, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: otherWorkspace.ID, DisplayName: "Other Bot", Handle: "otherbot", CreatedBy: owner.ID})
	if err != nil {
		t.Fatal(err)
	}
	input.BotUserID = otherBot.ID
	if _, _, err := st.UpsertChannelBotAssignment(ctx, input); err == nil {
		t.Fatal("expected bot outside workspace to be rejected")
	}
}

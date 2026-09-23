package storetest

import (
	"context"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func BotRuntimeStatuses(t *testing.T, st store.Store) {
	t.Helper()
	ctx := context.Background()
	owner, err := st.EnsureBootstrap(ctx, "Owner", "runtime-status@example.com")
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	ws := workspaces[0]
	channels, err := st.ListChannels(ctx, ws.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	channel := channels[0]
	bot, _, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: ws.ID, OwnerUserID: owner.ID, CreatedBy: owner.ID, DisplayName: "Runtime Bot", Scopes: []string{"messages:read", store.AgentActivityWriteScope}})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddWorkspaceMember(ctx, ws.ID, bot.ID, "bot"); err != nil {
		t.Fatal(err)
	}

	fast := true
	input := store.PublishBotRuntimeStatusInput{WorkspaceID: ws.ID, ChannelID: channel.ID, BotUserID: bot.ID, Snapshot: store.BotRuntimeStatusSnapshot{Runtime: "pi", ModelProvider: "openai-codex", ModelID: "gpt-5.6", Reasoning: "high", FastMode: &fast}}
	published, err := st.PublishBotRuntimeStatus(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if published.BotUserID != bot.ID || published.FastMode == nil || !*published.FastMode || published.ExpiresAt == "" {
		t.Fatalf("published: %#v", published)
	}
	listed, err := st.ListBotRuntimeStatuses(ctx, ws.ID, channel.ID, "", owner.ID)
	if err != nil || len(listed) != 1 || listed[0].ModelID != "gpt-5.6" {
		t.Fatalf("listed: %#v %v", listed, err)
	}

	input.Snapshot.ModelID = "gpt-5.7"
	input.Snapshot.Reasoning = "medium"
	input.Snapshot.FastMode = nil
	updated, err := st.PublishBotRuntimeStatus(ctx, input)
	if err != nil || updated.ModelID != "gpt-5.7" || updated.FastMode != nil {
		t.Fatalf("updated: %#v %v", updated, err)
	}
	listed, err = st.ListBotRuntimeStatuses(ctx, ws.ID, channel.ID, "", owner.ID)
	if err != nil || len(listed) != 1 {
		t.Fatalf("upsert count: %#v %v", listed, err)
	}
	if _, err := st.ListBotRuntimeStatuses(ctx, ws.ID, channel.ID, "", "outsider"); err == nil {
		t.Fatal("outsider read")
	}

	dm, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{WorkspaceID: ws.ID, UserID: owner.ID, MemberIDs: []string{bot.ID}})
	if err != nil {
		t.Fatal(err)
	}
	input.ChannelID = ""
	input.DirectConversationID = dm.ID
	if _, err := st.PublishBotRuntimeStatus(ctx, input); err != nil {
		t.Fatal(err)
	}
	direct, err := st.ListBotRuntimeStatuses(ctx, ws.ID, "", dm.ID, owner.ID)
	if err != nil || len(direct) != 1 || direct[0].ChannelID != "" {
		t.Fatalf("direct: %#v %v", direct, err)
	}

	input.WorkspaceID = "wrong"
	if _, err := st.PublishBotRuntimeStatus(ctx, input); err == nil {
		t.Fatal("cross-workspace write")
	}
	input.WorkspaceID = ws.ID
	input.ChannelID = channel.ID
	if _, err := st.PublishBotRuntimeStatus(ctx, input); err == nil {
		t.Fatal("accepted both targets")
	}
}

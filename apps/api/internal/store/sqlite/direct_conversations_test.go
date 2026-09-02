package sqlite

import (
	"context"
	"sort"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func TestCreateDirectConversationReusesOneToOneButNotGroups(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	st := newTestStore(t)

	owner, err := st.EnsureBootstrap(ctx, "Owner", "owner@example.com")
	if err != nil {
		t.Fatal(err)
	}
	other, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Other", Email: "other@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	third, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Third", Email: "third@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	workspace := workspaces[0]
	for _, userID := range []string{other.ID, third.ID} {
		if err := st.AddWorkspaceMember(ctx, workspace.ID, userID, store.WorkspaceRoleMember); err != nil {
			t.Fatal(err)
		}
	}

	first, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{
		WorkspaceID: workspace.ID,
		UserID:      owner.ID,
		MemberIDs:   []string{other.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	reused, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{
		WorkspaceID: workspace.ID,
		UserID:      other.ID,
		MemberIDs:   []string{owner.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if reused.ID != first.ID || reused.RouteID != first.RouteID {
		t.Fatalf("expected canonical one-to-one DM reuse, first=%#v reused=%#v", first, reused)
	}

	groupA, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{
		WorkspaceID: workspace.ID,
		UserID:      owner.ID,
		MemberIDs:   []string{other.ID, third.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	groupB, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{
		WorkspaceID: workspace.ID,
		UserID:      owner.ID,
		MemberIDs:   []string{other.ID, third.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if groupA.ID == groupB.ID {
		t.Fatalf("expected group DMs to remain independently creatable, got %s", groupA.ID)
	}
}

func TestCreateDirectConversationReusesLegacyUnkeyedPair(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	st := newTestStore(t)

	owner, err := st.EnsureBootstrap(ctx, "Owner", "owner@example.com")
	if err != nil {
		t.Fatal(err)
	}
	other, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Other", Email: "other@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	workspace := workspaces[0]
	if err := st.AddWorkspaceMember(ctx, workspace.ID, other.ID, store.WorkspaceRoleMember); err != nil {
		t.Fatal(err)
	}

	const legacyID = "dm_legacy_pair"
	mustExecSQL(t, ctx, st, `INSERT INTO direct_conversations (id, workspace_id, created_at) VALUES (?, ?, '2026-01-01T00:00:00Z')`, legacyID, workspace.ID)
	for _, userID := range []string{owner.ID, other.ID} {
		mustExecSQL(t, ctx, st, `INSERT INTO direct_conversation_members (conversation_id, user_id, created_at) VALUES (?, ?, '2026-01-01T00:00:00Z')`, legacyID, userID)
	}

	reused, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{
		WorkspaceID: workspace.ID,
		UserID:      owner.ID,
		MemberIDs:   []string{other.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if reused.ID != legacyID {
		t.Fatalf("expected legacy unkeyed pair reuse, got %#v", reused)
	}
	if got := scalarCount(t, ctx, st, `SELECT COUNT(*) FROM direct_conversations WHERE workspace_id = ?`, workspace.ID); got != 1 {
		t.Fatalf("expected no duplicate conversation row, got %d", got)
	}
}

func TestListDirectConversationsOrdersByLatestMessage(t *testing.T) {
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
	workspace := workspaces[0]

	conversationIDs := make([]string, 0, 3)
	for index, name := range []string{"First", "Second", "Third"} {
		member, err := st.CreateUser(ctx, store.CreateUserInput{
			DisplayName: name,
			Email:       name + "@example.com",
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := st.AddWorkspaceMember(ctx, workspace.ID, member.ID, store.WorkspaceRoleMember); err != nil {
			t.Fatal(err)
		}
		conversation, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{
			WorkspaceID: workspace.ID,
			UserID:      owner.ID,
			MemberIDs:   []string{member.ID},
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := st.CreateDirectMessage(ctx, store.CreateDirectMessageInput{
			ConversationID: conversation.ID,
			AuthorID:       owner.ID,
			Body:           name,
		}); err != nil {
			t.Fatal(err)
		}
		mustExecSQL(
			t,
			ctx,
			st,
			`UPDATE messages SET created_at = ? WHERE direct_conversation_id = ?`,
			[]string{"2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z", "2026-02-01T00:00:00Z"}[index],
			conversation.ID,
		)
		conversationIDs = append(conversationIDs, conversation.ID)
	}

	listed, err := st.ListDirectConversations(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{conversationIDs[1], conversationIDs[2], conversationIDs[0]}
	if len(listed) != len(want) {
		t.Fatalf("expected %d direct conversations, got %#v", len(want), listed)
	}
	for index, conversationID := range want {
		if listed[index].ID != conversationID {
			t.Fatalf("expected recency order %v, got %#v", want, listed)
		}
	}
}

func TestListDirectConversationsUsesDeterministicEmptyFallback(t *testing.T) {
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
	workspace := workspaces[0]

	conversationIDs := make([]string, 0, 3)
	for _, name := range []string{"First", "Second", "Third"} {
		member, err := st.CreateUser(ctx, store.CreateUserInput{
			DisplayName: name,
			Email:       "empty-" + name + "@example.com",
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := st.AddWorkspaceMember(ctx, workspace.ID, member.ID, store.WorkspaceRoleMember); err != nil {
			t.Fatal(err)
		}
		conversation, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{
			WorkspaceID: workspace.ID,
			UserID:      owner.ID,
			MemberIDs:   []string{member.ID},
		})
		if err != nil {
			t.Fatal(err)
		}
		conversationIDs = append(conversationIDs, conversation.ID)
	}
	mustExecSQL(t, ctx, st, `UPDATE direct_conversations SET created_at = '2026-01-01T00:00:00Z' WHERE id = ?`, conversationIDs[0])
	for _, conversationID := range conversationIDs[1:] {
		mustExecSQL(t, ctx, st, `UPDATE direct_conversations SET created_at = '2026-02-01T00:00:00Z' WHERE id = ?`, conversationID)
	}

	listed, err := st.ListDirectConversations(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	tied := append([]string(nil), conversationIDs[1:]...)
	sort.Strings(tied)
	want := append(tied, conversationIDs[0])
	if len(listed) != len(want) {
		t.Fatalf("expected %d direct conversations, got %#v", len(want), listed)
	}
	for index, conversationID := range want {
		if listed[index].ID != conversationID {
			t.Fatalf("expected deterministic empty-conversation order %v, got %#v", want, listed)
		}
	}
}

func TestHideDirectConversationIsPerUserAndReversible(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	st := newTestStore(t)

	owner, err := st.EnsureBootstrap(ctx, "Owner", "owner@example.com")
	if err != nil {
		t.Fatal(err)
	}
	other, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Other", Email: "other@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	workspace := workspaces[0]
	if err := st.AddWorkspaceMember(ctx, workspace.ID, other.ID, store.WorkspaceRoleMember); err != nil {
		t.Fatal(err)
	}

	dm, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{
		WorkspaceID: workspace.ID,
		UserID:      owner.ID,
		MemberIDs:   []string{other.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.HideDirectConversation(ctx, dm.ID, owner.ID); err != nil {
		t.Fatal(err)
	}
	ownerList, err := st.ListDirectConversations(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(ownerList) != 0 {
		t.Fatalf("expected hidden dm to disappear for owner, got %#v", ownerList)
	}
	otherList, err := st.ListDirectConversations(ctx, workspace.ID, other.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(otherList) != 1 || otherList[0].ID != dm.ID {
		t.Fatalf("expected dm to remain visible for other member, got %#v", otherList)
	}
	if _, err := st.GetDirectConversation(ctx, dm.ID, owner.ID); err != nil {
		t.Fatalf("hidden dm route/access should still resolve: %v", err)
	}

	reopened, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{
		WorkspaceID: workspace.ID,
		UserID:      owner.ID,
		MemberIDs:   []string{other.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if reopened.ID != dm.ID {
		t.Fatalf("expected reopen to reuse existing dm %s, got %s", dm.ID, reopened.ID)
	}
	ownerList, err = st.ListDirectConversations(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(ownerList) != 1 || ownerList[0].ID != dm.ID {
		t.Fatalf("expected reopened dm to be visible, got %#v", ownerList)
	}

	if err := st.HideDirectConversation(ctx, dm.ID, owner.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.CreateDirectMessage(ctx, store.CreateDirectMessageInput{ConversationID: dm.ID, AuthorID: owner.ID, Body: "sender resurface"}); err != nil {
		t.Fatal(err)
	}
	ownerList, err = st.ListDirectConversations(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(ownerList) != 1 || ownerList[0].ID != dm.ID {
		t.Fatalf("expected own root dm message to resurface hidden dm, got %#v", ownerList)
	}

	if err := st.HideDirectConversation(ctx, dm.ID, owner.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.CreateDirectMessage(ctx, store.CreateDirectMessageInput{ConversationID: dm.ID, AuthorID: other.ID, Body: "resurface"}); err != nil {
		t.Fatal(err)
	}
	ownerList, err = st.ListDirectConversations(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(ownerList) != 1 || ownerList[0].ID != dm.ID {
		t.Fatalf("expected new root dm message to resurface hidden dm, got %#v", ownerList)
	}
}

func TestReopenDirectConversationRestoresGroupDMByID(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	st := newTestStore(t)

	owner, err := st.EnsureBootstrap(ctx, "Owner", "owner@example.com")
	if err != nil {
		t.Fatal(err)
	}
	other, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Other", Email: "other@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	third, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Third", Email: "third@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	workspace := workspaces[0]
	for _, memberID := range []string{other.ID, third.ID} {
		if err := st.AddWorkspaceMember(ctx, workspace.ID, memberID, store.WorkspaceRoleMember); err != nil {
			t.Fatal(err)
		}
	}

	dm, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{
		WorkspaceID: workspace.ID,
		UserID:      owner.ID,
		MemberIDs:   []string{other.ID, third.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.HideDirectConversation(ctx, dm.ID, owner.ID); err != nil {
		t.Fatal(err)
	}
	reopened, err := st.ReopenDirectConversation(ctx, dm.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.ID != dm.ID {
		t.Fatalf("expected group dm reopen to preserve %s, got %s", dm.ID, reopened.ID)
	}
	ownerList, err := st.ListDirectConversations(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(ownerList) != 1 || ownerList[0].ID != dm.ID {
		t.Fatalf("expected reopened group dm to be visible, got %#v", ownerList)
	}
}

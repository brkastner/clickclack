// Package outputtest exercises the same output-discovery contract on both stores.
package outputtest

import (
	"context"
	"github.com/openclaw/clickclack/apps/api/internal/store"
	"testing"
)

func Run(t *testing.T, st store.Store, exec func(string, ...any) error) {
	t.Helper()
	ctx := context.Background()
	owner, err := st.EnsureBootstrap(ctx, "Gallery owner", "gallery@example.com")
	must(t, err)
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	must(t, err)
	ws := workspaces[0].ID
	channels, err := st.ListChannels(ctx, ws, owner.ID)
	must(t, err)
	bot, _, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: ws, DisplayName: "Duplicate name", CreatedBy: owner.ID})
	must(t, err)
	other, _, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: ws, DisplayName: "Duplicate name", CreatedBy: owner.ID})
	must(t, err)
	member, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Member", Email: "gallery-member@example.com"})
	must(t, err)
	must(t, st.AddWorkspaceMember(ctx, ws, member.ID, store.WorkspaceRoleMember))
	dm, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{WorkspaceID: ws, UserID: owner.ID, MemberIDs: []string{bot.ID}})
	must(t, err)
	direct, _, err := st.CreateDirectMessage(ctx, store.CreateDirectMessageInput{ConversationID: dm.ID, AuthorID: bot.ID, Body: "private response"})
	must(t, err)
	want := map[string]bool{direct.ID: true}
	attachment, _, err := st.CreateMessage(ctx, store.CreateMessageInput{ChannelID: channels[0].ID, AuthorID: bot.ID, Body: "placeholder"})
	must(t, err)
	must(t, exec("INSERT INTO uploads (id, workspace_id, owner_id, filename, content_type, byte_size, storage_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "output-upload", ws, bot.ID, "image.png", "image/png", 12, "synthetic", attachment.CreatedAt))
	must(t, exec("INSERT INTO message_attachments (message_id, upload_id, created_at) VALUES (?, ?, ?)", attachment.ID, "output-upload", attachment.CreatedAt))
	must(t, exec("UPDATE messages SET body = '' WHERE id = ?", attachment.ID))
	want[attachment.ID] = true
	ownAttachment, _, err := st.CreateMessage(ctx, store.CreateMessageInput{ChannelID: channels[0].ID, AuthorID: owner.ID, Body: "own placeholder"})
	must(t, err)
	must(t, exec("INSERT INTO uploads (id, workspace_id, owner_id, filename, content_type, byte_size, storage_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "own-output-upload", ws, owner.ID, "mine.png", "image/png", 12, "synthetic-own", ownAttachment.CreatedAt))
	must(t, exec("INSERT INTO message_attachments (message_id, upload_id, created_at) VALUES (?, ?, ?)", ownAttachment.ID, "own-output-upload", ownAttachment.CreatedAt))
	must(t, exec("UPDATE messages SET body = '' WHERE id = ?", ownAttachment.ID))
	deleted, _, err := st.CreateMessage(ctx, store.CreateMessageInput{ChannelID: channels[0].ID, AuthorID: bot.ID, Body: "deleted"})
	must(t, err)
	must(t, exec("UPDATE messages SET deleted_at = created_at WHERE id = ?", deleted.ID))
	reply, _, _, err := st.CreateThreadReply(ctx, store.CreateThreadReplyInput{RootMessageID: attachment.ID, AuthorID: bot.ID, Body: "thread output"})
	must(t, err)
	want[reply.ID] = true
	for i := 0; i < 5; i++ {
		message, _, err := st.CreateMessage(ctx, store.CreateMessageInput{ChannelID: channels[0].ID, AuthorID: bot.ID, Body: "response"})
		must(t, err)
		want[message.ID] = true
	}
	_, _, err = st.CreateMessage(ctx, store.CreateMessageInput{ChannelID: channels[0].ID, AuthorID: other.ID, Body: "wrong source"})
	must(t, err)
	for _, kind := range []string{"agent_commentary", "agent_tool"} {
		_, _, err = st.CreateMessage(ctx, store.CreateMessageInput{ChannelID: channels[0].ID, AuthorID: bot.ID, Body: "activity", Kind: kind})
		must(t, err)
	}
	request := store.OutputPageRequest{WorkspaceID: ws, AuthorID: bot.ID, UserID: owner.ID, Limit: 2}
	seen := map[string]bool{}
	first, err := st.ListOutputPage(ctx, request)
	must(t, err)
	if len(first.Outputs) != 2 || first.NextCursor == nil {
		t.Fatalf("first page: %#v", first)
	}
	page := first
	for {
		for _, message := range page.Outputs {
			if !want[message.ID] || seen[message.ID] {
				t.Fatalf("unexpected or duplicate output %s", message.ID)
			}
			seen[message.ID] = true
			if message.ID == attachment.ID && (message.Body != "" || len(message.Attachments) != 1) {
				t.Fatal("attachment-only output was not hydrated")
			}
			if message.ID == reply.ID && (message.ParentMessageID == nil || message.ThreadRootID != attachment.ID) {
				t.Fatal("lost thread source")
			}
			if message.Author == nil || message.Author.ID != bot.ID {
				t.Fatal("missing hydrated author")
			}
			if _, err := store.NormalizeOutputTimestamp(message.CreatedAt); err != nil {
				t.Fatal(err)
			}
		}
		if page.NextCursor == nil {
			break
		}
		request.Cursor = *page.NextCursor
		page, err = st.ListOutputPage(ctx, request)
		must(t, err)
	}
	if len(seen) != len(want) {
		t.Fatalf("got %d outputs, want %d", len(seen), len(want))
	}
	// Gallery pages must skip status/text rows before pagination, not merely hide them in the UI.
	mediaPage, err := st.ListOutputPage(ctx, store.OutputPageRequest{WorkspaceID: ws, AuthorID: bot.ID, UserID: owner.ID, MediaOnly: true})
	must(t, err)
	if len(mediaPage.Outputs) != 1 || mediaPage.Outputs[0].ID != attachment.ID {
		t.Fatalf("media-only page included non-media or own output by default: %#v", mediaPage.Outputs)
	}
	ownPage, err := st.ListOutputPage(ctx, store.OutputPageRequest{WorkspaceID: ws, AuthorID: bot.ID, UserID: owner.ID, MediaOnly: true, IncludeOwn: true})
	must(t, err)
	if len(ownPage.Outputs) != 2 {
		t.Fatalf("include-own page has %d outputs, want 2: %#v", len(ownPage.Outputs), ownPage.Outputs)
	}
	foundOwn := false
	for _, message := range ownPage.Outputs {
		if message.ID == ownAttachment.ID {
			foundOwn = message.Author != nil && message.Author.ID == owner.ID && message.Author.Kind == "human"
		}
	}
	if !foundOwn {
		t.Fatal("include-own page did not hydrate the requester's media and human author")
	}
	request.Cursor = *first.NextCursor
	request.UserID = member.ID
	if _, err = st.ListOutputPage(ctx, request); err == nil {
		t.Fatal("accepted another requester's cursor")
	}
	request.Cursor = ""
	request.Limit = 100
	page, err = st.ListOutputPage(ctx, request)
	must(t, err)
	if len(page.Outputs) != 7 {
		t.Fatalf("nonmember sees %d outputs", len(page.Outputs))
	}
	for _, m := range page.Outputs {
		if m.ID == direct.ID {
			t.Fatal("leaked DM")
		}
	}
	// Recheck direct membership and workspace membership on each page.
	must(t, exec("DELETE FROM direct_conversation_members WHERE conversation_id = ? AND user_id = ?", dm.ID, owner.ID))
	request.UserID = owner.ID
	request.Cursor = ""
	page, err = st.ListOutputPage(ctx, request)
	must(t, err)
	for _, m := range page.Outputs {
		if m.ID == direct.ID {
			t.Fatal("DM survived membership revocation")
		}
	}
	request.UserID = member.ID
	request.Cursor = *first.NextCursor
	// A member's own cursor must also fail after workspace membership is removed.
	memberPage, err := st.ListOutputPage(ctx, store.OutputPageRequest{WorkspaceID: ws, AuthorID: bot.ID, UserID: member.ID, Limit: 1})
	must(t, err)
	must(t, exec("DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?", ws, member.ID))
	request.Cursor = *memberPage.NextCursor
	if _, err = st.ListOutputPage(ctx, request); err == nil {
		t.Fatal("workspace revocation did not invalidate page")
	}
	request.UserID = owner.ID
	request.Cursor = ""
	guest, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Guest", Email: "output-guest@example.com"})
	must(t, err)
	must(t, st.AddWorkspaceMember(ctx, ws, guest.ID, store.WorkspaceRoleGuest))
	guestPage, err := st.ListOutputPage(ctx, store.OutputPageRequest{WorkspaceID: ws, AuthorID: bot.ID, UserID: guest.ID})
	must(t, err)
	for _, m := range guestPage.Outputs {
		if m.DirectConversationID != "" {
			t.Fatal("guest sees direct output")
		}
		for _, c := range channels {
			if c.ID == m.ChannelID && c.Name != store.GuestChannelName {
				t.Fatal("guest sees non-guest channel")
			}
		}
	}
	otherWorkspace, err := st.CreateWorkspace(ctx, store.CreateWorkspaceInput{Name: "Other workspace"}, owner.ID)
	must(t, err)
	if _, err = st.ListOutputPage(ctx, store.OutputPageRequest{WorkspaceID: otherWorkspace.ID, AuthorID: bot.ID, UserID: owner.ID}); err == nil {
		t.Fatal("accepted wrong-workspace author")
	}
	request.AuthorID = owner.ID
	if _, err = st.ListOutputPage(ctx, request); err == nil {
		t.Fatal("accepted human source")
	}
	request.AuthorID = bot.ID
	request.UserID = "unrelated-user"
	if _, err = st.ListOutputPage(ctx, request); err == nil {
		t.Fatal("accepted nonmember")
	}
}
func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

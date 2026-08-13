package postgres

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func TestMessageRouteIDAssignmentIsLazyConcurrentAndChannelOnly(t *testing.T) {
	ctx := context.Background()
	st := newIsolatedPostgresTestStore(t)
	if err := st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	owner, err := st.EnsureBootstrap(ctx, "Route Owner", "postgres-route-owner@example.com")
	if err != nil {
		t.Fatal(err)
	}
	member, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Route Member", Email: "postgres-route-member@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	outsider, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Route Outsider", Email: "postgres-route-outsider@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	workspace := workspaces[0]
	if err := st.AddWorkspaceMember(ctx, workspace.ID, member.ID, store.WorkspaceRoleMember); err != nil {
		t.Fatal(err)
	}
	channels, err := st.ListChannels(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	channel := channels[0]
	root, _, err := st.CreateMessage(ctx, store.CreateMessageInput{ChannelID: channel.ID, AuthorID: owner.ID, Body: "citation root"})
	if err != nil {
		t.Fatal(err)
	}
	if root.RouteID != "" {
		t.Fatalf("new channel root should not eagerly get a route: %#v", root)
	}

	const callers = 8
	var wg sync.WaitGroup
	results := make(chan string, callers)
	errs := make(chan error, callers)
	for range callers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			message, err := st.EnsureMessageRouteID(ctx, member.ID, root.ID)
			if err != nil {
				errs <- err
				return
			}
			results <- message.RouteID
		}()
	}
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	var routeID string
	for value := range results {
		if len(value) != 17 || value[0] != 'M' {
			t.Fatalf("unexpected message route ID %q", value)
		}
		if routeID == "" {
			routeID = value
		} else if routeID != value {
			t.Fatalf("concurrent route allocation diverged: %q vs %q", routeID, value)
		}
	}

	dm, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{
		WorkspaceID: workspace.ID,
		UserID:      owner.ID,
		MemberIDs:   []string{member.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	dmRoot, _, err := st.CreateDirectMessage(ctx, store.CreateDirectMessageInput{
		ConversationID: dm.ID,
		AuthorID:       owner.ID,
		Body:           "private root",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.EnsureMessageRouteID(ctx, owner.ID, dmRoot.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("expected DM citation route to be rejected, got %v", err)
	}
	reply, _, _, err := st.CreateThreadReply(ctx, store.CreateThreadReplyInput{
		RootMessageID: root.ID,
		AuthorID:      owner.ID,
		Body:          "reply",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.EnsureMessageRouteID(ctx, owner.ID, reply.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("expected reply citation route to be rejected, got %v", err)
	}

	privateRoot, _, err := st.CreateMessage(ctx, store.CreateMessageInput{ChannelID: channel.ID, AuthorID: owner.ID, Body: "not for outsider"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.EnsureMessageRouteID(ctx, outsider.ID, privateRoot.ID); err == nil {
		t.Fatal("expected outsider route allocation to fail")
	}
	privateRoot, err = st.GetMessage(ctx, privateRoot.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if privateRoot.RouteID != "" {
		t.Fatalf("unauthorized allocation changed the root: %#v", privateRoot)
	}
}

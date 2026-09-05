package storetest

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func WorkflowSnapshotFixture() store.WorkflowSnapshot {
	return store.WorkflowSnapshot{Schema: store.WorkflowSnapshotSchema, Source: store.WorkflowSource{Provider: "pi-workflows", SessionID: "session", RunID: "run", Revision: 1}, Run: store.WorkflowSummary{WorkflowName: "Durable fixture", Status: "completed", StepTotal: 2, StepsComplete: true}, Steps: []store.WorkflowAttempt{
		{AttemptID: "attempt-1", NodeID: "build", NodeType: "task", Outcome: "failed", StartedAt: "2026-09-01T00:00:00Z", FinishedAt: "2026-09-01T00:01:00Z"},
		{AttemptID: "attempt-2", NodeID: "build", NodeType: "task", Outcome: "ok", StartedAt: "2026-09-01T00:02:00Z", FinishedAt: "2026-09-01T00:03:00Z"},
	}, Files: &store.WorkflowFiles{Source: "host-git", Basis: "cumulative-since-base", BaseRevision: "abc123", Attribution: "includes-preexisting-changes", Complete: true, Entries: []store.WorkflowFile{{Path: "src/main.go", Change: "modified"}, {Path: "docs/new.md", OldPath: "docs/old.md", Change: "renamed"}}}}
}

// WorkflowSnapshots runs the same durable ordering, isolation and pagination
// contract against both database implementations, without live resources.
func WorkflowSnapshots(t *testing.T, st store.Store) {
	t.Helper()
	ctx := context.Background()
	owner, err := st.EnsureBootstrap(ctx, "Owner", "workflow@example.com")
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
	ch := channels[0]
	bot, _, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: ws.ID, OwnerUserID: owner.ID, CreatedBy: owner.ID, DisplayName: "Producer", Scopes: []string{"bot:write", store.AgentActivityWriteScope}})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddWorkspaceMember(ctx, ws.ID, bot.ID, "bot"); err != nil {
		t.Fatal(err)
	}
	in := store.PublishWorkflowSnapshotInput{WorkspaceID: ws.ID, ChannelID: ch.ID, ProducerID: bot.ID, Snapshot: WorkflowSnapshotFixture()}
	first, changed, err := st.PublishWorkflowSnapshot(ctx, in)
	if err != nil || !changed {
		t.Fatalf("initial: %v %v", changed, err)
	}
	same, changed, err := st.PublishWorkflowSnapshot(ctx, in)
	if err != nil || changed || same.ID != first.ID {
		t.Fatalf("idempotency: %#v %v %v", same, changed, err)
	}
	in.Snapshot.Run.Status = "failed"
	if _, _, err := st.PublishWorkflowSnapshot(ctx, in); !errors.Is(err, store.ErrWorkflowRevisionConflict) {
		t.Fatalf("expected conflict: %v", err)
	}
	in.Snapshot.Source.Revision = 0
	stale, changed, err := st.PublishWorkflowSnapshot(ctx, in)
	if err != nil || changed || stale.Snapshot.Run.Status != "completed" {
		t.Fatalf("stale: %#v %v %v", stale, changed, err)
	}
	in.Snapshot.Source.Revision = 2
	newer, changed, err := st.PublishWorkflowSnapshot(ctx, in)
	if err != nil || !changed || newer.ID != first.ID {
		t.Fatalf("newer: %#v %v %v", newer, changed, err)
	}
	// Concurrent higher revisions must converge without last-writer-wins loss.
	var wg sync.WaitGroup
	failures := make(chan error, 8)
	for revision := int64(3); revision <= 10; revision++ {
		candidate := in
		candidate.Snapshot.Source.Revision = revision
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := st.PublishWorkflowSnapshot(ctx, candidate)
			if err != nil {
				failures <- err
			}
		}()
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	converged, err := st.ListWorkflowSnapshots(ctx, ws.ID, ch.ID, "", owner.ID, "", 10)
	if err != nil || len(converged.Runs) != 1 || converged.Runs[0].Snapshot.Source.Revision != 10 {
		t.Fatalf("revision convergence: %#v %v", converged, err)
	}
	for _, run := range []string{"second", "third"} {
		in.Snapshot.Source.RunID = run
		if _, _, err := st.PublishWorkflowSnapshot(ctx, in); err != nil {
			t.Fatal(err)
		}
	}
	page, err := st.ListWorkflowSnapshots(ctx, ws.ID, ch.ID, "", owner.ID, "", 2)
	if err != nil || len(page.Runs) != 2 || page.NextCursor == "" {
		t.Fatalf("first page: %#v %v", page, err)
	}
	last, err := st.ListWorkflowSnapshots(ctx, ws.ID, ch.ID, "", owner.ID, page.NextCursor, 2)
	if err != nil || len(last.Runs) != 1 || last.NextCursor != "" || last.Runs[0].ID != first.ID || len(last.Runs[0].Snapshot.Steps) != 2 || last.Runs[0].Snapshot.Files.Entries[1].OldPath != "docs/old.md" {
		t.Fatalf("retained detail: %#v %v", last, err)
	}
	if _, err := st.ListWorkflowSnapshots(ctx, ws.ID, ch.ID, "", owner.ID, "", 21); err == nil {
		t.Fatal("accepted oversized page")
	}
	if _, err := st.ListWorkflowSnapshots(ctx, ws.ID, ch.ID, "", "outsider", "", 10); err == nil {
		t.Fatal("outsider read")
	}
	dm, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{WorkspaceID: ws.ID, UserID: owner.ID, MemberIDs: []string{bot.ID}})
	if err != nil {
		t.Fatal(err)
	}
	in.ChannelID = ""
	in.DirectConversationID = dm.ID
	in.Snapshot.Source.RunID = "run"
	direct, changed, err := st.PublishWorkflowSnapshot(ctx, in)
	if err != nil || !changed || direct.ID == first.ID {
		t.Fatalf("target namespace: %#v %v", direct, err)
	}
	directPage, err := st.ListWorkflowSnapshots(ctx, ws.ID, "", dm.ID, owner.ID, "", 10)
	if err != nil || len(directPage.Runs) != 1 {
		t.Fatalf("DM isolation: %#v %v", directPage, err)
	}
	in.ProducerID = owner.ID // Store API trusts its authenticated producer; namespace remains distinct.
	other, changed, err := st.PublishWorkflowSnapshot(ctx, in)
	if err != nil || !changed || other.ID == direct.ID {
		t.Fatalf("producer namespace: %#v %v", other, err)
	}
	in.WorkspaceID = "wrong"
	if _, _, err := st.PublishWorkflowSnapshot(ctx, in); err == nil {
		t.Fatal("cross-workspace write")
	}
	in.WorkspaceID = ws.ID
	in.ChannelID = ch.ID
	if _, _, err := st.PublishWorkflowSnapshot(ctx, in); err == nil {
		t.Fatal("accepted both targets")
	}
}

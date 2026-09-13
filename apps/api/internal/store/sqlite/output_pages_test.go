package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/openclaw/clickclack/apps/api/internal/store"
	"github.com/openclaw/clickclack/apps/api/internal/store/outputtest"
	"github.com/openclaw/clickclack/apps/api/internal/store/sqlite/storedb"
	"sort"
	"strings"
	"testing"
)

func TestOutputPages(t *testing.T) {
	st := newTestStore(t)
	outputtest.Run(t, st, func(query string, args ...any) error { _, err := st.db.Exec(query, args...); return err })
}
func TestOutputMixedTimestampPrecision(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	owner, err := st.EnsureBootstrap(ctx, "Owner", "output-times@example.com")
	if err != nil {
		t.Fatal(err)
	}
	ws, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	channels, err := st.ListChannels(ctx, ws[0].ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	bot, _, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: ws[0].ID, DisplayName: "Bot", CreatedBy: owner.ID})
	if err != nil {
		t.Fatal(err)
	}
	stamps := []string{"2026-01-01T00:00:00Z", "2026-01-01T00:00:00.000000001Z", "2026-01-01T00:00:00.1Z", "2026-01-01T00:00:00.100000000Z"}
	ids := []string{}
	for _, stamp := range stamps {
		m, _, err := st.CreateMessage(ctx, store.CreateMessageInput{ChannelID: channels[0].ID, AuthorID: bot.ID, Body: "output"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = st.db.ExecContext(ctx, "UPDATE messages SET created_at = ? WHERE id = ?", stamp, m.ID); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, m.ID)
	}
	// The final two timestamps are equal instants; IDs break the tie.
	sort.Strings(ids[len(ids)-2:])
	req := store.OutputPageRequest{WorkspaceID: ws[0].ID, UserID: owner.ID, AuthorID: bot.ID, Limit: 1}
	for i := len(ids) - 1; i >= 0; i-- {
		page, err := st.ListOutputPage(ctx, req)
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Outputs) != 1 || page.Outputs[0].ID != ids[i] {
			t.Fatalf("wrong order: %#v", page)
		}
		if page.NextCursor != nil {
			req.Cursor = *page.NextCursor
		}
	}
	db := &outputCountingDB{DB: st.db}
	_, err = storedb.New(db).ListOutputMessages(ctx, storedb.ListOutputMessagesParams{WorkspaceID: ws[0].ID, AuthorID: bot.ID, UserID: owner.ID, Guest: 0, PageLimit: 31})
	if err != nil {
		t.Fatal(err)
	}
	indexed := false
	rows, err := st.db.QueryContext(ctx, "EXPLAIN QUERY PLAN "+db.query, db.args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var a, b, c int
		var detail string
		if err := rows.Scan(&a, &b, &c, &detail); err != nil {
			t.Fatal(err)
		}
		t.Log(detail)
		if strings.Contains(detail, "idx_messages_author_workspace") {
			indexed = true
		}
	}
	if !indexed {
		t.Fatal("output discovery did not use author/workspace index")
	}
}

// The output page's three hydration passes must stay independent of page size.
func TestOutputHydrationQueryCount(t *testing.T) {
	st := newTestStore(t)
	for _, size := range []int{1, 30, 100} {
		db := &outputCountingDB{DB: st.db}
		messages := make([]store.Message, size)
		for i := range messages {
			messages[i] = store.Message{ID: fmt.Sprintf("synthetic-%d", i)}
		}
		var err error
		messages, err = hydrateAttachments(context.Background(), db, messages)
		if err != nil {
			t.Fatal(err)
		}
		messages, err = hydrateThreadStates(context.Background(), db, messages)
		if err != nil {
			t.Fatal(err)
		}
		_, err = hydrateReactions(context.Background(), db, "requester", messages)
		if err != nil {
			t.Fatal(err)
		}
		if db.queries != 3 {
			t.Fatalf("size %d: got %d hydration queries, want 3", size, db.queries)
		}
	}
}

type outputCountingDB struct {
	*sql.DB
	queries int
	query   string
	args    []any
}

func (db *outputCountingDB) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	db.queries++
	db.query = query
	db.args = args
	return db.DB.QueryContext(ctx, query, args...)
}

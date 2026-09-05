package postgres

import (
	"context"
	"github.com/openclaw/clickclack/apps/api/internal/store/storetest"
	"testing"
)

func TestWorkflowSnapshots(t *testing.T) {
	st := newIsolatedPostgresTestStore(t)
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	storetest.WorkflowSnapshots(t, st)
}

package sqlite

import (
	"github.com/openclaw/clickclack/apps/api/internal/store/storetest"
	"testing"
)

func TestWorkflowSnapshots(t *testing.T) {
	st := newTestStore(t)
	storetest.WorkflowSnapshots(t, st)
}

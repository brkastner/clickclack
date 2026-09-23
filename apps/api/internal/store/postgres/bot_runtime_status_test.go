package postgres

import (
	"context"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/store/storetest"
)

func TestBotRuntimeStatuses(t *testing.T) {
	st := newIsolatedPostgresTestStore(t)
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	storetest.BotRuntimeStatuses(t, st)
}

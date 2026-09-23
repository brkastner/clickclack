package sqlite

import (
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/store/storetest"
)

func TestBotRuntimeStatuses(t *testing.T) {
	st := newTestStore(t)
	storetest.BotRuntimeStatuses(t, st)
}

package postgres

import (
	"context"
	"fmt"
	"github.com/openclaw/clickclack/apps/api/internal/store/outputtest"
	"strings"
	"testing"
)

func TestOutputPages(t *testing.T) {
	st := newIsolatedPostgresTestStore(t)
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	outputtest.Run(t, st, func(query string, args ...any) error {
		for i := range args {
			query = strings.Replace(query, "?", fmt.Sprintf("$%d", i+1), 1)
		}
		_, err := st.db.Exec(query, args...)
		return err
	})
}

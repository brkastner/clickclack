package sqlite

import (
	"context"
	"io/fs"
	"path/filepath"
	"testing"
)

func TestMigrateAppliesMissingPasswordMigrationAfterCustomMigrations(t *testing.T) {
	ctx := context.Background()
	st, err := Open(filepath.Join(t.TempDir(), "upgrade.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if _, err := st.db.ExecContext(ctx, `CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	const missing = "0042_user_passwords.sql"
	for _, entry := range entries {
		if entry.Name() == missing {
			continue
		}
		body, err := migrationsFS.ReadFile("migrations/" + entry.Name())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := st.db.ExecContext(ctx, string(body)); err != nil {
			t.Fatalf("%s: %v", entry.Name(), err)
		}
		if _, err := st.db.ExecContext(ctx, `INSERT INTO schema_migrations VALUES (?, ?)`, entry.Name(), now()); err != nil {
			t.Fatal(err)
		}
	}
	var latest string
	if err := st.db.QueryRowContext(ctx, `SELECT max(name) FROM schema_migrations`).Scan(&latest); err != nil || latest < "0048_persona_hero_positions.sql" {
		t.Fatalf("expected custom migrations before upgrade, latest=%q err=%v", latest, err)
	}
	for range 2 {
		if err := st.Migrate(ctx); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := st.db.QueryRowContext(ctx, `SELECT count(*) FROM schema_migrations WHERE name = ?`, missing).Scan(&count); err != nil || count != 1 {
		t.Fatalf("password migration count=%d err=%v", count, err)
	}
	if err := st.db.QueryRowContext(ctx, `SELECT count(*) FROM user_passwords`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("password table count=%d err=%v", count, err)
	}
}

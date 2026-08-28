import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

const migrations = [
  `CREATE TABLE IF NOT EXISTS bridge_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS cursors (
    workspace_id TEXT PRIMARY KEY,
    cursor TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS source_claims (
    message_id TEXT PRIMARY KEY,
    event_cursor TEXT NOT NULL,
    claimed_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS conversation_bindings (
    conversation_id TEXT PRIMARY KEY,
    project_alias TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS session_references (
    conversation_id TEXT PRIMARY KEY REFERENCES conversation_bindings(conversation_id) ON DELETE CASCADE,
    session_file TEXT NOT NULL,
    session_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS active_turns (
    conversation_id TEXT PRIMARY KEY REFERENCES conversation_bindings(conversation_id) ON DELETE CASCADE,
    turn_id TEXT NOT NULL UNIQUE,
    source_message_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'stopping')),
    started_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS pending_interactions (
    interaction_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversation_bindings(conversation_id) ON DELETE CASCADE,
    turn_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    request_json TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS outbound_reconciliation (
    nonce TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')),
    remote_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;`,
] as const;

export class BridgeStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
    );
    this.migrate();
  }

  close(): void {
    this.database.close();
  }

  getCursor(workspaceId: string): string | undefined {
    const row = this.database
      .prepare("SELECT cursor FROM cursors WHERE workspace_id = ?")
      .get(workspaceId) as { cursor: string } | undefined;
    return row?.cursor;
  }

  commitCursor(workspaceId: string, cursor: string): void {
    this.database
      .prepare(`INSERT INTO cursors (workspace_id, cursor, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`)
      .run(workspaceId, cursor, now());
  }

  claimSource(messageId: string, eventCursor: string): boolean {
    return this.transaction(() => {
      const result = this.database
        .prepare(
          "INSERT OR IGNORE INTO source_claims (message_id, event_cursor, claimed_at) VALUES (?, ?, ?)",
        )
        .run(messageId, eventCursor, now());
      return result.changes === 1;
    });
  }

  bindConversation(conversationId: string, projectAlias: string): void {
    const timestamp = now();
    this.database
      .prepare(`INSERT INTO conversation_bindings
      (conversation_id, project_alias, created_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET project_alias = excluded.project_alias, updated_at = excluded.updated_at`)
      .run(conversationId, projectAlias, timestamp, timestamp);
  }

  transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private migrate(): void {
    this.database.exec(
      "CREATE TABLE IF NOT EXISTS bridge_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT",
    );
    const hasMigration: StatementSync = this.database.prepare(
      "SELECT 1 FROM bridge_migrations WHERE version = ?",
    );
    migrations.forEach((sql, index) => {
      const version = index + 1;
      if (hasMigration.get(version)) return;
      this.transaction(() => {
        this.database.exec(sql);
        this.database
          .prepare("INSERT INTO bridge_migrations (version, applied_at) VALUES (?, ?)")
          .run(version, now());
      });
    });
  }
}

function now(): string {
  return new Date().toISOString();
}

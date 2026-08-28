# ClickClack Pi bridge

Private local service that connects trusted ClickClack conversations to persistent Pi sessions.

## Development

Copy `.env.example` into a secrets file outside the repository, export its values, then run:

```sh
pnpm --filter @clickclack/pi-bridge dev
```

The bootstrap validates all configuration before opening `CLICKCLACK_BRIDGE_DB`. Project aliases must map to absolute paths. The SQLite store runs migrations on startup and uses WAL mode, foreign keys, and immediate transactions for claims.

KAS-732 only establishes configuration, clients, durable state, logging, and shutdown. Realtime ingestion starts in KAS-733.

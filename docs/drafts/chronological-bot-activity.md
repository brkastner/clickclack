# Chronological bot activity (KAS-753)

Status: Selected for implementation. This documentation change does not implement, verify or deploy it.

Specification: [Chronological bot activity](../../SPEC.md#chronological-bot-activity-kas-753).

The selected summary, ordered steps, and validation below are preserved verbatim.

## Summary

Preserve conversation chronology when rendering durable bot activity. The current coalesceAgentActivity implementation collects all activity for a turn and emits it at that turn's first row, moving later activity ahead of intervening messages. Replace this relocation with in-place segmentation while retaining compact tool blocks and visibility controls.

## Ordered steps

1. Add regression cases in apps/web/src/lib/agent-activity-display.test.ts for a turn interrupted by a human message, interleaved bots or turns, and activity arriving after an ordinary final answer. Assert output row order and tool membership follow the supplied message order.
2. Update apps/web/src/lib/chat/agent-activity.ts to emit commentary in place and coalesce only contiguous agent_tool rows sharing the existing conversation/author/turn key. Flush on commentary, ordinary messages, or a different key, including hidden commentary boundaries. Preserve first-row IDs, tool parsing and duplicate counts, visibility flags, and existing finality/staleness rules. Keep any turn-wide finality bookkeeping separate from output positioning. Do not sort timestamps, mutate input messages, or change persistence/protocol semantics.
3. Update the obsolete first-position anchoring comments and verify the existing ChatApp.svelte integration needs no interface change. Keep implementation scoped to the coalescer and its tests; no workflow-panel redesign, producer changes, or schema migration.

## Validation

1. Run node --test apps/web/src/lib/agent-activity-display.test.ts, then pnpm --filter @clickclack/web test and pnpm --filter @clickclack/web typecheck.
2. Cover hidden commentary/tools combinations, missing turn IDs, same turn IDs across authors/conversations, consecutive duplicate tools, stale turns, trailing live blocks, and late rows without relocating ordinary messages.
3. Verify in ClickClack Electron that bot activity separated by a human message stays on the correct side of that message, adjacent tools still collapse, and appending activity does not move earlier rows. Follow deployment completion checks before claiming the change is live.

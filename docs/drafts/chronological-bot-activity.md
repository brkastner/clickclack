# Chronological bot activity (KAS-753)

Status: Implemented in commit `5cedf5df` and locally verified. Deployment has not been verified.

Specification: [Chronological bot activity](../../SPEC.md#chronological-bot-activity-kas-753).

## Implementation record

KAS-753 was implemented in commit `5cedf5df` and remains intact at HEAD. The
subsequent documentation status reconciliation is complete: the specification,
this record, and the messages feature documentation now consistently describe
chronological in-place rendering as implemented and locally verified, without
claiming deployment. No coalescer or interface changes were needed.

## Implemented behavior

- Preserve supplied conversation order by emitting commentary in place.
- Coalesce only contiguous `agent_tool` rows with the existing
  conversation/author/turn key.
- End a tool block at commentary, ordinary-message, and key-change boundaries,
  including when commentary is hidden.
- Preserve first-row IDs, tool parsing, duplicate counts, visibility flags, and
  existing finality and staleness rules.

The implementation does not sort timestamps, mutate input messages, change
persistence or protocol semantics, or change the `ChatApp.svelte` interface.

## Local verification

Completed local verification covers the focused activity test, full web test
suite, web typecheck, and Electron activity proof. It also confirms that
`5cedf5df` is an ancestor of HEAD and that no later commit changed the KAS-753
implementation files:

1. `node --test apps/web/src/lib/agent-activity-display.test.ts`
2. `pnpm --filter @clickclack/web test`
3. `pnpm --filter @clickclack/web typecheck`
4. `node scripts/test-agent-activity-electron.mjs`

Deployment completion checks are still required before describing KAS-753 as
live.

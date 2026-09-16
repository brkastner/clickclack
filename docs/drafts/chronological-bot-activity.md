# Chronological bot activity (KAS-753)

Status: Implemented in commit `5cedf5df` and locally verified. Deployment has not been verified.

Specification: [Chronological bot activity](../../SPEC.md#chronological-bot-activity-kas-753).

The selected summary, ordered steps, and validation below are preserved verbatim.

## Summary

KAS-753 is already implemented in commit 5cedf5df and remains intact at HEAD. The smallest remaining change is to reconcile the stale documentation that still says the fix is only selected for implementation, while avoiding any coalescer or interface changes.

## Ordered steps

1. Update the KAS-753 status text in SPEC.md, docs/drafts/chronological-bot-activity.md, and docs/features/messages.md to state that chronological in-place rendering is implemented and locally verified, without claiming deployment.
2. Leave apps/web/src/lib/chat/agent-activity.ts, its tests, and the ChatApp.svelte interface unchanged unless validation exposes a regression; the current implementation already preserves supplied order and coalesces only contiguous same-key tool rows.
3. Review the final diff to ensure it contains documentation status reconciliation only and does not broaden scope into persistence, protocol, producer, schema, or workflow-panel changes.

## Validation

1. Run node --test apps/web/src/lib/agent-activity-display.test.ts.
2. Run pnpm --filter @clickclack/web test and pnpm --filter @clickclack/web typecheck.
3. Run node scripts/test-agent-activity-electron.mjs to verify human/final boundaries, adjacent tool collapse, and stable earlier rows after late activity is appended.
4. Confirm commit 5cedf5df is an ancestor of HEAD and that no later commit changed the KAS-753 implementation files.

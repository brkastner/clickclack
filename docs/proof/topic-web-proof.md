# Message topic web proof

This proof runs the built production web bundle against the real Go API and
exercises the rendered channel UI.

## Reproduction

```sh
TOPIC_FILTER_PROOF_PATH=/tmp/clickclack-topic-filter.png \
TOPIC_MOBILE_PROOF_PATH=/tmp/clickclack-topic-mobile.png \
pnpm exec playwright test tests/e2e/topic-web.spec.ts --workers=1
```

The scenario verifies:

- channel-scoped and workspace-wide topics appear in the composer selector;
- sent root messages retain and render their topic label;
- clicking a label activates server-side topic pagination;
- non-matching realtime creates stay out of the filtered timeline;
- matching realtime creates appear without a reload;
- filtered views preserve channel-wide read receipts and local unread badges;
- changing topics or channels discards stale in-flight filtered pages;
- clearing the filter restores tagged and untagged messages; and
- the selector and timeline remain usable without horizontal overflow at a
  390-pixel viewport.

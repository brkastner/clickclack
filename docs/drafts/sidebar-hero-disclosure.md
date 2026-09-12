# Sidebar hero header disclosure implementation plan

**Status: Selected for implementation. This documentation change does not implement or deploy it.**

Task: [KAS-890](https://linear.app/kashub/issue/KAS-890/toggle-sidebar-sections-from-hero-headers-instead-of-navigating).

The canonical behavior is specified in [SPEC.md](../../SPEC.md#sidebar-hero-header-disclosure-kas-890). The feature description is in [Workspaces](../features/workspaces.md).

## Summary

Replace persona hero-header DM navigation with persistent, independent disclosure controls. Keep named channel navigation, the separate + action, existing hero rendering, and all other DM entry points unchanged.

## Selected implementation steps

1. Extend Sidebar.svelte's existing workspace-scoped clickclack:sidebar-sections:v1 persistence with an optional per-persona expansion map keyed by bot_user_id. Preserve existing channels/directMessages/archived flags and old stored values. Missing persona entries default to expanded, malformed storage falls back safely, and disclosure remains usable when storage fails. Pass the map and toggle callback to the active ChannelList.
2. In ChannelList.svelte, replace only the hero header's profile-source-link anchor and DM-navigation handler with a native type=button disclosure. Add aria-expanded, aria-controls targeting a stable per-persona list ID, and a visible caret. Hide the entire owned channel list when collapsed, including selected/unread rows, without changing the selected conversation or marking anything read. Keep unread summary badges, channel count, Avatar hero geometry and scrim, sibling + button, drag handle, ordering and assignment drop targets unchanged. Keep empty sections toggleable. Remove only ChannelList props/callbacks made unused by this change, not Sidebar's other DM actions.
3. Add focused persistence tests and an isolated Electron regression using the existing scripts/test-bot-avatar-packs-electron.mjs fixture pattern, mounting the real Sidebar with synthetic data and callback instrumentation. Make only small sidebar.css adjustments needed for button reset, focus and caret placement without disturbing the existing hero opacity/crop styles. Regenerate embedded web assets through the canonical build.

## Selected validation

- Run pnpm --filter @clickclack/web test and pnpm --filter @clickclack/web typecheck, plus scoped oxlint for changed source and test files.
- Run the new isolated Electron test: mouse, Enter and Space toggle independently; expanded state and controlled-list visibility agree; hidden rows leave the tab order; existing-DM and no-DM headers never invoke select/start-DM callbacks; selected conversation and unread badges remain unchanged. Cover an empty section, reload persistence, workspace switching, legacy/malformed/unavailable storage, and reordering by stable persona identity.
- In Electron, verify + still invokes creation with the correct profile without toggling; named rows still navigate after expansion; other DM entry points and existing channel pinning remain available. Check visible caret, focus, hero image and controls in both themes and sidebar sizes. Use isolated synthetic data, not live conversations.
- Run pnpm build and node scripts/test-bot-avatar-packs-electron.mjs to preserve the deployed hero zoom/fading regression coverage. Deployment is a later lifecycle stage, not part of this planning step.

## Boundaries

Scope is ClickClack only. The + action continues creating a named channel assigned to the section. Do not delete or migrate existing DMs, remove other DM entry points, or change backend ownership/routing. KAS-891 header context-menu section pinning and KAS-892 section sorting by latest owned-channel message remain backlog follow-ups, not part of this implementation. Existing channel pinning is separate from the proposed section pinning and must remain available.

The previous hero zoom/fading fix is deployed and owner accepted. Preserve it and keep its [implementation plan](sidebar-hero-rendering.md) as a separate historical record. Existing top-level Channels/DM disclosure and its priority-row behavior remain unchanged. Persona disclosure hides all of its owned rows instead.

This document records the selected plan, not test results. Implementation, validation, build, and deployment belong to later workflow stages.

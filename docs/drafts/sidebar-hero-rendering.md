# Sidebar hero rendering implementation plan

**Status: Selected for implementation; not implemented or deployed by this documentation change.**

This plan preserves the selected solution for both requested sidebar corrections:
zoom below 100% must reveal more available image, and hero images must look less
faded while labels remain readable. The screenshots supplied with the request
identify the affected sidebar hero sections.

The canonical behavior is specified in [SPEC.md](../../SPEC.md#sidebar-hero-rendering-correction).
The existing feature description is in [Workspaces](../features/workspaces.md).

## Summary

Fix hero-only image geometry so zoom reveals previously cropped source content, and reduce sidebar image fading without changing ordinary avatars or saved crop settings.

## Selected implementation steps

1. In apps/web/src/components/avatar/Avatar.svelte, add an opt-in hero rendering mode used by ChannelList.svelte and ProfileEditor.svelte. Current rendering scales an already object-fit:cover-cropped, container-sized image. Instead size the actual image from its natural aspect ratio and the container's cover scale, multiplied by zoom, and clip only at the hero viewport. Share the geometry between preview and sidebar; respond to image load/source changes and container resizing. Preserve the current 100% crop, horizontal pan convention, vertical positioning, transform origin, saved x/y/zoom values, default 118%, and 25–250% range. Below the cover scale, allow uncovered viewport space rather than stretching the image or re-clamping zoom. Leave standard Avatar rendering unchanged.
2. In apps/web/src/styles/sidebar.css, increase resting .persona-band opacity from 0.72 to approximately 0.9 and reduce the .persona-band-scrim gradient from 78/48/22/56% panel mixing to approximately 55/25/10/35%. Preserve label shadows and unread/active indicators; tune only as needed for readable labels in light and dark themes. Update hero image rules in sidebar.css and styles/thread.css for the shared geometry, retaining subtle edge fading without masking source content before zoom.
3. Add focused geometry regression tests and update lib/avatar-size-toggle.test.ts and lib/bot-avatar-packs.test.ts assertions that currently lock in the broken transform. Build with the canonical pnpm build so embedded web assets are regenerated. Keep deployment and live verification in the workflow's later stages.

## Selected validation

- Test portrait, landscape, and square sources at 25%, 50%, 100%, 118%, and 250%, including pan extremes and container resizing. Assert proportional source dimensions, matching 100% baseline, and increased visible source area when zooming out, up to the complete source.
- Run pnpm --filter @clickclack/web test, pnpm --filter @clickclack/web typecheck, and pnpm build. Check that ordinary avatars, source fallback, and light/dark source switching are unchanged.
- Verify in Electron using a recognizably marked image: editor preview and saved sidebar show the same crop at matching viewport sizes; lower zoom exposes additional content rather than shrinking a pre-cropped strip. Check drag/keyboard pan, reset, persistence after reload, both sidebar sizes, and label/add-control/unread readability in light and dark themes.

## Completion boundary

This document records the selected plan, not test results. Implementation,
regression tests, the canonical build, deployment, and live Electron verification
remain to be performed in their respective workflow stages. No settings migration
or change to ordinary avatar behavior is part of this plan.

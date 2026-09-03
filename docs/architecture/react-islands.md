---
read_when:
  - adding a React panel or surface inside the Svelte app
  - changing how an existing island mounts, renders, or fails
  - deciding whether a new surface belongs in Svelte or React
---

# React islands

`apps/web` is a Svelte 5 app. A few surfaces render in React instead, mounted
into the Svelte tree as islands. This page covers when to reach for one and the
contract every island follows.

An island owns one rectangle of presentation and interaction. Everything else
stays with the shell.

## The authority boundary

This is the part that matters. Get it wrong and the island stops being a
rectangle and starts being a second application.

Svelte owns routing, workspace and channel state, durable messages, unread
counts, realtime subscriptions, persistence, the composer, attachments, and
voice. React owns rendering and interaction inside its own rectangle, and
nothing else.

So an island:

- receives everything it needs as props;
- routes every mutation back out through callbacks;
- does not fetch, subscribe, or write.

An island that calls the API directly has escaped the boundary. Two components
now believe they own the same state, and they will disagree. Add a callback and
let the shell do the write.

## Adding one

Two files. The island itself, and a Svelte host.

The island exports a mount function built by `createReactIsland`:

```tsx
// apps/web/src/components/example/ExampleIsland.tsx
import { createReactIsland, type ReactIsland } from "../../lib/react-island";

export type ExampleProps = {
  items: Item[];
  onClose: () => void;
};

function Example({ items, onClose }: ExampleProps) {
  // ...
}

function ExampleFallback({ onClose }: ExampleProps) {
  return (
    <section role="alert">
      <button type="button" onClick={onClose}>Close</button>
      <p>Example couldn't be displayed.</p>
    </section>
  );
}

export type ExampleIsland = ReactIsland<ExampleProps>;

export const mountExampleIsland = createReactIsland<ExampleProps>({
  name: "Example",
  component: Example,
  fallback: ExampleFallback,
});
```

The host passes that mount function to `ReactIslandHost`:

```svelte
<!-- apps/web/src/components/example/Example.svelte -->
<script lang="ts">
  import ReactIslandHost from "../ReactIslandHost.svelte";
  import { mountExampleIsland, type ExampleProps } from "./ExampleIsland";

  let { items, onClose }: ExampleProps = $props();

  const islandProps: ExampleProps = $derived({ items, onClose });
</script>

<ReactIslandHost mount={mountExampleIsland} props={islandProps} class="example-island" />
```

The rest of the app imports the Svelte component and never knows React is
involved. That indirection is deliberate: it keeps React out of the shell's
import graph and leaves the island replaceable.

Props are a single `$derived` object rather than individual attributes so the
island re-renders as one unit whenever any input changes.

## What the shared mount handles

`apps/web/src/lib/react-island.tsx` owns the React root and the error boundary.
Islands own neither. Before it existed both islands hand-rolled both, and the
two copies had already drifted.

`createReactIsland` returns `mount(element, initialProps)`, which gives back
`{ render, unmount }`. `ReactIslandHost` calls `mount` on mount, `render` on
every prop change, and `unmount` on teardown.

## Failure

Every island declares a fallback. It receives the island's full props, so it can
keep affordances the shell depends on reachable. A panel that crashes must still
be closeable, which means the fallback needs the same `onClose` the island had.

A failed island stays failed until it is unmounted. Re-rendering into a boundary
that already caught would replay whatever broke, and the shell has no way to
know the underlying cause cleared. An island that genuinely needs to recover
should be remounted deliberately, not re-rendered and hoped over.

Render errors are logged with the island's `name`, which is the only thing that
field is for. Give it something you would want to read in a console.

## When to use one

Reach for an island when a surface needs a React library that has no Svelte
equivalent worth the trouble, or when the interaction model is complex enough
that React's ecosystem earns its keep. Both current islands qualify: a gallery
viewer and a pinned-message panel, each dense with interaction and neither
touching shell state.

Don't reach for one to avoid learning Svelte. The shell is Svelte, most of the
app is Svelte, and a React island costs a boundary, a fallback, and a second
mental model for whoever reads it next.

## Current islands

- `components/media/ImageViewerIsland.tsx` — full-screen image gallery.
- `components/pins/PinnedPanelIsland.tsx` — pinned messages side panel.

The message thread was prototyped as an island
(`examples/assistant-ui-island-prototype/`) and never migrated. The composer was
explicitly excluded from that plan and is expected to stay Svelte.

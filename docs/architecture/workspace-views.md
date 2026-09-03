---
read_when:
  - adding a custom screen beside chat
  - changing the view registry, route, or shell
  - deciding whether something is a view, a panel, or a channel
---

# Workspace views

A view is a full-surface screen that lives beside chat rather than inside it,
at `/app/{workspaceID}/views/{slug}`. Chat answers what is being said in a
channel. A view answers something the channel list cannot: a home dashboard, an
activity feed, an operations panel.

Views share the workspace and the URL space. They own their content area
outright.

## Adding one

One entry in `apps/web/src/lib/views.ts` and one component. No route file.

```ts
export const WORKSPACE_VIEWS: WorkspaceView[] = [
  {
    id: "home",
    slug: "home",
    label: "Home",
    description: "Recent activity across this workspace.",
    icon: ["M3 10.5 12 3l9 7.5", "M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"],
    load: () => import("../components/views/HomeView.svelte"),
  },
];
```

The registry drives the route, the view shell's rail, and the sidebar links. A
view that is registered is reachable; one that is not returns a 404 rather than
rendering an empty shell.

`load` is a dynamic import on purpose. A view's code and its dependencies stay
out of the chat bundle until someone opens it, so a view that pulls in a heavy
charting or React dependency costs nothing to anyone who never visits it.

The component receives `WorkspaceViewProps`, currently just `workspaceID`. The
route resolves the workspace before rendering, so a view never parses the URL
or refetches what the shell already has.

`ViewScaffold.svelte` gives a view a title, an optional description, a header
actions slot, and a body. Using it keeps headers consistent. Skipping it is
allowed when a view wants the whole area.

## How the route works

`views/[viewSlug]` is one dynamic route serving every registered view. Its
loader looks the slug up in the registry, 404s on a miss, resolves the
workspace, and awaits the view's own module before returning. Resolving the
component in the loader rather than the page means a view that fails to load is
a load error instead of a half-rendered shell.

`/app/{workspaceID}/views` with no slug redirects to `DEFAULT_WORKSPACE_VIEW`.

`views/+layout.svelte` is the shell: a rail listing every registered view, a
back control, and Escape to return to chat. That mirrors workspace settings,
which is the same shape one level over.

## Views, panels, and channels

Three surfaces, easy to confuse:

- A **channel** is conversation. If the thing is messages, it is a channel.
- A **panel** docks beside chat and belongs to the conversation in view, like
  pinned messages or a thread. It is chat-scoped and disappears with it.
- A **view** replaces the content area and belongs to the workspace. It has a
  URL, survives navigation, and is reachable without a channel selected.

A dashboard is a view. A thread is a panel. Getting this wrong produces a
dashboard that vanishes when you click a channel, or a thread that owns a URL
it has no business owning.

## Rendering in React

Views are Svelte components. One that wants React renders a
[React island](react-islands.md) inside itself, the same as any other surface.
The two systems compose: a view owns the route and the workspace shell, an
island owns a rectangle inside it.

The authority boundary from that page still applies. The shell owns data,
routing, and persistence; React owns presentation inside its rectangle.

## Current views

- `components/views/HomeView.svelte` — placeholder. The route, registry, and
  shell around it are settled; what it displays is not.

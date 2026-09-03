import type { Component } from "svelte";

// Views are custom full-surface screens that live beside chat rather than
// inside it, at /app/{workspaceID}/views/{slug}.
//
// Chat answers "what is being said in this channel". A view answers something
// the channel list cannot: a home dashboard, an activity feed, an operations
// panel. They share the workspace shell and the sidebar, and they own their
// own content area.
//
// This registry is the only place a view is declared. Adding one means adding
// an entry here and a component; it does not mean adding a route.

export type WorkspaceViewId = string;

export type WorkspaceView = {
  id: WorkspaceViewId;
  // URL segment under /app/{workspaceID}/views/.
  slug: string;
  label: string;
  // Shown under the title when the view renders its own header.
  description?: string;
  // Inline SVG path data strings for the sidebar icon (24×24 stroke icons),
  // matching the convention in settings.ts.
  icon: string[];
  // Loaded on navigation, so a view's code and its dependencies stay out of
  // the initial chat bundle. A view that pulls in a heavy charting or React
  // dependency costs nothing until someone opens it.
  load: () => Promise<{ default: Component<WorkspaceViewProps> }>;
};

// Every view receives the same props. The route resolves the workspace before
// rendering, so a view never has to parse the URL or refetch what the shell
// already knows.
export type WorkspaceViewProps = {
  workspaceID: string;
};

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

export const DEFAULT_WORKSPACE_VIEW = "home";

export function workspaceViewsPath(workspaceID: string, slug?: string): string {
  const base = `/app/${workspaceID}/views`;
  return slug ? `${base}/${slug}` : base;
}

export function findWorkspaceView(slug: string): WorkspaceView | undefined {
  return WORKSPACE_VIEWS.find((view) => view.slug === slug);
}

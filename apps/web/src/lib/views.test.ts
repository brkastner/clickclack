import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_WORKSPACE_VIEW,
  WORKSPACE_VIEWS,
  findWorkspaceView,
  workspaceViewsPath,
} from "./views.ts";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("view slugs are unique and URL-safe", () => {
  const slugs = WORKSPACE_VIEWS.map((view) => view.slug);
  assert.equal(new Set(slugs).size, slugs.length, "slugs must be unique");

  for (const slug of slugs) {
    assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u, `${slug} should be a lowercase slug`);
  }

  const ids = WORKSPACE_VIEWS.map((view) => view.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
});

test("the default view is registered", () => {
  assert.ok(
    findWorkspaceView(DEFAULT_WORKSPACE_VIEW),
    "the redirect target must exist, or /views lands on a 404",
  );
});

test("unknown slugs resolve to nothing rather than a fallback view", () => {
  assert.equal(findWorkspaceView("does-not-exist"), undefined);
});

test("view paths sit beside chat under the workspace", () => {
  assert.equal(workspaceViewsPath("T01"), "/app/T01/views");
  assert.equal(workspaceViewsPath("T01", "home"), "/app/T01/views/home");
});

test("views are lazily loaded so they stay out of the chat bundle", () => {
  const source = readSource("./views.ts");
  assert.match(source, /load: \(\) => import\(/u);
  assert.doesNotMatch(
    source,
    /^import .*components\/views/mu,
    "views must not be imported eagerly at the top of the registry",
  );
});

test("one dynamic route serves every registered view", () => {
  const page = readSource("../routes/app/[workspaceID]/views/[viewSlug]/+page.svelte");
  const loader = readSource("../routes/app/[workspaceID]/views/[viewSlug]/+page.ts");

  assert.match(loader, /findWorkspaceView\(params\.viewSlug\)/u);
  assert.match(loader, /throw error\(404/u, "an unregistered slug should 404, not render blank");
  assert.match(loader, /await view\.load\(\)/u);
  assert.match(page, /<ViewComponent \{workspaceID\} \/>/u);
});

test("the bare views path redirects to the default view", () => {
  const source = readSource("../routes/app/[workspaceID]/views/+page.ts");
  assert.match(source, /redirect\(\s*307/u);
  assert.match(source, /DEFAULT_WORKSPACE_VIEW/u);
});

test("the view shell lists the registry rather than hardcoding entries", () => {
  const layout = readSource("../routes/app/[workspaceID]/views/+layout.svelte");

  assert.match(layout, /#each WORKSPACE_VIEWS as view/u);
  assert.match(layout, /workspaceViewsPath\(workspaceID, view\.slug\)/u);
  assert.match(layout, /Escape/u, "Escape should return to chat, matching workspace settings");
  assert.match(
    layout,
    /event\.defaultPrevented/u,
    "Escape already handled by an overlay must not leave the view",
  );
  assert.match(
    layout,
    /dialog\[open\]/u,
    "Escape must dismiss an open action dialog without leaving Gallery",
  );
  const chatApp = readSource("../ChatApp.svelte");
  assert.match(
    chatApp,
    /event\.key === "Escape"[\s\S]*?dialog\[open\][\s\S]*?jumpToLiveChat\(\)/u,
    "the capture-phase chat shortcut must leave native dialogs to their own Escape handler",
  );
});

test("mobile full-screen routes and overlays respect every safe-area edge", () => {
  const home = readSource("../components/views/HomeView.svelte");
  const gallery = readSource("../components/outputs/OutputGallery.svelte");
  const copyLink = readSource("../components/messages/CopyLinkFallback.svelte");
  const viewStyles = readSource("../styles/views.css");
  const settings = readSource("../styles/settings.css");
  const modals = readSource("../styles/modals.css");

  assert.match(home, /calc\(17px \+ var\(--safe-area-top\)\)/u);
  assert.match(home, /calc\(66px \+ var\(--safe-area-left\)\)/u);
  assert.match(home, /calc\(14px \+ var\(--safe-area-bottom\)\)/u);
  assert.match(gallery, /calc\(1rem \+ var\(--safe-area-bottom\)\)/u);
  assert.match(gallery, /--safe-area-left/u);
  assert.match(viewStyles, /calc\(14px \+ var\(--safe-area-top\)\)/u);
  assert.match(viewStyles, /--safe-area-right/u);
  assert.match(settings, /\.ws-settings \{\s+padding: var\(--safe-area-top\)/u);
  assert.match(settings, /\.settings-modal-scrim \{\s+place-items: stretch;/u);
  assert.match(modals, /calc\(24px \+ var\(--safe-area-bottom\)\)/u);
  assert.match(copyLink, /calc\(20px \+ var\(--safe-area-bottom\)\)/u);
});

test("the sidebar links views from the registry", () => {
  const sidebar = readSource("../components/navigation/Sidebar.svelte");

  assert.match(sidebar, /import \{ WORKSPACE_VIEWS, workspaceViewsPath \}/u);
  assert.match(sidebar, /#each WORKSPACE_VIEWS as view/u);
});

test("mobile routes share a persistent Home, Gallery, and Chat navigation bar", () => {
  const workspaceLayout = readSource("../routes/app/[workspaceID]/+layout.svelte");
  const navigation = readSource("../components/navigation/MobileBottomNavigation.svelte");
  const layoutStyles = readSource("../styles/layout.css");
  const viewStyles = readSource("../styles/views.css");

  assert.match(workspaceLayout, /<MobileBottomNavigation \/>/u);
  assert.match(navigation, />Home<\/span>/u);
  assert.match(navigation, />Gallery<\/span>/u);
  assert.match(navigation, />Chat<\/span>/u);
  assert.match(navigation, /aria-current=/u);
  assert.match(navigation, /var\(--safe-area-bottom\)/u);
  assert.match(layoutStyles, /var\(--app-vh\) - var\(--mobile-bottom-nav-height\)/u);
  assert.match(viewStyles, /inset: 0 0 var\(--mobile-bottom-nav-height\)/u);
});

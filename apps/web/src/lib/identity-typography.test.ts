import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("bundles Oswald and uses it for display typography", () => {
  const imports = readSource("../styles/index.css");
  const base = readSource("../styles/base.css");

  assert.match(imports, /@import "@fontsource-variable\/oswald";/u);
  assert.match(base, /--font-display:\s*"Oswald Variable"/u);
  assert.match(
    base,
    /:where\(h1, h2, h3, h4, h5, h6\)\s*\{[\s\S]*?font-family:\s*var\(--font-display\);/u,
  );
});

test("uses display typography for usernames across the app", () => {
  const messages = readSource("../styles/messages.css");
  const sidebar = readSource("../styles/sidebar.css");
  const settings = readSource("../styles/settings.css");
  const thread = readSource("../styles/thread.css");

  assert.match(
    messages,
    /\.message-group \.author-name\s*\{[\s\S]*?font-family:\s*var\(--font-display\);/u,
  );
  assert.match(sidebar, /\.sidebar-person-name\s*\{[\s\S]*?font-family:\s*var\(--font-display\);/u);
  assert.match(
    sidebar,
    /\.nav-item\.dm \.nav-label\s*\{[\s\S]*?font-family:\s*var\(--font-display\);/u,
  );
  assert.match(
    sidebar,
    /\.sidebar-profile-groups \.channel-subgroup-toggle\s*\{[\s\S]*?font-family:\s*var\(--font-display\);/u,
  );
  assert.match(settings, /\.ws-members__name\s*\{[\s\S]*?font-family:\s*var\(--font-display\);/u);
  assert.match(settings, /\.ws-bots__row-name\s*\{[\s\S]*?font-family:\s*var\(--font-display\);/u);
  assert.match(
    thread,
    /\.thread > header strong\s*\{[\s\S]*?font-family:\s*var\(--font-display\);/u,
  );
});

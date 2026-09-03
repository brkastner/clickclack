import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const islands = [
  {
    label: "pinned panel",
    island: "../components/pins/PinnedPanelIsland.tsx",
    host: "../components/pins/PinnedPanel.svelte",
    mount: "mountPinnedPanelIsland",
    hostClass: "pinned-panel-island",
  },
  {
    label: "image viewer",
    island: "../components/media/ImageViewerIsland.tsx",
    host: "../components/media/ImageViewer.svelte",
    mount: "mountImageViewerIsland",
    hostClass: "image-viewer-island",
  },
];

test("every island mounts through the shared contract", () => {
  for (const { label, island, mount } of islands) {
    const source = readSource(island);
    assert.match(
      source,
      new RegExp(`export const ${mount} = createReactIsland`, "u"),
      `${label} should build its mount with createReactIsland`,
    );
    assert.match(
      source,
      /createReactIsland[\s\S]*?fallback:/u,
      `${label} should declare a fallback for render failures`,
    );
  }
});

test("islands never create their own React root or error boundary", () => {
  for (const { label, island } of islands) {
    const source = readSource(island);
    assert.doesNotMatch(source, /createRoot/u, `${label} should not own a React root`);
    assert.doesNotMatch(
      source,
      /getDerivedStateFromError/u,
      `${label} should not hand-roll an error boundary`,
    );
  }
});

test("the shared mount owns the root and the boundary", () => {
  const source = readSource("./react-island.tsx");

  assert.match(source, /createRoot/u);
  assert.match(source, /getDerivedStateFromError/u);
  assert.match(source, /componentDidCatch/u);
  assert.match(source, /unmount: \(\) => root\.unmount\(\)/u);
});

test("svelte hosts delegate lifecycle to ReactIslandHost", () => {
  for (const { label, host, mount, hostClass } of islands) {
    const source = readSource(host);

    assert.match(
      source,
      /import ReactIslandHost from "\.\.\/ReactIslandHost\.svelte"/u,
      `${label} host should use the shared island host`,
    );
    assert.match(source, new RegExp(`mount=\\{${mount}\\}`, "u"));
    assert.match(source, new RegExp(`class="${hostClass}"`, "u"));

    assert.doesNotMatch(source, /onMount/u, `${label} host should not manage mounting itself`);
    assert.doesNotMatch(
      source,
      /island\?\.render/u,
      `${label} host should not drive island renders itself`,
    );
  }
});

test("ReactIslandHost unmounts the island when the shell tears it down", () => {
  const source = readSource("../components/ReactIslandHost.svelte");

  assert.match(source, /onMount\(\(\) => \{/u);
  assert.match(source, /island = mount\(hostElement, props\)/u);
  assert.match(source, /island\?\.unmount\(\)/u);
  assert.match(source, /\$effect\(\(\) => \{\s*island\?\.render\(props\);/u);
});

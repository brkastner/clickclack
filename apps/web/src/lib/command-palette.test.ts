import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RECENT_COMMANDS,
  flattenSections,
  fuzzyMatch,
  highlightRuns,
  isPaletteShortcut,
  parseRecentCommands,
  rankCommands,
  rememberRecentCommand,
  type PaletteCommand,
} from "./command-palette.ts";

const noop = () => {};

function command(
  id: string,
  label: string,
  group: PaletteCommand["group"],
  extra: Partial<PaletteCommand> = {},
): PaletteCommand {
  return { id, label, group, run: noop, ...extra };
}

const commands: PaletteCommand[] = [
  command("view:home", "Home", "navigation"),
  command("view:gallery", "Gallery", "navigation"),
  command("action:new-channel", "New channel", "actions"),
  command("action:new-direct", "New direct message", "actions", { keywords: ["dm"] }),
  command("action:toggle-theme", "Toggle theme", "actions", {
    keywords: ["dark mode", "light mode"],
  }),
  command("channel:1", "general", "channels"),
  command("channel:2", "agent-engine", "channels"),
  command("channel:3", "random", "channels", { current: true }),
  command("direct:1", "Kai", "directs"),
];

const ids = (query: string, recent: string[] = []) =>
  flattenSections(rankCommands(query, commands, recent)).map((item) => item.command.id);

test("fuzzy matching finds in-order subsequences and rejects missing characters", () => {
  assert.ok(fuzzyMatch("nc", "New channel"));
  assert.ok(fuzzyMatch("gnrl", "general"));
  assert.equal(fuzzyMatch("xyz", "general"), null);
  assert.equal(fuzzyMatch("lareneg", "general"), null);
});

test("substring and word-start matches outrank scattered ones", () => {
  const prefix = fuzzyMatch("gen", "general");
  const scattered = fuzzyMatch("gen", "agent-engine");
  assert.ok(prefix && scattered);
  assert.ok(prefix.score > scattered.score);
  assert.deepEqual(ids("gen").slice(0, 1), ["channel:1"]);
});

test("keywords match but rank under label matches", () => {
  assert.equal(ids("dm")[0], "action:new-direct");
  assert.ok(ids("dark").includes("action:toggle-theme"));
});

test("a blank query lists recents first and then each group", () => {
  const sections = rankCommands("", commands, ["channel:2", "view:gallery"]);
  assert.equal(sections[0]?.group, "recent");
  assert.deepEqual(
    sections[0]?.items.map((item) => item.command.id),
    ["channel:2", "view:gallery"],
  );
  // Recents aren't repeated in their own group.
  const channels = sections.find((section) => section.group === "channels");
  assert.ok(channels);
  assert.ok(!channels.items.some((item) => item.command.id === "channel:2"));
});

test("the current conversation sinks to the end and never shows as recent", () => {
  const sections = rankCommands("", commands, ["channel:3"]);
  assert.notEqual(sections[0]?.group, "recent");
  const channels = sections.find((section) => section.group === "channels");
  assert.equal(channels?.items.at(-1)?.command.id, "channel:3");
  assert.deepEqual(ids("a").at(-1), "channel:3");
});

test("recent commands get a boost when they match", () => {
  const without = ids("e");
  const withRecent = ids("e", ["direct:1"]);
  assert.ok(withRecent.indexOf("direct:1") <= without.indexOf("direct:1"));
});

test("duplicate ids from different providers show once", () => {
  const doubled = [...commands, command("view:home", "Home again", "navigation")];
  const found = flattenSections(rankCommands("home", doubled)).map((item) => item.command.label);
  assert.deepEqual(found, ["Home"]);
});

test("a query with no matches returns no sections", () => {
  assert.deepEqual(rankCommands("zzzz", commands), []);
});

test("highlight runs cover the whole label", () => {
  const runs = highlightRuns("general", [0, 1, 2]);
  assert.deepEqual(runs, [
    { text: "gen", match: true },
    { text: "eral", match: false },
  ]);
  assert.equal(runs.map((run) => run.text).join(""), "general");
});

test("recents are most-recent-first, unique, and bounded", () => {
  let recent: string[] = [];
  for (let index = 0; index < MAX_RECENT_COMMANDS * 3; index += 1)
    recent = rememberRecentCommand(recent, `c${index}`);
  recent = rememberRecentCommand(recent, "c14");
  assert.equal(recent[0], "c14");
  assert.equal(new Set(recent).size, recent.length);
  assert.ok(recent.length <= MAX_RECENT_COMMANDS * 2);
  assert.deepEqual(parseRecentCommands(JSON.stringify(recent)), recent);
  assert.deepEqual(parseRecentCommands("not json"), []);
  assert.deepEqual(parseRecentCommands(JSON.stringify({ a: 1 })), []);
  assert.deepEqual(parseRecentCommands(JSON.stringify(["a", 2, "b"])), ["a", "b"]);
});

test("ctrl+k opens the palette, cmd+k on macOS, and shifted chords are left alone", () => {
  const base = {
    key: "k",
    code: "KeyK",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  };
  assert.equal(isPaletteShortcut({ ...base, ctrlKey: true }, false), true);
  assert.equal(isPaletteShortcut({ ...base, key: "K", ctrlKey: true }, false), true);
  assert.equal(isPaletteShortcut({ ...base, metaKey: true }, true), true);
  assert.equal(isPaletteShortcut({ ...base, metaKey: true }, false), false);
  assert.equal(isPaletteShortcut({ ...base, ctrlKey: true, shiftKey: true }, false), false);
  assert.equal(isPaletteShortcut({ ...base, ctrlKey: true, altKey: true }, false), false);
  assert.equal(isPaletteShortcut({ ...base, ctrlKey: true, isComposing: true }, false), false);
  assert.equal(isPaletteShortcut({ ...base }, false), false);
  // Non-latin layouts still report the physical key.
  assert.equal(isPaletteShortcut({ ...base, key: "л", ctrlKey: true }, false), true);
});

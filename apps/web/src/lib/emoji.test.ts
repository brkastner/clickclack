import assert from "node:assert/strict";
import test from "node:test";
import {
  EMOJI_CATALOG,
  completedShortcodeAt,
  emojiCharForShortcode,
  emojiForShortcode,
  mergeRecentEmoji,
  replaceShortcodes,
  replaceShortcodesOutsideCode,
  searchEmoji,
} from "./emoji.ts";

test("resolves canonical shortcodes and aliases", () => {
  assert.equal(emojiCharForShortcode("sob"), "😭");
  assert.equal(emojiCharForShortcode(":sob:"), "😭");
  assert.equal(emojiCharForShortcode("SOB"), "😭");
  assert.equal(emojiCharForShortcode("upside_down_face"), "🙃");
  assert.equal(emojiCharForShortcode("upside_down"), "🙃");
  assert.equal(emojiCharForShortcode("+1"), "👍");
  assert.equal(emojiCharForShortcode("thumbsup"), "👍");
  assert.equal(emojiCharForShortcode("not_a_real_emoji"), null);
  assert.equal(emojiCharForShortcode(""), null);
});

test("catalog shortcodes are unique and well formed", () => {
  const seen = new Map<string, string>();
  for (const entry of EMOJI_CATALOG) {
    for (const code of [entry.name, ...entry.aliases]) {
      assert.match(code, /^[a-z0-9_+-]+$/, `bad shortcode ${code}`);
      assert.equal(seen.has(code), false, `duplicate shortcode ${code}`);
      seen.set(code, entry.char);
    }
    assert.ok(entry.char.length > 0);
  }
});

test("ranks shortcode search by exactness then prefix then keywords", () => {
  assert.equal(searchEmoji("sob")[0].char, "😭");
  assert.equal(searchEmoji("smile")[0].name, "smile");
  assert.equal(searchEmoji("upside")[0].name, "upside_down_face");
  const cryResults = searchEmoji("cry").map((entry) => entry.name);
  assert.equal(cryResults[0], "cry");
  assert.ok(cryResults.includes("sob"), "keyword match should surface :sob:");
  assert.equal(searchEmoji("zzzzz").length, 0);
  assert.equal(searchEmoji("a", 3).length, 3);
});

test("detects a just-completed shortcode at the caret", () => {
  const match = completedShortcodeAt("hey :sob:");
  assert.ok(match);
  assert.equal(match.char, "😭");
  assert.equal(match.shortcode, "sob");
  assert.equal("hey :sob:".slice(match.start, match.end), ":sob:");

  assert.equal(completedShortcodeAt("hey :sob: ok"), null, "caret must follow the code");
  assert.equal(completedShortcodeAt(":nope:"), null, "unknown codes stay literal");
  assert.equal(completedShortcodeAt("http://x:8080:"), null, "no boundary before colon");
  assert.ok(completedShortcodeAt("(:tada:"), "opening bracket is a valid boundary");
  assert.ok(completedShortcodeAt(":tada:"), "start of line is a valid boundary");
});

test("replaces known shortcodes in text and leaves unknown ones alone", () => {
  assert.equal(replaceShortcodes("ship it :rocket: :nope:"), "ship it 🚀 :nope:");
  assert.equal(replaceShortcodes("no codes here"), "no codes here");
});

test("recents move to front, dedupe, and stay bounded", () => {
  assert.deepEqual(mergeRecentEmoji(["a", "b"], "c"), ["c", "a", "b"]);
  assert.deepEqual(mergeRecentEmoji(["a", "b", "c"], "b"), ["b", "a", "c"]);
  const many = Array.from({ length: 40 }, (_, index) => `e${index}`);
  assert.equal(mergeRecentEmoji(many, "new").length, 24);
});

test("group membership covers every catalog entry", () => {
  for (const entry of EMOJI_CATALOG) {
    assert.ok(emojiForShortcode(entry.name)?.group === entry.group);
  }
});

test("paste expansion skips fenced and inline code", () => {
  assert.equal(
    replaceShortcodesOutsideCode("ship :rocket: `a:rocket:b` done"),
    "ship \u{1F680} `a:rocket:b` done",
  );
  assert.equal(
    replaceShortcodesOutsideCode("```\nkey: :rocket:\n```\nafter :tada:"),
    "```\nkey: :rocket:\n```\nafter \u{1F389}",
  );
  assert.equal(replaceShortcodesOutsideCode("~~~\n:fire:\n~~~"), "~~~\n:fire:\n~~~");
  // A fence wins over the backticks nested inside it.
  assert.equal(replaceShortcodesOutsideCode("```\n`:fire:`\n```"), "```\n`:fire:`\n```");
  assert.equal(replaceShortcodesOutsideCode("plain :sob:"), "plain \u{1F62D}");
});

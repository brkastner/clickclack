import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const messageGroup = readFileSync(
  new URL("../components/messages/MessageGroup.svelte", import.meta.url),
  "utf8",
);
const messageStyles = readFileSync(new URL("../styles/messages.css", import.meta.url), "utf8");

test("keeps the avatar sticky within its message group", () => {
  assert.match(
    messageGroup,
    /<article class="message-group"[\s\S]*?<Avatar[\s\S]*?class=\{[^}]*"avatar"/u,
  );

  const avatarRules = [...messageStyles.matchAll(/\.message-group > \.avatar\s*\{([\s\S]*?)\}/gu)];
  const stickyRule =
    avatarRules.find((rule) => /position:\s*sticky/u.test(rule[1] ?? ""))?.[1] ?? "";
  assert.match(stickyRule, /top:\s*14px/u);
  assert.match(stickyRule, /align-self:\s*start/u);
});

test("right-aligns text inside the current user's message bubble", () => {
  const acceptedPass =
    messageStyles.match(
      /\/\* ---------- ACCEPTED ASSISTANT THREAD PASS ---------- \*\/([\s\S]*?)@media \(max-width: 760px\)/u,
    )?.[1] ?? "";
  const contentRule =
    acceptedPass.match(/\.message-group\.is-self \.message-content\s*\{([\s\S]*?)\}/u)?.[1] ?? "";
  const markdownRule =
    acceptedPass.match(
      /\.message-group\.is-self \.message-content \.markdown\s*\{([\s\S]*?)\}/u,
    )?.[1] ?? "";

  assert.match(contentRule, /margin-left:\s*auto/u);
  assert.match(contentRule, /text-align:\s*right/u);
  assert.match(markdownRule, /text-align:\s*right/u);
});

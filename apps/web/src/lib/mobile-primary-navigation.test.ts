import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationPath,
  mobileChatRouteStorageKey,
  mobileKeyboardOpen,
  mobilePrimaryDestination,
  storedConversationPath,
} from "./mobile-primary-navigation.ts";

const workspaceID = "workspace one";
const workspacePath = "/app/workspace%20one";

test("recognizes only the three primary mobile destinations", () => {
  assert.equal(mobilePrimaryDestination(workspacePath, workspaceID), "chat");
  assert.equal(mobilePrimaryDestination(`${workspacePath}/general`, workspaceID), "chat");
  assert.equal(mobilePrimaryDestination(`${workspacePath}/views/home`, workspaceID), "home");
  assert.equal(
    mobilePrimaryDestination(`${workspacePath}/views/vai-gallery`, workspaceID),
    "gallery",
  );
  assert.equal(mobilePrimaryDestination(`${workspacePath}/settings`, workspaceID), null);
  assert.equal(mobilePrimaryDestination(`${workspacePath}/views/unknown`, workspaceID), null);
  assert.equal(mobilePrimaryDestination("/app/another/general", workspaceID), null);
});

test("remembers only explicit conversation routes", () => {
  const chatPath = `${workspacePath}/most-recent-chat`;
  assert.equal(conversationPath(chatPath, workspaceID), chatPath);
  assert.equal(conversationPath(workspacePath, workspaceID), null);
  assert.equal(conversationPath(`${workspacePath}/views/home`, workspaceID), null);
  assert.equal(storedConversationPath(chatPath, workspaceID), chatPath);
  assert.equal(storedConversationPath("/app/another/general", workspaceID), null);
});

test("scopes remembered chat routes to a workspace", () => {
  assert.equal(
    mobileChatRouteStorageKey(workspaceID),
    "clickclack:mobile-chat-route:v1:workspace one",
  );
});

test("recognizes a keyboard-sized visual viewport reduction", () => {
  assert.equal(mobileKeyboardOpen(844, 544, true), true);
  assert.equal(mobileKeyboardOpen(844, 760, true), false);
  assert.equal(mobileKeyboardOpen(844, 544, false), false);
});

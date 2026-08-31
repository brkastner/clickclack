import assert from "node:assert/strict";
import test from "node:test";
import { profileEditScope } from "./profile-editing.ts";
import type { User } from "./types.ts";

const human: User = {
  id: "usr_kas",
  kind: "human",
  display_name: "kas",
  handle: "kas",
  avatar_url: "",
  created_at: "2026-01-01T00:00:00Z",
};

const other: User = { ...human, id: "usr_other", display_name: "other", handle: "other" };

const serviceBot: User = {
  id: "usr_kai",
  kind: "bot",
  display_name: "кай",
  handle: "kai",
  avatar_url: "",
  created_at: "2026-01-01T00:00:00Z",
};

const userBot: User = { ...serviceBot, id: "usr_agent", handle: "agent", owner_user_id: human.id };

test("your own profile edits identity but not personas", () => {
  const scope = profileEditScope(human, human, "member");
  assert.equal(scope.isSelf, true);
  assert.equal(scope.canEditIdentity, true);
  assert.equal(scope.canEditPersonas, false);
});

test("another human's profile is never editable, even by an owner", () => {
  const scope = profileEditScope(other, human, "owner");
  assert.equal(scope.canEdit, false);
  assert.equal(scope.canEditIdentity, false);
});

test("managers edit service bot identity and personas", () => {
  for (const role of ["owner", "moderator"] as const) {
    const scope = profileEditScope(serviceBot, human, role);
    assert.equal(scope.canEditIdentity, true, role);
    assert.equal(scope.canEditPersonas, true, role);
  }
});

test("ordinary members cannot edit a service bot", () => {
  const scope = profileEditScope(serviceBot, human, "member");
  assert.equal(scope.canEdit, false);
});

test("a user-owned bot follows its owner, not workspace rank", () => {
  const owner = profileEditScope(userBot, human, "member");
  assert.equal(owner.canEditIdentity, true);

  // A workspace owner who is not the bot's owner cannot touch its identity,
  // but still manages channel personas.
  const manager = profileEditScope(userBot, other, "owner");
  assert.equal(manager.canEditIdentity, false);
  assert.equal(manager.canEditPersonas, true);
  assert.equal(manager.canEdit, true);
});

test("deleted bots and signed-out viewers are read-only", () => {
  assert.equal(
    profileEditScope({ ...serviceBot, deleted_at: "2026-01-02T00:00:00Z" }, human, "owner").canEdit,
    false,
  );
  assert.equal(profileEditScope(serviceBot, null, "").canEdit, false);
  assert.equal(profileEditScope(human, null, "").isSelf, false);
});

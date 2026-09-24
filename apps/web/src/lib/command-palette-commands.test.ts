import assert from "node:assert/strict";
import test from "node:test";

import {
  accountSettingsCommands,
  channelCommands,
  directCommands,
  renameChannelCommands,
  themeCommand,
  viewCommands,
  workspaceSettingsCommands,
} from "./command-palette-commands.ts";
import type { Channel, DirectConversation, User } from "./types.ts";

function channel(id: string, name: string, extra: Partial<Channel> = {}): Channel {
  return {
    id,
    route_id: id,
    workspace_id: "w1",
    name,
    kind: "public",
    created_at: "",
    external_managed: false,
    ...extra,
  };
}

function user(id: string, name: string): User {
  return { id, display_name: name, handle: name.toLowerCase() } as User;
}

test("channel commands skip archived channels and route through the caller", () => {
  const visited: string[] = [];
  const commands = channelCommands(
    [
      channel("c1", "general"),
      channel("c2", "old", { archived_at: "2026-01-01" }),
      channel("c3", "ops", { display_title: "Operations" }),
    ],
    (item) => `/app/w/${item.route_id}`,
    "c1",
    (href) => {
      visited.push(href);
    },
  );
  assert.deepEqual(
    commands.map((command) => command.label),
    ["general", "Operations"],
  );
  assert.equal(commands[0]?.current, true);
  // A renamed channel still matches its original slug.
  assert.deepEqual(commands[1]?.keywords, ["ops"]);
  void commands[1]?.run();
  assert.deepEqual(visited, ["/app/w/c3"]);
});

test("rename channel opens the current channel's existing rename flow", () => {
  const renamed: string[] = [];
  const [command] = renameChannelCommands(
    channel("c3", "ops", { display_title: "operations" }),
    true,
    (id) => {
      renamed.push(id);
    },
  );
  assert.equal(command?.id, "action:rename-channel");
  assert.equal(command?.label, "rename channel");
  assert.equal(command?.hint, "#operations");
  assert.ok(command?.keywords?.includes("ops"));
  assert.ok(command?.keywords?.includes("operations"));
  void command?.run();
  assert.deepEqual(renamed, ["c3"]);
});

test("rename channel is absent without an active channel or manage permission", () => {
  const open = () => assert.fail("must not open rename");
  assert.deepEqual(renameChannelCommands(undefined, true, open), []);
  assert.deepEqual(renameChannelCommands(channel("c1", "general"), false, open), []);
});

test("direct message commands are labelled by the other members", () => {
  const me = user("u1", "Kas");
  const kai = user("u2", "Kai");
  const conversation: DirectConversation = {
    id: "d1",
    route_id: "d1",
    workspace_id: "w1",
    created_at: "",
    members: [me, kai],
    can_send: true,
    unread_count: 2,
  };
  const [command] = directCommands(
    [conversation],
    "u1",
    (item) => item.id,
    "",
    () => {},
  );
  assert.equal(command?.label, "Kai");
  assert.equal(command?.hint, "2 unread");
  assert.ok(command?.keywords?.includes("dm"));
  assert.ok(command?.keywords?.includes("kai"));
});

test("workspace settings commands hide manager-only sections from members", () => {
  const member = workspaceSettingsCommands("w1", "member", "", () => {}).map(
    (command) => command.id,
  );
  const owner = workspaceSettingsCommands("w1", "owner", "", () => {}).map((command) => command.id);
  assert.ok(owner.length >= member.length);
  assert.ok(owner.includes("workspace-settings:overview"));
});

test("account settings open the requested section", () => {
  const opened: string[] = [];
  const commands = accountSettingsCommands((section) => opened.push(section));
  const appearance = commands.find((command) => command.id === "account-settings:appearance");
  void appearance?.run();
  assert.deepEqual(opened, ["appearance"]);
});

test("view commands cover home and gallery and mark the current view", () => {
  const commands = viewCommands("w1", "/app/w1/views/home", () => {});
  assert.deepEqual(
    commands.map((command) => command.id),
    ["view:home", "view:vai-gallery"],
  );
  assert.deepEqual(
    commands.map((command) => command.label),
    ["Home", "Gallery"],
  );
  assert.equal(commands[0]?.current, true);
  assert.equal(commands[1]?.current, false);
});

test("the theme command switches to the other mode", () => {
  let set = "";
  const command = themeCommand("dark", (mode) => {
    set = mode;
  });
  assert.equal(command.label, "Switch to light mode");
  void command.run();
  assert.equal(set, "light");
});

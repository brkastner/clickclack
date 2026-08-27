import assert from "node:assert/strict";
import test from "node:test";
import { findUniqueBotCommand } from "./bot-command-routing.ts";
import type { WorkspaceBotCommand } from "./types.ts";

function command(id: string, token: string, botID: string): WorkspaceBotCommand {
  return {
    id,
    command: token,
    description: "",
    args_hint: "",
    bot: { id: botID, handle: botID, display_name: botID, avatar_url: "" },
    created_at: "",
    updated_at: "",
  };
}

test("findUniqueBotCommand preserves a sole owner", () => {
  const owned = command("cmd-pin", "/pin", "bot-kai");
  assert.equal(findUniqueBotCommand([owned], "/pin"), owned);
});

test("findUniqueBotCommand does not choose among duplicate declarations", () => {
  const commands = [
    command("cmd-pin-kai", "/pin", "bot-kai"),
    command("cmd-pin-claw", "/pin", "bot-claw"),
  ];
  assert.equal(findUniqueBotCommand(commands, "/pin"), undefined);
});

test("findUniqueBotCommand normalizes declared command tokens", () => {
  const owned = command("cmd-status", "STATUS", "bot-kai");
  assert.equal(findUniqueBotCommand([owned], "/status"), owned);
});

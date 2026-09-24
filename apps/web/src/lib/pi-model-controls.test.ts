import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PI_MODELS,
  isCurrentPiModel,
  piCommandPayload,
  piControlCommand,
  supportsPiFast,
  validatePiModels,
} from "./pi-model-controls.ts";
import type { BotRuntimeStatus, WorkspaceBotCommand } from "./types.ts";

const status: BotRuntimeStatus = {
  workspace_id: "w",
  bot_user_id: "pi",
  runtime: "pi",
  model_provider: "openai-codex",
  model_id: "gpt-6-sol",
  reasoning: "high",
  fast_mode: false,
  updated_at: "",
  expires_at: "",
};

test("model defaults preserve the requested ids and aliases", () => {
  assert.deepEqual(
    DEFAULT_PI_MODELS.map((model) => model.id),
    [
      "claude-opus-5-5",
      "openai-codex/gpt-6-astra",
      "openai-codex/gpt-6-sol",
      "openai-codex/gpt-6-luna",
    ],
  );
  assert.equal(piControlCommand(status, "model", "openai-codex/gpt-6-sol"), null);
  assert.equal(
    piControlCommand(status, "model", "openai-codex/gpt-6-luna"),
    "/model openai-codex/gpt-6-luna",
  );
  assert.equal(piControlCommand(status, "model", "claude-opus-5-5"), "/model claude-opus-5-5");
  assert.equal(
    isCurrentPiModel(
      { ...status, model_id: "claude-opus-5-5", model_provider: "anthropic" },
      "claude-opus-5-5",
    ),
    true,
  );
  assert.equal(
    isCurrentPiModel({ ...status, model_provider: "other" }, "openai-codex/gpt-6-sol"),
    false,
  );
});

test("effort only sends a changed allowed value and fast toggles directly", () => {
  assert.equal(piControlCommand(status, "thinking", "high"), null);
  for (const effort of ["low", "medium", "xhigh"])
    assert.equal(piControlCommand(status, "thinking", effort), `/thinking ${effort}`);
  assert.throws(() => piControlCommand(status, "thinking", "off"));
  assert.equal(piControlCommand(status, "fast"), "/fast");
  assert.equal(piControlCommand({ ...status, fast_mode: true }, "fast"), "/fast");
  assert.equal(supportsPiFast({ ...status, model_id: "claude-opus-5-5" }), false);
  assert.equal(piControlCommand({ ...status, model_provider: "anthropic" }, "fast"), null);
  assert.equal(piControlCommand({ ...status, runtime: "openclaw" }, "model", "anything"), null);
});

test("settings reject empty lists, duplicate ids and command injection", () => {
  assert.deepEqual(validatePiModels(DEFAULT_PI_MODELS), DEFAULT_PI_MODELS);
  for (const value of [
    [],
    null,
    [{ label: "x", id: "a\n/fast" }],
    [{ label: "", id: "a" }],
    [...DEFAULT_PI_MODELS, DEFAULT_PI_MODELS[0]],
  ])
    assert.throws(() => validatePiModels(value));
});

test("channel commands target the displayed bot, never another command owner", () => {
  const commands = [
    { id: "wrong", command: "model", bot: { id: "other" } },
    { id: "right", command: "model", bot: { id: "pi" } },
  ] as WorkspaceBotCommand[];
  const target = { kind: "channels", id: "c", botUserID: "pi" } as const;
  assert.deepEqual(piCommandPayload(target, commands, "/model claude-opus-5-5", "n"), {
    body: "/model claude-opus-5-5",
    nonce: "n",
    bot_command_id: "right",
  });
  assert.throws(() => piCommandPayload(target, commands, "/thinking low", "n"));
  assert.deepEqual(piCommandPayload({ ...target, kind: "dms" }, [], "/fast", "n"), {
    body: "/fast",
    nonce: "n",
  });
});

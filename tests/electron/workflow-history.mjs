// Real Electron shell + disposable API/SQLite; never uses installed app settings
// or a live server. Run after build:web and build:desktop, with an existing
// Electron executable supplied via CLICKCLACK_ELECTRON_EXECUTABLE.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { _electron as electron, expect } from "@playwright/test";

const executablePath = process.env.CLICKCLACK_ELECTRON_EXECUTABLE;
if (!executablePath)
  throw new Error("Set CLICKCLACK_ELECTRON_EXECUTABLE to an existing Electron executable");
const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "clickclack-workflow-electron-"));
let server;
let app;
let debugPage;
let serverLog = "";

try {
  // Stage current production web assets exactly as the Go test harness does,
  // without changing the tracked deployment bundle in this worktree.
  const staged = join(temp, "repo");
  mkdirSync(staged);
  for (const file of ["go.mod", "go.sum"]) cpSync(resolve(file), join(staged, file));
  cpSync(resolve("apps/api"), join(staged, "apps/api"), { recursive: true });
  rmSync(join(staged, "apps/api/internal/webassets/dist"), { recursive: true });
  cpSync(resolve("apps/web/dist"), join(staged, "apps/api/internal/webassets/dist"), {
    recursive: true,
  });
  const binary = join(temp, "api");
  const build = spawnSync("go", ["build", "-o", binary, "./apps/api/cmd/clickclack"], {
    cwd: staged,
    stdio: "inherit",
  });
  assert.equal(build.status, 0, "fixture API build");
  const reservation = createServer();
  await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  const origin = `http://127.0.0.1:${port}`;
  server = spawn(
    binary,
    ["serve", "--addr", `127.0.0.1:${port}`, "--data", join(temp, "data"), "--dev-bootstrap=true"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (data) => {
    serverLog += data;
  });
  server.stderr.on("data", (data) => {
    serverLog += data;
  });
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${origin}/healthz`)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 20000 },
    )
    .toBe(true);
  const api = async (path, body, token) => {
    const response = await fetch(`${origin}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(
      response.ok,
      true,
      `${path}: ${response.status} ${response.ok ? "" : await response.text()}`,
    );
    return response.json();
  };
  const { workspace } = await api("/api/workspaces", { name: "Workflow Electron fixture" });
  const { channel } = await api(`/api/workspaces/${workspace.id}/channels`, {
    name: "workflow-fixture",
    kind: "public",
  });
  const { bot_token: token } = await api(`/api/workspaces/${workspace.id}/bots`, {
    display_name: "Workflow Fixture Bot",
    scopes: ["bot:write", "agent_activity:write"],
  });
  const snapshot = {
    schema: "clickclack.workflow-snapshot.v1",
    source: {
      provider: "pi-workflows",
      sessionId: "fixture-session",
      runId: "completed-run",
      revision: 1,
    },
    run: {
      workflowName: "Completed fixture",
      status: "completed",
      reason: null,
      possiblyInterrupted: false,
      startedAt: "2026-09-01T00:00:00Z",
      finishedAt: "2026-09-01T00:03:00Z",
      stepTotal: 2,
      stepsComplete: true,
    },
    steps: [1, 2].map((n) => ({
      attemptId: `attempt-${n}`,
      nodeId: "build",
      nodeType: "task",
      outcome: n === 1 ? "failed" : "ok",
      startedAt: `2026-09-01T00:0${n}:00Z`,
      finishedAt: `2026-09-01T00:0${n}:30Z`,
    })),
    files: {
      source: "host-git",
      basis: "cumulative-since-base",
      baseRevision: "base123",
      attribution: "includes-preexisting-changes",
      complete: false,
      truncated: true,
      entries: [
        { path: "src/main.ts", change: "modified" },
        { path: "docs/new.md", oldPath: "docs/old.md", change: "renamed" },
      ],
    },
  };
  const publish = (value) =>
    api(
      "/api/workflow-runs",
      { workspace_id: workspace.id, channel_id: channel.id, snapshot: value },
      token.token,
    );
  await publish(snapshot);
  const userData = join(temp, "electron-user-data");
  mkdirSync(userData);
  writeFileSync(
    join(userData, "desktop.json"),
    JSON.stringify({
      serverUrl: origin,
      closeToTray: false,
      startAtLogin: false,
      window: { width: 1280, height: 900 },
    }),
  );
  const bootstrap = join(temp, "electron.cjs");
  writeFileSync(
    bootstrap,
    `const {app}=require('electron'); app.setPath('userData',${JSON.stringify(userData)}); app.setName('ClickClack Workflow Fixture'); require(${JSON.stringify(join(root, "apps/desktop/dist/main.cjs"))});`,
  );
  app = await electron.launch({
    executablePath,
    args: ["--ozone-platform=x11", bootstrap],
    env: { ...process.env, ELECTRON_FORCE_IS_PACKAGED: "false" },
    timeout: 30000,
  });
  await expect
    .poll(() => app.windows().find((page) => page.url().startsWith(origin)) !== undefined, {
      timeout: 30000,
    })
    .toBe(true);
  await app.evaluate(({ BaseWindow }) => {
    for (const window of BaseWindow.getAllWindows())
      window.setBounds({ x: 0, y: 0, width: 1280, height: 900 });
  });
  const page = app.windows().find((page) => page.url().startsWith(origin));
  debugPage = page;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/app/${workspace.route_id}/${channel.route_id}`);
  await expect(page.locator('.shell[data-app-ready="true"]')).toBeVisible();
  const openHistory = async () => {
    await page.getByRole("button", { name: "Workflow run", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Recorded runs" })).toBeVisible();
  };
  let historyRequests = 0;
  await page.route(`**/api/channels/${channel.id}/workflow-runs?*`, async (route) => {
    historyRequests += 1;
    await route.continue();
  });
  await openHistory();
  await expect(page.getByRole("heading", { name: "Completed fixture", exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  assert.equal(historyRequests, 1, "one initial scope load");
  await expect(page.locator(".run-step")).toHaveCount(2);
  await expect(
    page.getByText("Includes pre-existing changes; not all changes belong to this run."),
  ).toBeVisible();
  await expect(page.getByText("File list truncated.")).toBeVisible();
  await page.locator("summary").filter({ hasText: "src/" }).click();
  await expect(page.getByText("main.ts", { exact: true })).toBeVisible();
  await page.locator("summary").filter({ hasText: "docs/" }).click();
  await expect(page.getByText("from docs/old.md", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.shell[data-app-ready="true"]')).toBeVisible();
  await openHistory();
  await expect(page.getByRole("heading", { name: "Completed fixture", exact: true })).toBeVisible();
  console.log("PASS Electron completed history + attempts + host file tree survive reload");

  const next = structuredClone(snapshot);
  next.source.runId = "waiting-run";
  next.run.workflowName = "Waiting fixture";
  next.run.status = "waiting";
  next.run.finishedAt = null;
  next.run.stepsComplete = false;
  next.run.stepTotal = 3;
  next.files = null;
  const live = { ...next.run, runId: next.source.runId, live: true, steps: next.steps };
  const publishLive = () => api("/api/realtime/ephemeral", {
    workspace_id: workspace.id, channel_id: channel.id, type: "workflow.run",
    payload: { run: live },
  }, token.token);
  await publishLive();
  await expect(page.getByRole("heading", { name: "Waiting fixture", exact: true })).toBeVisible();
  await expect(page.getByText("Live-only report. Durable history has not been supplied.")).toBeVisible();
  await expect(page.getByText("File list truncated.")).toHaveCount(0);
  await page.getByRole("button", { name: /Completed fixture · completed/ }).click();
  await publishLive();
  await expect(page.getByRole("heading", { name: "Completed fixture", exact: true })).toBeVisible();
  console.log("PASS new live pointer ahead of durable publication; explicit historical selection retained");
  await publish(next);
  await expect(page.getByRole("button", { name: /Waiting fixture · waiting/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Completed fixture", exact: true })).toBeVisible();

  // Hold a real response while many real notifications arrive: one in-flight
  // refresh and at most one coalesced follow-up, never one fetch per frame.
  await page.unroute(`**/api/channels/${channel.id}/workflow-runs?*`);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let refreshRequests = 0;
  await page.route(`**/api/channels/${channel.id}/workflow-runs?*`, async (route) => {
    refreshRequests += 1;
    const response = await route.fetch();
    if (refreshRequests === 1) await held;
    await route.fulfill({ response });
  });
  next.source.revision += 1;
  await publish(next);
  await expect.poll(() => refreshRequests).toBe(1);
  for (let i = 0; i < 15; i++) {
    next.source.revision += 1;
    await publish(next);
  }
  await page.waitForTimeout(250);
  assert.equal(refreshRequests, 1, "burst cannot start concurrent refreshes");
  release();
  await expect.poll(() => refreshRequests).toBe(2);
  await page.waitForTimeout(250);
  assert.equal(refreshRequests, 2, "burst queues only one follow-up");
  await expect(page.getByRole("heading", { name: "Completed fixture", exact: true })).toBeVisible();
  await page.unroute(`**/api/channels/${channel.id}/workflow-runs?*`);
  console.log("PASS rapid snapshot notifications bounded to one in-flight and one follow-up");
  await page.getByRole("button", { name: /Waiting fixture · waiting/ }).click();
  await expect(
    page.getByText("File evidence unavailable. No clean workspace is implied."),
  ).toBeVisible();
  await expect(page.getByText("Step history incomplete: 2 of 3 attempts supplied.")).toBeVisible();
  await api(
    "/api/realtime/ephemeral",
    {
      workspace_id: workspace.id,
      channel_id: channel.id,
      type: "workflow.run",
      payload: { run: null },
    },
    token.token,
  );
  await expect(page.getByRole("button", { name: /Completed fixture · completed/ })).toBeVisible();
  const { channel: otherChannel } = await api(`/api/workspaces/${workspace.id}/channels`, {
    name: "workflow-other", kind: "public",
  });
  let releaseStale;
  const staleHeld = new Promise((resolve) => { releaseStale = resolve; });
  let staleStarted = false;
  await page.route(`**/api/channels/${channel.id}/workflow-runs?*`, async (route) => {
    const response = await route.fetch();
    staleStarted = true;
    await staleHeld;
    await route.fulfill({ response });
  });
  next.source.revision += 1;
  await publish(next);
  await expect.poll(() => staleStarted).toBe(true);
  let otherRequests = 0;
  await page.route(`**/api/channels/${otherChannel.id}/workflow-runs?*`, async (route) => {
    otherRequests += 1;
    await route.continue();
  });
  await page.locator(`a[href$="/${otherChannel.route_id}"]`).first().click();
  await expect(page.getByText("No durable runs reported for this conversation.")).toBeVisible();
  releaseStale();
  await page.waitForTimeout(300);
  assert.equal(otherRequests, 1, "scope switch does not duplicate initial load");
  await expect(page.getByRole("button", { name: /Waiting fixture · waiting/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Completed fixture · completed/ })).toHaveCount(0);
  await page.unroute(`**/api/channels/${channel.id}/workflow-runs?*`);
  await page.locator(`a[href$="/${channel.route_id}"]`).first().click();
  await expect(page.getByRole("button", { name: /Waiting fixture · waiting/ })).toBeVisible();
  console.log("PASS scope switch single load and late previous-target response isolation");
  await page.getByRole("button", { name: "Close workflow run", exact: true }).last().click();
  const decision =
    "Approve fixture?\n\n```clickclack-decision\n" +
    JSON.stringify({
      v: 1,
      choices: [
        { n: 1, key: "continue", label: "Continue fixture", input: false },
        { n: 2, key: "stop", label: "Stop fixture", input: false },
      ],
      dismiss: "cancel",
    }) +
    "\n```";
  await api(
    `/api/channels/${channel.id}/messages`,
    { body: decision, kind: "agent_commentary", turn_id: "decision:fixture-request:1" },
    token.token,
  );
  await expect(page.getByRole("button", { name: "Continue fixture", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.locator('.shell[data-app-ready="true"]')).toBeVisible();
  await page.getByRole("button", { name: "Continue fixture", exact: true }).click();
  await expect
    .poll(async () => {
      const { messages } = await api(`/api/channels/${channel.id}/messages`);
      return messages.some((message) => message.body === "1" && message.kind === "message");
    })
    .toBe(true);
  await expect(page.getByRole("button", { name: "Continue fixture", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.locator('.shell[data-app-ready="true"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue fixture", exact: true })).toBeDisabled();
  assert.deepEqual(errors, [], "Electron renderer errors");
  console.log(
    "PASS Electron realtime durable history / null live pointer / incomplete-unavailable states / chat decision reply and stale suppression",
  );
  console.log(
    `Electron ${await app.evaluate(() => process.versions.electron)}; fixture only, not live workflow proof`,
  );
} catch (error) {
  if (debugPage) {
    console.error(
      await app.evaluate(({ BaseWindow, screen }) => ({
        windows: BaseWindow.getAllWindows().map((w) => w.getBounds()),
        display: screen.getPrimaryDisplay().workArea,
      })),
    );
    console.error(
      await debugPage.evaluate(() =>
        [...document.querySelectorAll(".thread, .history, summary")].map((el) => ({
          tag: el.tagName,
          cls: el.className,
          rect: el.getBoundingClientRect().toJSON(),
          height: el.scrollHeight,
          overflow: getComputedStyle(el).overflow,
          clientHeight: el.clientHeight,
        })),
      ),
    );
    await debugPage.screenshot({ path: "/tmp/clickclack-workflow-electron-failure.png" });
  }
  console.error(serverLog.slice(-12000));
  throw error;
} finally {
  if (app) await app.close();
  if (server) {
    server.kill("SIGTERM");
    await new Promise((done) => server.once("exit", done));
  }
  rmSync(temp, { recursive: true, force: true });
}

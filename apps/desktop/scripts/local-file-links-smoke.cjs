const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { app, BaseWindow, dialog, shell, webContents } = require("electron");

// Real Electron, main bundle, preload, filesystem, and trusted input. Only the
// native confirmation and OS reveal are recorded test boundaries. Never use a
// live profile, server, message, or the user's source file in this fixture.
const root = path.resolve(__dirname, "..");
let directory;
let server;
let origin;
let target;
let answer = 0;
const confirmations = [];
const reveals = [];
const requests = [];

async function waitFor(check) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Local-file smoke observation timed out");
}

(async () => {
  await fs.mkdir(path.join(root, ".test"), { recursive: true });
  directory = await fs.mkdtemp(path.join(root, ".test", "local-file-smoke-"));
  target = path.join(directory, "example.txt");
  await fs.writeFile(target, "Local file reveal fixture\n");
  server = http.createServer((req, res) => {
    requests.push(req.url);
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<html><body><div class="markdown"><a id="local" href="${encodeURI(target)}">Local file</a><br><a id="normal" href="/app/other">Normal route</a></div></body></html>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  app.setPath("userData", directory);
  // Loading the real entry point must not change the user's protocol handlers.
  app.setAsDefaultProtocolClient = () => true;
  await fs.writeFile(
    path.join(directory, "desktop.json"),
    JSON.stringify({ serverUrl: origin, closeToTray: false }),
  );
  dialog.showMessageBox = async (_owner, options) => {
    confirmations.push(options);
    return { response: options.type === "question" ? answer : 0 };
  };
  shell.showItemInFolder = (file) => reveals.push(file);
  require(path.join(root, "dist", "main.cjs"));
  await app.whenReady();
  let contents;
  await waitFor(() => {
    contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL() === origin + "/app" && !item.isLoading());
    return Boolean(contents);
  });
  assert.equal(await contents.executeJavaScript("typeof window.clickclackDesktop"), "object");
  const owner = BaseWindow.getAllWindows().find((window) =>
    window.contentView.children.some((view) => view.webContents === contents),
  );
  assert(owner, "Application view must have a native owner");
  const prepareInput = async () => {
    owner.focus();
    contents.focus();
    await waitFor(() => owner.isFocused() && contents.isFocused());
    // A loaded DOM is not proof that native hit-test data has been presented.
    await contents.executeJavaScript(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
    );
    const frame = await contents.capturePage();
    assert(!frame.isEmpty(), "Application view must have a rendered frame");
  };
  const click = async (button = "left") => {
    await prepareInput();
    const point = await contents.executeJavaScript(
      "(() => {const r=document.querySelector('#local').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()",
    );
    contents.sendInputEvent({ type: "mouseDown", button, clickCount: 1, ...point });
    contents.sendInputEvent({ type: "mouseUp", button, clickCount: 1, ...point });
  };
  // Synthetic DOM clicks must not request a privileged action.
  await contents.executeJavaScript(
    "(() => { const link=document.querySelector('#local'); link.addEventListener('click', event => event.preventDefault(), {once:true}); link.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); })()",
  );
  assert.equal(confirmations.length, 0);
  await click();
  await waitFor(() => confirmations.length === 1);
  assert.equal(reveals.length, 0);
  assert.equal(confirmations[0].defaultId, 0);
  answer = 1;
  await click("middle");
  await waitFor(() => reveals.length === 1);
  assert.equal(reveals[0], await fs.realpath(target));
  await prepareInput();
  await contents.executeJavaScript("document.querySelector('#local').focus()");
  contents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
  contents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
  await waitFor(() => reveals.length === 2);
  assert.equal(reveals[1], await fs.realpath(target));
  assert.equal(contents.getURL(), origin + "/app");
  assert(
    !requests.some((url) => url.startsWith("/home/") || url.startsWith("/Users/")),
    "Local link reached HTTP",
  );
  await contents.executeJavaScript("document.querySelector('#normal').click()");
  await waitFor(() => contents.getURL() === origin + "/app/other");
  console.log(
    "PASS: real Electron preload handles trusted local clicks, cancellation and confirmation; synthetic clicks grant nothing; normal routes remain navigable. Native dialogs and OS reveal were recorded, not executed.",
  );
})()
  .then(async () => {
    server?.close();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    server?.close();
    app.exit(1);
  });

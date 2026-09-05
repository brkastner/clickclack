import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Editor } from "@tiptap/core";
import ts from "typescript";

const source = readFileSync(
  new URL("../components/composer/ChatComposer.svelte", import.meta.url),
  "utf8",
);
const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
const ast = ts.createSourceFile("ChatComposer.ts", script, ts.ScriptTarget.Latest, true);
let updateSource = "";
let onUpdateSource = "";
function visit(node: ts.Node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(ast) === "update") {
    updateSource = node.getText(ast);
  }
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "onUpdate") {
    onUpdateSource = node.initializer.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(updateSource);
assert.ok(onUpdateSource);
const js = ts.transpileModule(
  `const onUpdate = ${onUpdateSource}; const action = { ${updateSource} }; return action.update;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
// Exercise the actual action and onUpdate callback with installed Tiptap's
// setEditable implementation. Only the DOM-dependent editor surface is stubbed.
const createUpdate = new Function(
  "mountedEditor",
  "value",
  "onValue",
  "replaceCompletedShortcode",
  "refreshActiveToken",
  "refreshFormatState",
  "previousPlaceholder",
  "connectUpdate",
  js.replace("return action.update;", "connectUpdate(onUpdate); return action.update;"),
);

function setup(editable: boolean) {
  let markdown = "reply A";
  let destinationDraft = "draft B";
  const published: string[] = [];
  let onUpdate = (_event: { editor: unknown }) => {};
  const editor = {
    isEditable: editable,
    state: { tr: {} },
    setOptions(options: { editable: boolean }) {
      this.isEditable = options.editable;
    },
    setEditable: Editor.prototype.setEditable,
    emit(event: string, payload: { editor: unknown }) {
      assert.equal(event, "update");
      onUpdate(payload);
    },
    getMarkdown: () => markdown,
    commands: {
      setContent(content: string, options: { emitUpdate: boolean }) {
        markdown = content;
        if (options.emitUpdate) onUpdate({ editor });
      },
    },
  };
  const update = createUpdate(
    editor,
    destinationDraft,
    (text: string) => {
      published.push(text);
      destinationDraft = text;
    },
    () => false,
    () => {},
    () => {},
    "Reply",
    (callback: typeof onUpdate) => {
      onUpdate = callback;
    },
  );
  return { editor, update, published, draft: () => destinationDraft };
}

test("Tiptap setEditable emits the old draft by default", () => {
  const state = setup(false);
  state.editor.setEditable.call(state.editor as unknown as Editor, true);
  assert.deepEqual(state.published, ["reply A"]);
  assert.equal(state.draft(), "reply A");
});

for (const disabled of [false, true]) {
  test(`ChatComposer restores the destination draft without publishing stale text when disabled=${disabled}`, () => {
    const state = setup(disabled);
    state.update({ disabled, value: "draft B", placeholder: "Reply" });
    assert.equal(state.editor.isEditable, !disabled);
    assert.equal(state.editor.getMarkdown(), "draft B");
    assert.equal(state.draft(), "draft B");
    assert.deepEqual(state.published, []);
  });
}

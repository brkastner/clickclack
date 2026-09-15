import assert from "node:assert/strict";
import test from "node:test";
import { dismissLayerCount, dismissTopLayer, registerDismissLayer } from "./dismissal.ts";

test("with nothing open the gesture is not swallowed", () => {
  assert.equal(dismissTopLayer(), false);
  assert.equal(dismissLayerCount(), 0);
});

test("the most recently opened layer closes first", () => {
  const closed: string[] = [];
  const releaseOuter = registerDismissLayer(() => {
    closed.push("outer");
    return true;
  });
  const releaseInner = registerDismissLayer(() => {
    closed.push("inner");
    return true;
  });
  assert.equal(dismissTopLayer(), true);
  assert.deepEqual(closed, ["inner"]);
  releaseInner();
  assert.equal(dismissTopLayer(), true);
  assert.deepEqual(closed, ["inner", "outer"]);
  releaseOuter();
  assert.equal(dismissLayerCount(), 0);
});

test("a layer with nothing to close is passed over, not swallowed", () => {
  const release = [registerDismissLayer(() => true), registerDismissLayer(() => false)];
  assert.equal(dismissTopLayer(), true);
  for (const stop of release) stop();
  assert.equal(dismissLayerCount(), 0);
});

test("every layer declining leaves the gesture to the platform", () => {
  const release = registerDismissLayer(() => false);
  assert.equal(dismissTopLayer(), false);
  release();
});

test("releasing twice is safe and removes only its own layer", () => {
  const release = registerDismissLayer(() => true);
  const other = registerDismissLayer(() => true);
  release();
  release();
  assert.equal(dismissLayerCount(), 1);
  other();
  assert.equal(dismissLayerCount(), 0);
});

test("the same function registered twice releases one layer at a time", () => {
  const dismiss = () => true;
  const first = registerDismissLayer(dismiss);
  const second = registerDismissLayer(dismiss);
  assert.equal(dismissLayerCount(), 2);
  second();
  assert.equal(dismissLayerCount(), 1);
  first();
  assert.equal(dismissLayerCount(), 0);
});

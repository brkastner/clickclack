import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
const thisFile = fileURLToPath(import.meta.url);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|svelte)$/u.test(name) ? [path] : [];
  });
}

test("web source has no bot-specific routing keys or legacy channel grouping", () => {
  const forbidden = [
    "\u043a\u0430\u0439",
    "\u043b\u0438\u0437\u0430",
    "\u0440\u0435\u043a\u0440\u0443\u0442\u0435\u0440",
    "\u0443\u0447\u0438\u043b\u043a\u0430",
    "\u043f\u0438",
    "\u043a\u043b\u0435\u0448\u043d\u044f",
    "\u043d\u0443\u0434\u0437",
  ];
  for (const path of sourceFiles(sourceRoot)) {
    if (path === thisFile) continue;
    const source = readFileSync(path, "utf8").toLocaleLowerCase();
    for (const token of forbidden)
      assert.equal(source.includes(token), false, `${path} contains ${token}`);
    assert.doesNotMatch(
      source,
      /["'`]profile:/u,
      `${path} contains the legacy channel grouping prefix`,
    );
  }
});

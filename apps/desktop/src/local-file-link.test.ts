import assert from "node:assert/strict";
import test from "node:test";
import { localFilePath } from "./local-file-link";

const origin = "https://chat.example.test:8080";
for (const target of [
  "/home/example/output/video.mp4",
  "/Users/example/output/my video.mp4",
  "/home/example/日本語.mp4",
]) {
  test(`local reference: ${target}`, () => {
    assert.equal(localFilePath(target, origin), target);
    assert.equal(localFilePath(origin + encodeURI(target), origin), target);
  });
}
for (const input of [
  "/app/team/channel",
  "/api/uploads/upl_123",
  "/portal",
  "/home",
  "/home/example",
  "/home/example/",
  "/home/example/../secret",
  "/home/example/%2e%2e/secret",
  "/home/example/a/../../secret",
  "/home/example/a%2fb",
  "/home/example/a%5cb",
  "/home/example/%252e%252e/secret",
  "/home/example/a%00b",
  "/home/example/a%0ab",
  "/home/example/%zz",
  "/home/example//video.mp4",
  "/home/example/video.mp4?x=1",
  "/home/example/video.mp4#x",
  "//server/home/example/video.mp4",
  "file:///etc/passwd",
  "javascript:alert(1)",
  "https://elsewhere.test/home/example/video.mp4",
  "https://user:password@chat.example.test:8080/home/example/video.mp4",
  origin + "/home/example/../secret",
  origin + "/home/example/video.mp4?x=1",
  origin + "/home/example/video.mp4#x",
  " /home/example/video.mp4",
  "/home/example/video.mp4\n",
]) {
  test(`not a supported local reference: ${JSON.stringify(input)}`, () =>
    assert.equal(localFilePath(input, origin), null));
}
test("reject non-string payloads and oversized paths", () => {
  for (const input of [null, {}, 1, "/home/example/" + "a".repeat(8192)])
    assert.equal(localFilePath(input, origin), null);
});

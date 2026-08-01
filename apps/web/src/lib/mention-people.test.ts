import test from "node:test";
import assert from "node:assert/strict";
import { collectMentionPeople } from "./chat/people.ts";

const user = (id: string, handle: string) => ({ id, handle, display_name: handle });

test("keeps non-recent ordinary workspace members available for mention highlighting", () => {
  const members = Array.from({ length: 30 }, (_, index) =>
    user(`member-${index}`, `member-${index}`),
  );
  const target = members[29];

  const people = collectMentionPeople(null, [], members, undefined);

  assert.equal(people.length, 30);
  assert.equal(people.find((person) => person.id === target.id)?.handle, target.handle);
});

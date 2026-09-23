import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  defaultGalleryActionValues,
  eligibleGalleryActions,
  validateGalleryActionSchema,
  validateGalleryActionValues,
} from "./gallery-actions.ts";
const upload = { id: "upload-1", content_type: "image/png" } as any;
const fields = [
  {
    id: "images",
    kind: "images",
    label: "Images",
    choices: [{ id: "a", label: "A", upload_id: "upload-a" }],
    min: 0,
    max: 2,
    dynamic: true,
  },
  { id: "amount", kind: "number", label: "Amount", min: 1, max: 3, step: 0.5, default: 1.5 },
  { id: "confirm", kind: "boolean", label: "Confirm", default: true },
  { id: "format", kind: "select", label: "Format", choices: [{ id: "png", label: "PNG" }] },
];
const allowed = new Set(["upload-a", "preview"]);
const descriptor = {
  version: 1,
  id: "synthetic.adjust",
  label: "Adjust",
  accepted_media_types: ["image/png"],
  schema_revision: 1,
  fields,
};
test("wire descriptors match the generated host contract and preserve installation identity", () => {
  const action = { installation_id: "app-1", descriptor };
  assert.deepEqual(eligibleGalleryActions([action, action, null, []], upload), [action]);
  for (const change of [
    { version: 2 },
    { id: "photo:adjust" },
    { callback_url: "https://invalid" },
    { fields: null },
    { accepted_media_types: ["image/*"] },
    { accepted_media_types: ["image/png", "image/png"] },
  ])
    assert.deepEqual(
      eligibleGalleryActions([{ ...action, descriptor: { ...descriptor, ...change } }], upload),
      [],
    );
});
test("schema rejects null, unknown properties, unsupported controls, invalid defaults and bounds", () => {
  const schema = validateGalleryActionSchema({ revision: 1, fields, preview: "preview" }, allowed);
  assert.ok(schema);
  assert.equal(validateGalleryActionValues(schema, defaultGalleryActionValues(schema)), undefined);
  const bad = [
    null,
    [],
    { revision: 1, fields: null },
    { revision: 1, fields, html: "x" },
    { revision: 1, fields, preview: "forbidden" },
    { revision: 1, fields: [...fields, fields[0]] },
  ];
  for (const field of [
    { ...fields[0], choices: [{ id: "a", label: "A", upload_id: "forbidden" }] },
    { ...fields[0], max: 101 },
    { ...fields[0], min: 0.5 },
    {
      ...fields[0],
      choices: [
        { id: "a", label: "A" },
        { id: "a", label: "B" },
      ],
    },
    { ...fields[1], default: null },
    { ...fields[1], default: 1.25 },
    { ...fields[1], step: 0 },
    { ...fields[1], step: 1e-20 },
    { ...fields[1], max: Infinity },
    { ...fields[2], min: 0 },
    { ...fields[2], dynamic: false },
    { ...fields[3], choices: [] },
    { ...fields[3], default: "missing" },
    { ...fields[3], choices: [{ id: "a", label: "A", path: "/tmp/a" }] },
  ])
    bad.push({ revision: 1, fields: [field] } as any);
  for (const v of bad)
    assert.equal(validateGalleryActionSchema(v, allowed), undefined, JSON.stringify(v));
});
test("a failed open leaves a way to start a new panel", () => {
  const panel = readFileSync(
    new URL("../components/outputs/GalleryActionPanel.svelte", import.meta.url),
    "utf8",
  );
  assert.match(panel, /!submission && \(!!error \|\| state==="failed"\)/u);
});
test("dynamic image pages can grow beyond 100 while selection remains bounded", () => {
  const images = Array.from({ length: 229 }, (_, index) => ({
    id: `choice-${index}`,
    label: `Choice ${index}`,
  }));
  const schema = validateGalleryActionSchema({
    revision: 1,
    fields: [{ ...fields[0], choices: images }],
  });
  assert.equal(schema?.fields[0]?.choices.length, 229);
  assert.equal(
    validateGalleryActionSchema({
      revision: 1,
      fields: [{ ...fields[0], dynamic: false, choices: images }],
    }),
    undefined,
  );
});
test("effective values require exact keys, finite aligned numbers and unique scoped choices", () => {
  const schema = validateGalleryActionSchema({ revision: 1, fields }, allowed)!;
  const values = { images: ["a"], amount: 1.5, confirm: true, format: "png" };
  assert.equal(validateGalleryActionValues(schema, values), undefined);
  for (const patch of [
    { amount: 1.25 },
    { amount: NaN },
    { images: ["a", "a"] },
    { images: ["foreign"] },
    { extra: true },
    { format: "foreign" },
    { confirm: null },
  ])
    assert.ok(validateGalleryActionValues(schema, { ...values, ...patch } as any));
  assert.ok(validateGalleryActionValues(schema, null as any));
});

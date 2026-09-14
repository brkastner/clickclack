import type { components } from "../../../../packages/sdk-ts/src/generated/openapi";
import type { Upload } from "./types";
export type GalleryActionDescriptor = components["schemas"]["GalleryActionDescriptor"];
export type GalleryActionChoice = components["schemas"]["GalleryActionChoice"];
export type GalleryActionField = components["schemas"]["GalleryActionField"];
export type GalleryActionDiscovery = components["schemas"]["GalleryActionDiscovery"];
export type GalleryActionResult = components["schemas"]["GalleryActionResult"];
export type GalleryActionSchema = {
  revision: number;
  fields: GalleryActionField[];
  preview?: string;
};
export type GalleryActionValues = Record<string, boolean | number | string | string[]>;
export const galleryActionLimits = { actions: 32, fields: 16, choices: 100, label: 100 } as const;
const idPattern = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const mediaPattern = /^[a-z]+\/[a-z0-9.+-]+$/;
const object = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
const text = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "" && [...v].length <= 100;
const id = (v: unknown): v is string => typeof v === "string" && idPattern.test(v);
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e12;
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.entries(v).every(([k, value]) => allowed.includes(k) && value !== null);
const aligned = (v: number, min: number, step?: number) =>
  step === undefined ||
  (finite((v - min) / step) && Math.abs((v - min) / step - Math.round((v - min) / step)) < 1e-9);
export function mediaTypeMatches(accepted: string, actual: string) {
  return accepted === actual;
}
function choices(raw: unknown, authorized: ReadonlySet<string>): GalleryActionChoice[] | undefined {
  if (!Array.isArray(raw) || raw.length > 100) return;
  const seen = new Set<string>();
  const out: GalleryActionChoice[] = [];
  for (const item of raw) {
    const c = object(item);
    if (
      !c ||
      !keys(c, ["id", "label", "upload_id"]) ||
      !id(c.id) ||
      !text(c.label) ||
      seen.has(c.id) ||
      (c.upload_id !== undefined &&
        (typeof c.upload_id !== "string" || !authorized.has(c.upload_id)))
    )
      return;
    seen.add(c.id);
    out.push({
      id: c.id,
      label: c.label,
      ...(c.upload_id === undefined ? {} : { upload_id: c.upload_id as string }),
    });
  }
  return out;
}
export function validateGalleryActionSchema(
  raw: unknown,
  authorized: ReadonlySet<string> = new Set(),
): GalleryActionSchema | undefined {
  const v = object(raw);
  if (
    !v ||
    !keys(v, ["revision", "fields", "preview"]) ||
    !Number.isInteger(v.revision) ||
    (v.revision as number) < 1 ||
    (v.revision as number) > 2147483647 ||
    !Array.isArray(v.fields) ||
    v.fields.length > 16 ||
    (v.preview !== undefined && (typeof v.preview !== "string" || !authorized.has(v.preview)))
  )
    return;
  const seen = new Set<string>();
  const fields: GalleryActionField[] = [];
  for (const item of v.fields) {
    const f = object(item);
    if (
      !f ||
      !id(f.id) ||
      seen.has(f.id) ||
      !text(f.label) ||
      (f.required !== undefined && typeof f.required !== "boolean")
    )
      return;
    seen.add(f.id);
    const base = ["id", "kind", "label", "required", "default"];
    if (f.kind === "boolean") {
      if (!keys(f, base) || (f.default !== undefined && typeof f.default !== "boolean")) return;
    } else if (f.kind === "number") {
      if (
        !keys(f, [...base, "min", "max", "step"]) ||
        !finite(f.min) ||
        !finite(f.max) ||
        f.min > f.max ||
        (f.step !== undefined && (!finite(f.step) || f.step <= 0))
      )
        return;
    } else if (f.kind === "select" || f.kind === "images") {
      if (!keys(f, [...base, "choices", ...(f.kind === "images" ? ["min", "max", "dynamic"] : [])]))
        return;
      const list = choices(f.choices, authorized);
      if (!list || (f.kind === "select" && !list.length)) return;
      if (
        f.kind === "images" &&
        (!Number.isInteger(f.min) ||
          !Number.isInteger(f.max) ||
          (f.min as number) < 0 ||
          (f.max as number) < (f.min as number) ||
          (f.max as number) > 100 ||
          (f.dynamic !== undefined && typeof f.dynamic !== "boolean"))
      )
        return;
    } else return;
    // All properties and nested choices have been checked before reconstruction.
    const field = structuredClone(f) as GalleryActionField;
    if (
      f.default !== undefined &&
      validateGalleryActionValues({ revision: 1, fields: [field] }, {
        [field.id]: f.default,
      } as GalleryActionValues)
    )
      return;
    fields.push(field);
  }
  return {
    revision: v.revision as number,
    fields,
    ...(v.preview === undefined ? {} : { preview: v.preview as string }),
  };
}
export function eligibleGalleryActions(raw: unknown, upload: Upload): GalleryActionDiscovery[] {
  if (!Array.isArray(raw) || raw.length > 1024) return [];
  const seen = new Set<string>();
  const out: GalleryActionDiscovery[] = [];
  for (const item of raw) {
    const v = object(item);
    const d = object(v?.descriptor);
    if (
      !v ||
      !keys(v, ["installation_id", "descriptor"]) ||
      typeof v.installation_id !== "string" ||
      !v.installation_id ||
      !d ||
      !keys(d, ["version", "id", "label", "accepted_media_types", "schema_revision", "fields"]) ||
      d.version !== 1 ||
      !id(d.id) ||
      !text(d.label) ||
      !Array.isArray(d.accepted_media_types) ||
      !d.accepted_media_types.length ||
      d.accepted_media_types.length > 8 ||
      d.accepted_media_types.some((x) => typeof x !== "string" || !mediaPattern.test(x)) ||
      new Set(d.accepted_media_types).size !== d.accepted_media_types.length ||
      !d.accepted_media_types.includes(upload.content_type)
    )
      continue;
    const allowed = new Set<string>();
    if (Array.isArray(d.fields))
      for (const f of d.fields)
        if (Array.isArray(f?.choices))
          for (const c of f.choices) if (typeof c?.upload_id === "string") allowed.add(c.upload_id);
    if (!validateGalleryActionSchema({ revision: d.schema_revision, fields: d.fields }, allowed))
      continue;
    const key = `${v.installation_id}:${d.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(structuredClone(v) as GalleryActionDiscovery);
  }
  return out;
}
export function validateGalleryActionValues(
  schema: GalleryActionSchema,
  values: GalleryActionValues,
): string | undefined {
  if (
    !object(values) ||
    Object.keys(values).length !== schema.fields.length ||
    schema.fields.some((f) => !Object.hasOwn(values, f.id))
  )
    return "Submission fields do not match this action.";
  for (const f of schema.fields) {
    const v = values[f.id];
    let valid = false;
    if (f.kind === "boolean") valid = typeof v === "boolean";
    if (f.kind === "number")
      valid = finite(v) && v >= f.min && v <= f.max && aligned(v, f.min, f.step);
    if (f.kind === "select") valid = typeof v === "string" && f.choices.some((c) => c.id === v);
    if (f.kind === "images")
      valid =
        Array.isArray(v) &&
        new Set(v).size === v.length &&
        v.length >= f.min &&
        v.length <= f.max &&
        v.every((id) => typeof id === "string" && f.choices.some((c) => c.id === id));
    if (!valid) return `${f.label} has an invalid value or range.`;
  }
}
export function defaultGalleryActionValues(schema: GalleryActionSchema): GalleryActionValues {
  return Object.fromEntries(
    schema.fields.map((f) => [
      f.id,
      f.default ??
        (f.kind === "boolean"
          ? false
          : f.kind === "number"
            ? f.min
            : f.kind === "select"
              ? (f.choices[0]?.id ?? "")
              : []),
    ]),
  );
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readSchemaRuntimeParity(rootPath) {
  return JSON.parse(readFileSync(
    join(rootPath, "test/fixtures/uiux-visual-qa/schema-runtime-parity.json"),
    "utf8",
  ));
}

export function assertCollectionConstraintCorpus(schema, expected) {
  const actual = {};
  function visit(value, path = []) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)]));
      return;
    }
    if (value === null || typeof value !== "object") return;
    if ("minItems" in value || "maxItems" in value || "uniqueItems" in value) {
      actual[path.join(".")] = [
        value.minItems ?? null,
        value.maxItems ?? null,
        value.uniqueItems ?? false,
      ];
    }
    for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
  }
  visit(schema);
  assert.deepEqual(actual, expected);
}

function typeMatches(type, value) {
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return true;
}

function strictDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/u.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second, millisecond = "0"] = match.slice(1).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day && parsed.getUTCHours() === hour
    && parsed.getUTCMinutes() === minute && parsed.getUTCSeconds() === second
    && parsed.getUTCMilliseconds() === millisecond;
}

export function schemaAccepts(root, value) {
  function accepts(schema, candidate) {
    if (schema === true) return true;
    if (schema === false || schema === null || typeof schema !== "object") return false;
    if (schema.$ref) {
      assert.match(schema.$ref, /^#\//u, "parity evaluator accepts local schema references only");
      const target = schema.$ref.slice(2).split("/").reduce((current, segment) =>
        current?.[segment.replaceAll("~1", "/").replaceAll("~0", "~")], root);
      return accepts(target, candidate);
    }
    if (schema.type && !typeMatches(schema.type, candidate)) return false;
    if (Object.hasOwn(schema, "const") && !Object.is(candidate, schema.const)) return false;
    if (schema.enum && !schema.enum.some((item) => Object.is(item, candidate))) return false;
    if (typeof candidate === "string") {
      const codePointLength = Array.from(candidate).length;
      if (schema.minLength !== undefined && codePointLength < schema.minLength) return false;
      if (schema.maxLength !== undefined && codePointLength > schema.maxLength) return false;
      if (schema.pattern && !(new RegExp(schema.pattern, "u")).test(candidate)) return false;
      if (schema.format === "date-time" && !strictDateTime(candidate)) return false;
    }
    if (typeof candidate === "number") {
      if (schema.minimum !== undefined && candidate < schema.minimum) return false;
      if (schema.maximum !== undefined && candidate > schema.maximum) return false;
      if (schema.exclusiveMinimum !== undefined && candidate <= schema.exclusiveMinimum) return false;
    }
    if (Array.isArray(candidate)) {
      if (schema.minItems !== undefined && candidate.length < schema.minItems) return false;
      if (schema.maxItems !== undefined && candidate.length > schema.maxItems) return false;
      if (schema.uniqueItems && new Set(candidate.map((item) => JSON.stringify(item))).size !== candidate.length) return false;
      if (schema.items && candidate.some((item) => !accepts(schema.items, item))) return false;
    }
    if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
      if (schema.required?.some((key) => !Object.hasOwn(candidate, key))) return false;
      if (schema.minProperties !== undefined && Object.keys(candidate).length < schema.minProperties) return false;
      if (schema.additionalProperties === false && Object.keys(candidate).some((key) =>
        !Object.hasOwn(schema.properties ?? {}, key))) return false;
      for (const [key, property] of Object.entries(schema.properties ?? {})) {
        if (Object.hasOwn(candidate, key) && !accepts(property, candidate[key])) return false;
      }
    }
    for (const branch of schema.allOf ?? []) {
      const selected = branch.if
        ? (accepts(branch.if, candidate) ? branch.then : branch.else)
        : branch;
      if (selected && !accepts(selected, candidate)) return false;
    }
    return true;
  }
  return accepts(root, value);
}

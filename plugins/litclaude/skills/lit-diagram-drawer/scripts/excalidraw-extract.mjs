#!/usr/bin/env node
// Bounded stdlib-only Excalidraw extraction; labels are inert, never executed.
import { closeSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const MAX_INPUT = 16 * 1024 * 1024;
const MAX_ELEMENTS = 10_000;
const MAX_NODES = 2_000;
const MAX_RELATIONSHIPS = 5_000;
const MAX_DEPTH = 64;
const URL_RE = /\b(?:https?|ftp|file|javascript|data):[^\s<>"']+/gi;
const EXEC_RE = /<\s*(?:script|iframe|object|embed)\b|\bon[a-z]+\s*=/is;
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const NODE_SHAPES = { rectangle: "rectangle", ellipse: "ellipse", diamond: "diamond", image: "image", embeddable: "embed", iframe: "embed" };
const EDGE_TYPES = new Set(["arrow", "line"]);
const CONTAINER_TYPES = new Set(["frame", "magicframe"]);

class ImportFailure extends Error {}

function reject(message) {
  throw new ImportFailure(message);
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readBounded(filePath, maxBytes) {
  let fd;
  try {
    fd = openSync(filePath, "r");
  } catch (error) {
    reject(`cannot read input: ${error.code === "ENOENT" ? "No such file or directory" : (error.message || "I/O error")}`);
  }
  try {
    const cap = maxBytes + 1;
    const buffer = Buffer.alloc(cap);
    let total = 0;
    while (total < cap) {
      const bytesRead = readSync(fd, buffer, total, cap - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    return buffer.subarray(0, total);
  } catch (error) {
    reject(`cannot read input: ${error.message || "I/O error"}`);
    return undefined;
  } finally {
    closeSync(fd);
  }
}

function safeId(sourceId, used) {
  if (!sourceId) reject("scene contains an element without an id");
  const candidate = ID_RE.test(sourceId) ? sourceId : `n-${sha256Hex(Buffer.from(sourceId, "utf8")).slice(0, 16)}`;
  if (used.has(candidate)) reject("scene contains duplicate or colliding element ids");
  used.add(candidate);
  return candidate;
}

function cleanLabel(raw) {
  if (EXEC_RE.test(raw)) reject("executable markup or event attributes in labels are unsupported");
  const urls = (raw.match(URL_RE) || []).length;
  let text = raw.replace(URL_RE, "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  text = [...text].filter((ch) => ch === "\n" || ch === "\t" || ch.codePointAt(0) >= 32).join("");
  const lines = text.split(/\r\n|\r|\n/).map((line) => line.replace(/[ \t]+/g, " ").trim());
  return [lines.filter((line) => line).join("\n").slice(0, 2_000), urls];
}

function checkJsonDepth(text) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === "[" || char === "{") {
      depth += 1;
    }
    if (depth > MAX_DEPTH) {
      reject("scene nesting exceeds the depth limit (64)");
    } else if (char === "]" || char === "}") {
      depth -= 1;
    }
  }
}

function finiteGeometry(element) {
  for (const key of ["x", "y", "width", "height"]) {
    const value = element[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number") reject(`element geometry field ${key} must be numeric`);
    if (!Number.isFinite(value) || Math.abs(value) > 10_000_000) reject(`element geometry field ${key} is outside the supported range`);
  }
}

function computeTitle(filePath) {
  const base = path.basename(filePath);
  const stripped = base.replace(/\.excalidraw\.json$/i, "").replace(/\.excalidraw$/i, "");
  return stripped || "Imported diagram";
}

function extract(filePath) {
  const suffix = path.basename(filePath).toLowerCase();
  if (!(suffix.endsWith(".excalidraw") || suffix.endsWith(".excalidraw.json"))) {
    reject("unsupported form; provide a saved .excalidraw scene");
  }
  const data = readBounded(filePath, MAX_INPUT);
  if (data.length > MAX_INPUT) reject("input exceeds the 16 MiB limit");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
  } catch {
    reject("scene is not valid UTF-8 JSON");
  }
  checkJsonDepth(text);
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    reject("scene is malformed JSON");
  }
  if (typeof document !== "object" || document === null || Array.isArray(document) || document.type !== "excalidraw") {
    reject("input is not an Excalidraw scene");
  }
  const elements = document.elements;
  if (!Array.isArray(elements)) reject("scene has no elements array");
  if (elements.length > MAX_ELEMENTS) reject("element limit exceeded (max 10,000)");

  const live = [];
  const used = new Set();
  const idMap = new Map();
  const discarded = {
    styles: 0, links: 0, urls: 0, scripts: 0,
    assets: 0, unsupportedElements: 0, deletedElements: 0,
    freehandStrokes: 0, danglingRelationships: 0,
  };
  for (const item of elements) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) reject("scene element must be an object");
    const sourceId = item.id;
    const elementType = item.type;
    if (typeof sourceId !== "string" || typeof elementType !== "string") reject("scene elements require string id and type fields");
    if (idMap.has(sourceId)) reject("scene contains duplicate element ids");
    idMap.set(sourceId, safeId(sourceId, used));
    finiteGeometry(item);
    if (item.isDeleted === true) {
      discarded.deletedElements += 1;
      continue;
    }
    live.push(item);
  }
  const frameIds = new Set(live.filter((el) => CONTAINER_TYPES.has(el.type) && typeof el.id === "string").map((el) => el.id));

  const labels = new Map();
  for (const element of live) {
    if (element.type !== "text") continue;
    const container = element.containerId;
    const rawText = Object.prototype.hasOwnProperty.call(element, "text") ? element.text : "";
    if (typeof rawText !== "string") reject("text element content must be a string");
    const [labelText, count] = cleanLabel(rawText);
    discarded.urls += count;
    if (typeof container === "string" && idMap.has(container) && labelText) {
      if (!labels.has(container)) labels.set(container, []);
      labels.get(container).push(labelText);
    }
  }

  const nodes = [];
  const nodeSourceIds = new Set();
  for (const element of live) {
    const sourceId = element.id;
    const elementType = element.type;
    if (typeof sourceId !== "string" || typeof elementType !== "string") reject("scene element id and type must be strings");
    if (EDGE_TYPES.has(elementType) || (elementType === "text" && typeof element.containerId === "string")) continue;
    if (elementType === "selection" || elementType === "laser") continue;
    if (elementType === "freedraw") {
      discarded.freehandStrokes += 1;
      continue;
    }
    let shape;
    let kind;
    let rawLabel;
    if (CONTAINER_TYPES.has(elementType)) {
      shape = "container";
      kind = "container";
      rawLabel = typeof element.name === "string" ? element.name : "";
    } else if (elementType === "text") {
      shape = "text";
      kind = "annotation";
      rawLabel = typeof element.text === "string" ? element.text : "";
    } else if (elementType in NODE_SHAPES) {
      shape = NODE_SHAPES[elementType];
      kind = "component";
      rawLabel = "";
      if (["image", "embeddable", "iframe"].includes(elementType)) discarded.assets += 1;
    } else {
      discarded.unsupportedElements += 1;
      continue;
    }
    const [cleaned, count] = cleanLabel(rawLabel);
    discarded.urls += count;
    let finalLabel = cleaned;
    const bound = labels.get(sourceId) || [];
    if (bound.length) finalLabel = bound.join("\n").slice(0, 2_000);
    const link = element.link;
    if (typeof link === "string" && link) {
      discarded.links += 1;
      discarded.urls += (link.match(URL_RE) || []).length > 0 ? 1 : 0;
    }
    if (nodes.length >= MAX_NODES) reject("node limit exceeded (max 2,000)");
    const node = { id: idMap.get(sourceId), label: finalLabel, kind, shape };
    const parent = element.frameId;
    if (typeof parent === "string" && frameIds.has(parent)) node.parentId = idMap.get(parent);
    nodes.push(node);
    nodeSourceIds.add(sourceId);
  }

  const relationships = [];
  for (const element of live) {
    if (!EDGE_TYPES.has(element.type)) continue;
    const sourceId = element.id;
    if (typeof sourceId !== "string") continue;
    const start = element.startBinding;
    const end = element.endBinding;
    const startId = start && typeof start === "object" && !Array.isArray(start) ? start.elementId : undefined;
    const endId = end && typeof end === "object" && !Array.isArray(end) ? end.elementId : undefined;
    if (typeof startId !== "string" || typeof endId !== "string" || !nodeSourceIds.has(startId) || !nodeSourceIds.has(endId)) {
      discarded.danglingRelationships += 1;
      continue;
    }
    const rawLabel = (labels.get(sourceId) || []).join("\n");
    const [labelText, count] = cleanLabel(rawLabel);
    discarded.urls += count;
    const startHead = element.startArrowhead;
    const endHead = element.endArrowhead;
    const hasStart = typeof startHead === "string" && startHead !== "" && startHead !== "none";
    const hasEnd = typeof endHead === "string" && endHead !== "" && endHead !== "none";
    const direction = hasStart && hasEnd ? "both" : hasStart ? "reverse" : (hasEnd || element.type === "arrow") ? "forward" : "none";
    relationships.push({
      from: idMap.get(startId), to: idMap.get(endId), label: labelText,
      kind: element.type === "arrow" ? "flow" : "association", direction,
    });
  }
  if (relationships.length > MAX_RELATIONSHIPS) reject("relationship limit exceeded (max 5,000)");

  const groups = [];
  for (const frameId of [...frameIds].sort()) {
    const members = live
      .filter((el) => el.frameId === frameId && typeof el.id === "string" && nodeSourceIds.has(el.id))
      .map((el) => el.id);
    if (members.length) {
      const frameNode = nodes.find((node) => node.id === idMap.get(frameId));
      const labelText = frameNode ? String(frameNode.label) : "Frame";
      groups.push({ id: idMap.get(frameId), label: labelText, nodeIds: members.map((m) => idMap.get(m)) });
    }
  }
  const sourceGroups = new Map();
  for (const element of live) {
    const elementId = element.id;
    const groupIdsField = element.groupIds;
    if (typeof elementId === "string" && nodeSourceIds.has(elementId) && Array.isArray(groupIdsField)) {
      for (const groupId of groupIdsField.slice(0, 64)) {
        if (typeof groupId === "string") {
          if (!sourceGroups.has(groupId) && sourceGroups.size >= MAX_NODES) reject("group limit exceeded (max 2,000)");
          if (!sourceGroups.has(groupId)) sourceGroups.set(groupId, []);
          sourceGroups.get(groupId).push(elementId);
        }
      }
    }
  }
  for (const [groupId, members] of sourceGroups) {
    const groupSafeId = `g-${sha256Hex(Buffer.from(groupId, "utf8")).slice(0, 16)}`;
    if (used.has(groupSafeId)) reject("group id collides with an element id");
    used.add(groupSafeId);
    groups.push({ id: groupSafeId, label: "Group", nodeIds: members.map((m) => idMap.get(m)) });
  }

  if (!nodes.length) reject("scene contains no supported diagram elements");
  discarded.styles = live.filter((el) => ["backgroundColor", "strokeColor", "strokeStyle", "roughness"].some((key) => key in el)).length;
  const files = document.files;
  if (files && typeof files === "object" && !Array.isArray(files)) discarded.assets += Object.keys(files).length;
  const suggested = relationships.length ? "flowchart" : "architecture";

  return {
    schemaVersion: 1,
    sourceFormat: "excalidraw",
    sourceDigest: sha256Hex(data),
    title: computeTitle(filePath),
    suggestedType: suggested,
    nodes, relationships, groups,
    discarded,
    warnings: ["Source coordinates and styling are omitted; label text is inert data."],
  };
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith("--"));
  if (!file) {
    process.stderr.write("Usage: node scripts/excalidraw-extract.mjs <file>\n");
    return 2;
  }
  try {
    const result = extract(file);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof ImportFailure ? error.message : (error && error.message ? error.message : String(error));
    process.stderr.write(`excalidraw_extract: ${message}\n`);
    return 2;
  }
}

process.exitCode = main();

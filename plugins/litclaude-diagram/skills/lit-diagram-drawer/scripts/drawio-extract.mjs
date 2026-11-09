#!/usr/bin/env node
// Bounded stdlib-only draw.io extraction; labels are inert and never executed.
import { closeSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import zlib from "node:zlib";

const MAX_INPUT = 16 * 1024 * 1024;
const MAX_DECODED = 32 * 1024 * 1024;
const MAX_NODES = 2_000;
const MAX_EDGES = 5_000;
const MAX_DEPTH = 64;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const URL_RE = /\b(?:https?|ftp|file|javascript|data):[^\s<>"']+/gi;
const TAG_RE = /<[^>]*>/g;
const BREAK_RE = /<br\s*\/?>|<\/(?:p|div)\s*>/gi;
const EXEC_RE = /<\s*(?:script|iframe|object|embed)\b|\bon[a-z]+\s*=/is;
const SAFE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const DTD_RE = /<!DOCTYPE|<!ENTITY/i;
const SHAPE_ALIASES = [
  ["rhombus", "diamond"], ["diamond", "diamond"], ["ellipse", "ellipse"], ["actor", "ellipse"],
  ["cylinder", "cylinder"], ["database", "cylinder"], ["swimlane", "container"], ["text", "text"],
  ["group", "group"], ["table", "table"], ["hexagon", "hexagon"], ["cloud", "cloud"],
  ["parallelogram", "parallelogram"], ["document", "document"], ["image", "image"],
];
const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

class ImportFailure extends Error {}

function reject(message) {
  throw new ImportFailure(message);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
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
  if (!sourceId) reject("diagram contains an element without an id");
  const candidate = SAFE_ID_RE.test(sourceId) ? sourceId : `n-${sha256Hex(Buffer.from(sourceId, "utf8")).slice(0, 16)}`;
  if (used.has(candidate)) reject("diagram contains duplicate element ids");
  used.add(candidate);
  return candidate;
}

function htmlUnescape(text) {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/g, (match, ent) => {
    if (ent[0] === "#") {
      const isHex = ent[1] === "x" || ent[1] === "X";
      const codePoint = isHex ? Number.parseInt(ent.slice(2), 16) : Number.parseInt(ent.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    if (ent === "nbsp") return " ";
    return NAMED_ENTITIES[ent];
  });
}

function plainLabel(value) {
  if (EXEC_RE.test(value)) reject("executable markup or event attributes in labels are unsupported");
  const urlCount = (value.match(URL_RE) || []).length;
  let text = value.replace(URL_RE, "");
  text = text.replace(BREAK_RE, "\n");
  text = text.replace(TAG_RE, "");
  text = htmlUnescape(text).replaceAll(" ", " ");
  const lines = text.split(/\r\n|\r|\n/).map((line) => line.replace(/[ \t]+/g, " ").trim());
  return [lines.filter((line) => line).join("\n").slice(0, 2_000), urlCount];
}

function pyUnquote(text) {
  if (!text.includes("%")) return text;
  const isHex = (ch) => /[0-9a-fA-F]/.test(ch);
  let out = "";
  let bytes = [];
  const flush = () => {
    if (bytes.length) {
      out += Buffer.from(bytes).toString("utf8");
      bytes = [];
    }
  };
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (ch === "%" && i + 2 < n && isHex(text[i + 1]) && isHex(text[i + 2])) {
      bytes.push(Number.parseInt(text.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      flush();
      out += ch;
      i += 1;
    }
  }
  flush();
  return out;
}

function boundedInflate(buffer, mode, sizeMessage, malformedMessage) {
  try {
    return mode === "raw"
      ? zlib.inflateRawSync(buffer, { maxOutputLength: MAX_DECODED })
      : zlib.inflateSync(buffer, { maxOutputLength: MAX_DECODED });
  } catch (error) {
    if (error && error.code === "ERR_BUFFER_TOO_LARGE") reject(sizeMessage);
    reject(malformedMessage);
    return undefined;
  }
}

function decodePage(payload) {
  const compact = payload.replace(/\s+/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})?$/.test(compact)) {
    reject("compressed draw.io page is not valid base64");
  }
  const packed = Buffer.from(compact, "base64");
  const decoded = boundedInflate(
    packed,
    "raw",
    "decoded draw.io page exceeds the size limit",
    "compressed draw.io page is malformed or unsupported",
  );
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(decoded);
  } catch {
    reject("compressed draw.io page is not UTF-8");
  }
  return pyUnquote(text);
}

function splitBytes(buffer, byte, maxSplit) {
  const parts = [];
  let start = 0;
  while (parts.length < maxSplit) {
    const idx = buffer.indexOf(byte, start);
    if (idx === -1) break;
    parts.push(buffer.subarray(start, idx));
    start = idx + 1;
  }
  parts.push(buffer.subarray(start));
  return parts;
}

function pngEmbeddedXml(data) {
  let pos = PNG_MAGIC.length;
  while (pos + 12 <= data.length) {
    const size = data.readUInt32BE(pos);
    const kind = data.subarray(pos + 4, pos + 8);
    const kindStr = kind.toString("latin1");
    const end = pos + 8 + size;
    if (end + 4 > data.length) reject("PNG has a truncated metadata chunk");
    const payload = data.subarray(pos + 8, end);
    const expectedCrc = data.readUInt32BE(end);
    if (crc32(Buffer.concat([kind, payload])) !== expectedCrc) reject("PNG metadata chunk has an invalid CRC");
    pos = end + 4;
    if (!["tEXt", "zTXt", "iTXt"].includes(kindStr)) {
      if (kindStr === "IEND") break;
      continue;
    }
    const nullIdx = payload.indexOf(0);
    if (nullIdx === -1) continue;
    const keyword = payload.subarray(0, nullIdx);
    const rest = payload.subarray(nullIdx + 1);
    if (keyword.toString("latin1").toLowerCase() !== "mxfile") continue;
    let value;
    try {
      if (kindStr === "tEXt") {
        value = rest.toString("latin1");
      } else if (kindStr === "zTXt") {
        if (rest.length === 0 || rest[0] !== 0) reject("PNG mxfile text uses an unsupported compression method");
        const inflated = boundedInflate(
          rest.subarray(1), "zlib",
          "embedded draw.io payload exceeds the decoded size limit",
          "embedded draw.io payload has invalid compression",
        );
        value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(inflated);
      } else {
        if (rest.length < 4 || rest[1] !== 0) reject("PNG mxfile international text is malformed");
        const compressionFlag = rest[0];
        const fields = splitBytes(rest.subarray(2), 0, 2);
        if (fields.length !== 3) reject("PNG mxfile international text is malformed");
        const raw = compressionFlag === 1
          ? boundedInflate(fields[2], "zlib", "embedded draw.io payload exceeds the decoded size limit", "embedded draw.io payload has invalid compression")
          : fields[2];
        value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
      }
    } catch (error) {
      if (error instanceof ImportFailure) throw error;
      reject("PNG mxfile metadata is not valid text");
    }
    const expanded = pyUnquote(value);
    if (Buffer.byteLength(expanded, "utf8") > MAX_DECODED) reject("embedded draw.io payload exceeds the decoded size limit");
    return expanded;
  }
  reject("PNG has no embedded mxfile diagram");
  return undefined;
}

function localName(name) {
  const idx = name.lastIndexOf(":");
  return idx === -1 ? name : name.slice(idx + 1);
}

function iterElements(root) {
  const result = [];
  const stack = [root];
  while (stack.length) {
    const element = stack.pop();
    result.push(element);
    for (let i = element.children.length - 1; i >= 0; i -= 1) stack.push(element.children[i]);
  }
  return result;
}

function parseXml(text, maxDepth, malformedLabel) {
  const n = text.length;
  let i = 0;
  let root = null;
  let rootClosed = false;
  const stack = [];

  const fail = (detail) => reject(detail ? `${malformedLabel}: ${detail}` : malformedLabel);
  const isSpace = (ch) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

  function decodeEntities(str) {
    if (!str.includes("&")) return str;
    return str.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (match, ent) => {
      if (ent[0] === "#") {
        const isHex = ent[1] === "x" || ent[1] === "X";
        const codePoint = isHex ? Number.parseInt(ent.slice(2), 16) : Number.parseInt(ent.slice(1), 10);
        if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) fail("invalid numeric character reference");
        return String.fromCodePoint(codePoint);
      }
      switch (ent) {
        case "amp": return "&";
        case "lt": return "<";
        case "gt": return ">";
        case "quot": return '"';
        case "apos": return "'";
        default:
          fail(`unknown entity reference &${ent};`);
          return match;
      }
    });
  }

  function appendText(raw, decode) {
    if (!raw) return;
    const value = decode ? decodeEntities(raw) : raw;
    if (!stack.length) {
      if (value.trim() !== "") fail(root === null ? "text found before the document element" : "text found after the document element");
      return;
    }
    const parent = stack[stack.length - 1];
    if (parent.children.length === 0) parent.text += value;
  }

  function parseStartTag(start) {
    let j = start + 1;
    const nameStart = j;
    while (j < n && !isSpace(text[j]) && text[j] !== "/" && text[j] !== ">") j += 1;
    const name = text.slice(nameStart, j);
    if (!name) fail("malformed start tag");
    const attrib = {};
    let selfClosing = false;
    for (;;) {
      while (j < n && isSpace(text[j])) j += 1;
      if (j >= n) fail("unterminated start tag");
      if (text[j] === "/") {
        if (text[j + 1] !== ">") fail("malformed start tag");
        selfClosing = true;
        j += 2;
        break;
      }
      if (text[j] === ">") {
        j += 1;
        break;
      }
      const attrNameStart = j;
      while (j < n && !isSpace(text[j]) && text[j] !== "=" && text[j] !== "/" && text[j] !== ">") j += 1;
      const attrName = text.slice(attrNameStart, j);
      if (!attrName) fail("malformed attribute");
      while (j < n && isSpace(text[j])) j += 1;
      if (text[j] !== "=") fail("malformed attribute (expected =)");
      j += 1;
      while (j < n && isSpace(text[j])) j += 1;
      const quote = text[j];
      if (quote !== '"' && quote !== "'") fail("malformed attribute value (expected a quote)");
      j += 1;
      const valueStart = j;
      const endQuote = text.indexOf(quote, j);
      if (endQuote === -1) fail("unterminated attribute value");
      const rawValue = text.slice(valueStart, endQuote);
      if (rawValue.includes("<")) fail("malformed attribute value");
      attrib[attrName] = decodeEntities(rawValue);
      j = endQuote + 1;
    }
    return { name, attrib, selfClosing, nextIndex: j };
  }

  while (i < n) {
    if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i + 2);
      if (end === -1) fail("unterminated processing instruction");
      i = end + 2;
      continue;
    }
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end === -1) fail("unterminated comment");
      i = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", i)) {
      const end = text.indexOf("]]>", i + 9);
      if (end === -1) fail("unterminated CDATA section");
      appendText(text.slice(i + 9, end), false);
      i = end + 3;
      continue;
    }
    if (text.startsWith("<!", i)) fail("DTD and entity declarations are unsupported");
    if (text.startsWith("</", i)) {
      const end = text.indexOf(">", i + 2);
      if (end === -1) fail("unterminated end tag");
      const name = text.slice(i + 2, end).trim();
      if (!stack.length) fail("unexpected closing tag");
      const top = stack[stack.length - 1];
      if (top.tag !== name) fail(`mismatched closing tag ${name}`);
      stack.pop();
      if (!stack.length) rootClosed = true;
      i = end + 1;
      continue;
    }
    if (text[i] === "<") {
      if (rootClosed) fail("multiple document elements");
      const parsed = parseStartTag(i);
      const node = { tag: parsed.name, attrib: parsed.attrib, children: [], text: "" };
      if (root === null) {
        root = node;
      } else {
        const parent = stack[stack.length - 1];
        if (!parent) fail("element found outside the document element");
        parent.children.push(node);
      }
      if (parsed.selfClosing) {
        if (!stack.length) rootClosed = true;
      } else {
        stack.push(node);
        if (stack.length > maxDepth) fail("XML nesting exceeds the depth limit");
      }
      i = parsed.nextIndex;
      continue;
    }
    const nextLt = text.indexOf("<", i);
    const rawText = nextLt === -1 ? text.slice(i) : text.slice(i, nextLt);
    appendText(rawText, true);
    i = nextLt === -1 ? n : nextLt;
  }
  if (stack.length) fail("element was not closed");
  if (root === null) fail("no document element");
  return root;
}

function svgEmbeddedXml(text) {
  const root = parseXml(text, MAX_DEPTH, "draw.io SVG is malformed");
  for (const element of iterElements(root)) {
    for (const [name, raw] of Object.entries(element.attrib)) {
      if (localName(name).toLowerCase() !== "content") continue;
      if (raw.includes("<mxfile") || raw.includes("<mxGraphModel")) {
        if (Buffer.byteLength(raw, "utf8") > MAX_DECODED) reject("embedded draw.io payload exceeds the decoded size limit");
        return raw;
      }
    }
  }
  reject("SVG has no embedded draw.io diagram");
  return undefined;
}

function parseSource(filePath) {
  const data = readBounded(filePath, MAX_INPUT);
  if (data.length > MAX_INPUT) reject("input exceeds the 16 MiB limit");
  let text;
  if (data.length >= PNG_MAGIC.length && data.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    text = pngEmbeddedXml(data);
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(data).trim();
    } catch {
      reject("input is not UTF-8 draw.io XML");
    }
    if (DTD_RE.test(text)) reject("DTD and entity declarations are unsupported");
    if (text.startsWith("<svg")) {
      text = svgEmbeddedXml(text);
    } else if (!text.startsWith("<")) {
      reject("unsupported form; provide draw.io XML, compressed XML, or an SVG/PNG with embedded mxfile data");
    }
  }
  if (DTD_RE.test(text)) reject("DTD and entity declarations are unsupported");
  const root = parseXml(text, MAX_DEPTH, "malformed draw.io XML");
  const rootTag = localName(root.tag);
  if (rootTag === "mxGraphModel") return { data, sourceRoot: root, pages: [root] };
  if (rootTag !== "mxfile") reject("unsupported XML root; expected mxfile or mxGraphModel");
  const pages = [];
  for (const diagram of root.children) {
    if (localName(diagram.tag) !== "diagram") continue;
    let model = diagram.children.find((child) => localName(child.tag) === "mxGraphModel");
    if (!model) {
      const payload = (diagram.text || "").trim();
      if (!payload) reject("draw.io page has no readable mxGraphModel");
      const expanded = decodePage(payload);
      if (DTD_RE.test(expanded)) reject("DTD and entity declarations are unsupported");
      model = parseXml(expanded, MAX_DEPTH, "malformed compressed draw.io XML");
      if (localName(model.tag) !== "mxGraphModel") reject("compressed page does not contain mxGraphModel");
    }
    pages.push(model);
  }
  if (!pages.length) reject("draw.io file contains no pages");
  return { data, sourceRoot: root, pages };
}

function shapeName(style) {
  const match = /(?:^|;)shape=([^;]+)/.exec(style);
  const raw = match ? match[1].toLowerCase() : "rect";
  for (const [token, shape] of SHAPE_ALIASES) {
    if (raw.includes(token)) return shape;
  }
  return "rectangle";
}

function extract(filePath, pageIndex) {
  const { data, sourceRoot, pages } = parseSource(filePath);
  if (pageIndex < 0 || pageIndex >= pages.length) reject(`page index is out of range (file contains ${pages.length} page(s))`);
  const model = pages[pageIndex];
  const root = model.children.find((child) => localName(child.tag) === "root");
  if (!root) reject("mxGraphModel has no root cell list");

  const records = [];
  for (const wrapper of root.children) {
    const tag = localName(wrapper.tag);
    const cell = tag === "mxCell" ? wrapper : wrapper.children.find((item) => localName(item.tag) === "mxCell");
    if (!cell) continue;
    const attrs = { ...wrapper.attrib, ...cell.attrib };
    if (!("value" in attrs)) attrs.value = wrapper.attrib.label || "";
    records.push(attrs);
  }
  if (records.length > MAX_NODES + MAX_EDGES) reject("diagram exceeds the 7,000 cell limit");

  const used = new Set();
  const idMap = new Map();
  for (const attrs of records) {
    const rawId = attrs.id || "";
    if (idMap.has(rawId)) reject("diagram contains duplicate element ids");
    idMap.set(rawId, safeId(rawId, used));
  }

  const vertices = records.filter((attrs) => attrs.vertex === "1");
  const edgeRecords = records.filter((attrs) => attrs.edge === "1");
  if (vertices.length > MAX_NODES || edgeRecords.length > MAX_EDGES) reject("diagram exceeds the node or relationship limit");

  const nodeIds = new Set(vertices.map((attrs) => attrs.id));
  const childIds = new Map();
  for (const attrs of vertices) {
    const parent = attrs.parent || "";
    if (nodeIds.has(parent)) {
      if (!childIds.has(parent)) childIds.set(parent, []);
      childIds.get(parent).push(attrs.id);
    }
  }

  const discarded = { styles: 0, links: 0, urls: 0, assets: 0, unsupportedElements: 0, danglingRelationships: 0 };
  const nodes = [];
  const groups = [];
  for (const attrs of vertices) {
    const sourceId = attrs.id;
    const [label, urlCount] = plainLabel(attrs.value || "");
    discarded.urls += urlCount;
    const style = attrs.style || "";
    discarded.styles += style ? 1 : 0;
    discarded.links += (attrs.link || attrs.href) ? 1 : 0;
    discarded.assets += (style.toLowerCase().includes("image=") || shapeName(style) === "image") ? 1 : 0;
    const children = childIds.get(sourceId) || [];
    const sourceShape = shapeName(style);
    const isGroup = children.length > 0 || sourceShape === "container" || sourceShape === "group";
    const node = {
      id: idMap.get(sourceId), label,
      kind: isGroup ? "container" : "component",
      shape: isGroup ? "container" : sourceShape,
    };
    const parent = attrs.parent || "";
    if (nodeIds.has(parent)) node.parentId = idMap.get(parent);
    nodes.push(node);
    if (children.length) {
      groups.push({ id: idMap.get(sourceId), label: label || "Group", nodeIds: children.map((child) => idMap.get(child)) });
    }
  }

  const relationships = [];
  for (const attrs of edgeRecords) {
    const source = attrs.source || "";
    const target = attrs.target || "";
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      discarded.danglingRelationships += 1;
      continue;
    }
    const [label, urlCount] = plainLabel(attrs.value || "");
    discarded.urls += urlCount;
    const style = attrs.style || "";
    discarded.styles += style ? 1 : 0;
    discarded.links += (attrs.link || attrs.href) ? 1 : 0;
    const startArrow = /(?:^|;)startArrow=(?!none(?:;|$))/.test(style);
    const endArrow = /(?:^|;)endArrow=(?!none(?:;|$))/.test(style);
    const direction = startArrow && endArrow ? "both" : startArrow ? "reverse" : endArrow ? "forward" : "none";
    relationships.push({
      from: idMap.get(source), to: idMap.get(target), label,
      kind: direction !== "none" ? "flow" : "association", direction,
    });
  }

  const parents = new Map(vertices.map((attrs) => [attrs.id, attrs.parent || ""]));
  for (const attrs of vertices) {
    let parent = parents.get(attrs.id);
    let depth = 0;
    const seen = new Set([attrs.id]);
    while (parents.has(parent)) {
      if (seen.has(parent)) reject("container hierarchy contains a cycle");
      seen.add(parent);
      depth += 1;
      if (depth > MAX_DEPTH) reject("container hierarchy exceeds the depth limit");
      parent = parents.get(parent);
    }
  }

  const diagramChildren = sourceRoot.children.filter((item) => localName(item.tag) === "diagram");
  const pageName = diagramChildren[pageIndex] ? (diagramChildren[pageIndex].attrib.name || "") : "";
  const suggestedType = edgeRecords.length > 0 || nodes.some((node) => node.shape === "diamond") ? "flowchart" : "architecture";

  return {
    schemaVersion: 1,
    sourceFormat: "drawio",
    sourceDigest: sha256Hex(data),
    title: plainLabel(pageName || path.parse(filePath).name)[0] || "Imported diagram",
    suggestedType,
    nodes, relationships, groups,
    discarded,
    warnings: ["Source styles and coordinates are omitted; label text is inert data."],
  };
}

function parseArgs(args) {
  let file = null;
  let page = 0;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--page") {
      i += 1;
      const value = args[i];
      if (value === undefined || !/^-?\d+$/.test(value)) reject("--page requires an integer value");
      page = Number.parseInt(value, 10);
    } else if (!arg.startsWith("--") && file === null) {
      file = arg;
    } else {
      reject(`unknown argument: ${arg}`);
    }
  }
  if (!file) reject("usage: node scripts/drawio-extract.mjs <file> [--page N]");
  return { file, page };
}

function main() {
  let file;
  let page;
  try {
    ({ file, page } = parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`drawio_extract: ${error instanceof ImportFailure ? error.message : error.message}\n`);
    return 2;
  }
  try {
    const result = extract(file, page);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof ImportFailure ? error.message : (error && error.message ? error.message : String(error));
    process.stderr.write(`drawio_extract: ${message}\n`);
    return 2;
  }
}

process.exitCode = main();

#!/usr/bin/env node
// Bounded stdlib-only Mermaid extraction; labels are inert and never executed.
import { closeSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const MAX_INPUT = 4 * 1024 * 1024;
const MAX_NODES = 2_000;
const MAX_EDGES = 5_000;
const MAX_DEPTH = 64;
const URL_RE = /\b(?:https?|ftp|file|javascript|data):[^\s<>"']+/gi;
const EXEC_RE = /<\s*(?:script|iframe|object|embed)\b|\bon[a-z]+\s*=/is;
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const HEADER_RE = /^(flowchart|graph|sequenceDiagram|stateDiagram-v2|erDiagram)\b(.*)$/i;
const KINDS = {
  flowchart: "flowchart", graph: "flowchart", sequencediagram: "sequence",
  "statediagram-v2": "state", erdiagram: "er",
};
const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

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

function safeId(raw, used) {
  if (!raw) reject("diagram contains an empty element id");
  const safe = ID_RE.test(raw) ? raw : `n-${sha256Hex(Buffer.from(raw, "utf8")).slice(0, 16)}`;
  if (used.has(safe)) reject("diagram contains duplicate or colliding ids");
  used.add(safe);
  return safe;
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

function label(raw) {
  if (EXEC_RE.test(raw)) reject("executable markup or event attributes in labels are unsupported");
  const urls = (raw.match(URL_RE) || []).length;
  let text = raw.replace(URL_RE, "").replaceAll("<br/>", "\n").replaceAll("<br>", "\n");
  text = text.replace(/<[^>]*>/g, "");
  text = htmlUnescape(text).replaceAll(" ", " ");
  text = text.replace(/\*\*(.*?)\*\*|__(.*?)__/g, (_match, g1, g2) => g1 || g2 || "");
  const lines = text.split(/\r\n|\r|\n/).map((s) => s.replace(/[ \t]+/g, " ").trim());
  return [lines.filter((s) => s).join("\n").slice(0, 2_000), urls];
}

function escapeRegExp(ch) {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readBlocks(filePath) {
  const data = readBounded(filePath, MAX_INPUT);
  if (data.length > MAX_INPUT) reject("input exceeds the 4 MiB limit");
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
  } catch {
    reject("input is not valid UTF-8");
  }
  const suffix = path.extname(filePath).toLowerCase();
  if (suffix === ".mmd" || suffix === ".mermaid") return { data, blocks: [[source, 1]] };
  if (![".md", ".markdown", ".mdown", ".mkd"].includes(suffix)) reject("provide .mmd, .mermaid, or Markdown");
  const blocks = [];
  let active = 0;
  let fenceChar = "";
  let fenceLen = 0;
  let content = [];
  const lines = source.split(/\r\n|\r|\n/);
  lines.forEach((line, idx) => {
    const number = idx + 1;
    if (!active) {
      const found = /^\s*(`{3,}|~{3,})\s*mermaid\s*$/i.exec(line);
      if (found) {
        active = number + 1;
        fenceChar = found[1][0];
        fenceLen = found[1].length;
        content = [];
      }
      return;
    }
    const closeRe = new RegExp(`^\\s*${escapeRegExp(fenceChar)}{${fenceLen},}\\s*$`);
    if (closeRe.test(line)) {
      blocks.push([content.join("\n"), active]);
      active = 0;
      fenceChar = "";
      fenceLen = 0;
      content = [];
    } else {
      content.push(line);
    }
  });
  if (active) reject(`unterminated Mermaid fence at line ${active - 1}`);
  if (!blocks.length) reject("Markdown contains no fenced Mermaid block");
  return { data, blocks };
}

function extract(filePath, index) {
  const { data, blocks } = readBlocks(filePath);
  if (index < 0 || index >= blocks.length) reject(`diagram index out of range (${blocks.length} block(s))`);
  let [source, firstLine] = blocks[index];
  let lines = source.split(/\r\n|\r|\n/);
  if (lines.length && lines[0].trim() === "---") {
    let end = -1;
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === "---") {
        end = i;
        break;
      }
    }
    if (end === -1) reject("unterminated Mermaid frontmatter");
    lines = lines.slice(end + 1);
    firstLine += end + 1;
  }
  const numbered = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("%%")) numbered.push([firstLine + i, trimmed]);
  });

  let headerIndex = -1;
  let headerText = "";
  let headerLine = 0;
  for (let i = 0; i < numbered.length; i += 1) {
    const [number, text] = numbered[i];
    if (HEADER_RE.test(text)) {
      headerIndex = i;
      headerText = text;
      headerLine = number;
      break;
    }
  }
  if (headerIndex === -1) reject("unsupported or missing Mermaid diagram declaration");
  const match = HEADER_RE.exec(headerText);
  if (!match) reject(`malformed diagram declaration at line ${headerLine}`);
  const rawKind = match[1].toLowerCase();
  if (!(rawKind in KINDS)) reject(`unsupported Mermaid grammar at line ${headerLine}`);
  const grammar = KINDS[rawKind];
  const directionMatch = /\b(TD|TB|BT|LR|RL)\b/i.exec(match[2]);
  let directionHint = directionMatch ? directionMatch[1].toUpperCase() : "";

  const nodes = new Map();
  const groups = new Map();
  const relations = [];
  const stack = [];
  const fields = new Map();
  let entity = null;
  let title = "";
  const discarded = { styles: 0, links: 0, urls: 0, scripts: 0, directives: 0, unsupportedElements: 0 };

  const add = (rawId, text = "", shape = "rectangle", kind = "component") => {
    if (!nodes.has(rawId)) {
      if (nodes.size >= MAX_NODES) reject("node limit exceeded (max 2,000)");
      nodes.set(rawId, { name: text || rawId, shape, kind, parent: stack.length ? stack[stack.length - 1] : null });
    } else if (text && nodes.get(rawId).name === rawId) {
      const existing = nodes.get(rawId);
      nodes.set(rawId, { name: text, shape, kind: existing.kind, parent: existing.parent });
    }
  };
  const connect = (a, b, caption, kind, arrow) => {
    if (relations.length >= MAX_EDGES) reject("relationship limit exceeded (max 5,000)");
    relations.push([a, b, caption, kind, arrow]);
  };

  for (let idx = headerIndex + 1; idx < numbered.length; idx += 1) {
    const [number, text] = numbered[idx];
    if (text.startsWith("%%{")) {
      discarded.directives += 1;
      continue;
    }
    if (/^(click|href|link)\b/i.test(text)) {
      discarded.links += 1;
      continue;
    }
    if (/^(style|classDef|class|linkStyle)\b/i.test(text)) {
      discarded.styles += 1;
      continue;
    }
    if (text.startsWith("title ")) {
      const [t, count] = label(text.slice(6));
      title = t;
      discarded.urls += count;
      continue;
    }
    if (text.toLowerCase().startsWith("direction ")) {
      const spaceIdx = text.search(/\s/);
      const rest = spaceIdx === -1 ? "" : text.slice(spaceIdx).trim();
      directionHint = rest.toUpperCase();
      if (!["TD", "TB", "BT", "LR", "RL"].includes(directionHint)) reject(`invalid direction at line ${number}`);
      continue;
    }
    if (grammar === "flowchart") {
      if (text.toLowerCase() === "end") {
        if (!stack.length) reject(`unexpected subgraph end at line ${number}`);
        stack.pop();
        continue;
      }
      const sub = /^subgraph\s+([\w.-]+)(?:\s*\[([^\]]*)\])?$/i.exec(text);
      if (sub) {
        const gid = sub[1];
        const [gLabel, count] = label(sub[2] || gid);
        groups.set(gid, gLabel);
        discarded.urls += count;
        add(gid, gLabel, "container", "container");
        stack.push(gid);
        if (stack.length > MAX_DEPTH) reject("subgraph depth exceeds 64");
        continue;
      }
      const edge = /^([\w.-]+)(?:\[([^\]]*)\]|\{([^}]*)\}|\(([^)]*)\))?\s*(<-->|<--|-->|---|-.->|==>|->|--o|--x)\s*(?:\|([^|]*)\|\s*)?([\w.-]+)(?:\[([^\]]*)\]|\{([^}]*)\}|\(([^)]*)\))?$/.exec(text);
      if (edge) {
        const [, a, al, ad, ae, arrow, et, b, bl, bd, be] = edge;
        const [left, c1] = label(al || ad || ae || a);
        const [right, c2] = label(bl || bd || be || b);
        const [caption, c3] = label(et || "");
        discarded.urls += c1 + c2 + c3;
        add(a, left, ad ? "diamond" : ae ? "ellipse" : "rectangle");
        add(b, right, bd ? "diamond" : be ? "ellipse" : "rectangle");
        connect(a, b, caption, "flow", arrow === "<-->" ? "both" : arrow === "<--" ? "reverse" : arrow === "---" ? "none" : "forward");
        continue;
      }
      const node = /^([\w.-]+)(?:\[([^\]]*)\]|\{([^}]*)\}|\(([^)]*)\))?$/.exec(text);
      if (node) {
        const [, nid, rect, diamond, ellipse] = node;
        const [visible, count] = label(rect || diamond || ellipse || nid);
        discarded.urls += count;
        add(nid, visible, diamond ? "diamond" : ellipse ? "ellipse" : "rectangle");
        continue;
      }
      reject(`unsupported flowchart syntax at line ${number}`);
    }
    if (grammar === "sequence") {
      const participant = /^(?:participant|actor)\s+(?:"([^"]+)"\s+as\s+)?([\w.-]+)(?:\s+as\s+(?:"([^"]+)"|([\w.-]+)))?$/i.exec(text);
      if (participant) {
        const [, quoted, pid, quotedAlias, alias] = participant;
        const [name, count] = label(quotedAlias || alias || quoted || pid);
        discarded.urls += count;
        add(pid, name, "rectangle", "participant");
        continue;
      }
      const message = /^([\w.-]+)\s*(<<->>|<-->|->>|-->>|->|-->|-x|--x)(?:[+-])?\s*([\w.-]+)(?:\s*:\s*(.*))?$/.exec(text);
      if (message) {
        const [, a, arrow, b, rawLabel] = message;
        const [caption, count] = label(rawLabel || "");
        discarded.urls += count;
        add(a, "", "rectangle", "participant");
        add(b, "", "rectangle", "participant");
        connect(a, b, caption, "message", (arrow.includes("<<") || arrow === "<-->") ? "both" : "forward");
        continue;
      }
      reject(`unsupported sequence syntax at line ${number}`);
    }
    if (grammar === "state") {
      const alias = /^state\s+"([^"]+)"\s+as\s+([\w.-]+)$/i.exec(text);
      if (alias) {
        const [name, count] = label(alias[1]);
        discarded.urls += count;
        add(alias[2], name, "ellipse", "state");
        continue;
      }
      const transition = /^(\[\s*\*\s*\]|[\w.-]+)\s*(-->|-[.])\s*(\[\s*\*\s*\]|[\w.-]+)(?:\s*:\s*(.*))?$/.exec(text);
      if (transition) {
        let [, a, , b, rawLabel] = transition;
        a = a.includes("*") ? "initial" : a;
        b = b.includes("*") ? "final" : b;
        const [caption, count] = label(rawLabel || "");
        discarded.urls += count;
        add(a, a === "initial" ? "Initial" : a, "ellipse", "state");
        add(b, b === "final" ? "Final" : b, "ellipse", "state");
        connect(a, b, caption, "transition", "forward");
        continue;
      }
      if (/^[\w.-]+$/.test(text)) {
        add(text, text, "ellipse", "state");
        continue;
      }
      reject(`unsupported state syntax at line ${number}`);
    }
    if (grammar === "er") {
      if (text === "}") {
        entity = null;
        continue;
      }
      const declaration = /^([\w.-]+)\s*\{$/.exec(text);
      if (declaration) {
        entity = declaration[1];
        if (!fields.has(entity)) fields.set(entity, []);
        add(entity, entity, "rectangle", "entity");
        continue;
      }
      const relation = /^([\w.-]+)\s+([|}o{.]+--[|}o{.]+)\s+([\w.-]+)(?:\s*:\s*(.*))?$/.exec(text);
      if (relation) {
        const [, a, cardinality, b, rawLabel] = relation;
        const [caption, count] = label(rawLabel || "");
        discarded.urls += count;
        add(a, "", "rectangle", "entity");
        add(b, "", "rectangle", "entity");
        connect(a, b, caption ? `${cardinality}: ${caption}` : cardinality, "association", "forward");
        continue;
      }
      if (entity) {
        const field = /^[\w.-]+\s+([\w.-]+)(?:\s+\w+)?$/.exec(text);
        if (field) {
          fields.get(entity).push(field[1]);
          continue;
        }
      }
      reject(`unsupported ER syntax at line ${number}`);
    }
  }

  if (stack.length) reject("flowchart has an unterminated subgraph");
  if (entity) reject("ER diagram has an unterminated entity");
  if (nodes.size === 0) reject("diagram contains no supported nodes");

  const used = new Set();
  const ids = new Map();
  for (const rawId of nodes.keys()) ids.set(rawId, safeId(rawId, used));

  const outputNodes = [];
  for (const [rawId, value] of nodes) {
    let name = value.name;
    const nodeFields = fields.get(rawId);
    if (nodeFields && nodeFields.length) name += `\n${nodeFields.slice(0, 100).join("\n")}`;
    const item = { id: ids.get(rawId), label: name, kind: value.kind, shape: value.shape };
    if (value.parent !== null && ids.has(value.parent)) item.parentId = ids.get(value.parent);
    outputNodes.push(item);
  }

  const outputGroups = [];
  for (const [gid, gname] of groups) {
    const memberIds = [...nodes.entries()].filter(([, v]) => v.parent === gid).map(([nid]) => ids.get(nid));
    if (memberIds.length) outputGroups.push({ id: ids.get(gid), label: gname, nodeIds: memberIds });
  }

  const outputRelations = relations
    .filter(([a, b]) => ids.has(a) && ids.has(b))
    .map(([a, b, caption, kind, direction]) => ({ from: ids.get(a), to: ids.get(b), label: caption, kind, direction }));

  const warnings = ["Source layout and styling are omitted; labels are inert data."];
  if (directionHint) warnings.push(`Declared direction: ${directionHint}.`);

  return {
    schemaVersion: 1,
    sourceFormat: "mermaid",
    sourceDigest: sha256Hex(data),
    title: title || path.parse(filePath).name || "Imported diagram",
    suggestedType: grammar === "flowchart" && outputGroups.length ? "architecture" : grammar,
    nodes: outputNodes, relationships: outputRelations, groups: outputGroups,
    discarded, warnings,
  };
}

function parseArgs(args) {
  let file = null;
  let diagram = 0;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--diagram") {
      i += 1;
      const value = args[i];
      if (value === undefined || !/^-?\d+$/.test(value)) reject("--diagram requires an integer value");
      diagram = Number.parseInt(value, 10);
    } else if (!arg.startsWith("--") && file === null) {
      file = arg;
    } else {
      reject(`unknown argument: ${arg}`);
    }
  }
  if (!file) reject("usage: node scripts/mermaid-extract.mjs <file> [--diagram N]");
  return { file, diagram };
}

function main() {
  let file;
  let diagram;
  try {
    ({ file, diagram } = parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`mermaid_extract: ${error.message}\n`);
    return 2;
  }
  try {
    const result = extract(file, diagram);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof ImportFailure ? error.message : (error && error.message ? error.message : String(error));
    process.stderr.write(`mermaid_extract: ${message}\n`);
    return 2;
  }
}

process.exitCode = main();

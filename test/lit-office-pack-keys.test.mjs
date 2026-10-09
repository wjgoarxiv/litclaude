import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// A key in a tonality file that no code reads promises a look the output never gets. These tests
// read the engine source (no runtime needed) and fail on any key without a reader.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pptxRoot = join(root, "plugins", "litclaude", "skills", "lit-pptx");
const docxRoot = join(root, "plugins", "litclaude", "skills", "lit-docx");
const registry = createRequire(import.meta.url)(join(pptxRoot, "scripts", "lib", "template-registry.js"));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const has = (source, pattern) => new RegExp(pattern, "u").test(source);

// Keys no code reads, and why that is right for each.
const UNREAD_BY_DESIGN = {
  // The pitfalls a writer checks a deck against; the tonality sheet repeats them under "Avoid".
  deck: ["avoid"],
  // File metadata: the schema the file follows, the look's display name and its one-line summary.
  document: ["schema_version", "tonality", "summary"],
};

// Maps whose own keys are data (palette roles, slide roles, families, locales), checked as one key.
const DECK_VALUE_MAPS = new Set(["palette", "faces", "faces-a2z", "role-defaults", "structure"]);
const DOCUMENT_VALUE_MAPS = new Set(["design.numbering"]);

const flatten = (object, valueMaps, prefix = "") => Object.entries(object).flatMap(([key, value]) => {
  const path = prefix ? `${prefix}.${key}` : key;
  return value && typeof value === "object" && !Array.isArray(value) && !valueMaps.has(path) ? flatten(value, valueMaps, path) : [path];
});

/** Key paths of a document tonality file: block mappings plus the inline `{key: value}` maps it uses. */
function documentKeyPaths(text) {
  const paths = [];
  const stack = [];
  for (const line of text.split("\n")) {
    const m = /^( *)([\w-]+):[ \t]*(.*)$/u.exec(line);
    if (!m) continue;
    const [, indent, key, rest] = m;
    while (stack.length && stack[stack.length - 1].indent >= indent.length) stack.pop();
    const base = [...stack.map((s) => s.key), key];
    if (!rest || rest.startsWith("#")) {
      stack.push({ indent: indent.length, key });
    } else if (!rest.startsWith("{")) {
      paths.push(base.join("."));
    } else {
      const inner = [];
      for (const [, name, open, close] of rest.slice(1).matchAll(/([\w-]+):\s*(\{)?|(\})/gu)) {
        if (close) inner.pop();
        else if (open) inner.push(name);
        else paths.push([...base, ...inner, name].join("."));
      }
    }
  }
  return paths;
}

const withoutJsComments = (source) => source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "").replace(/\s\/\/\s.*$/gmu, "");

/** The deck engine as it runs: pack validation only checks a key's shape, so it does not count as a reader. */
function deckEngineSource() {
  const lib = join(pptxRoot, "scripts", "lib");
  const files = ["template-registry.js", "grid-resolver.js", "layout-resolver.js", "render-pack.js", "render-adapter-pptx.js"].map((f) => join(lib, f));
  return withoutJsComments([...files, join(pptxRoot, "scripts", "compile-deck.js")].map((f) => readFileSync(f, "utf8")).join("\n"))
    .replace(/function validatePack\([\s\S]*?\n\}\n/u, "");
}

function deckKeyIsRead(source, path) {
  const prop = (key) => `(?:\\.${esc(key)}\\b|\\[\\s*"${esc(key)}"\\s*\\])`;
  const aliases = [...source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:\w+\.)?loadPack\(/gu)].map((m) => m[1]);
  const owner = `\\b(?:\\w+\\.)?(?:${["pack", ...new Set(aliases)].join("|")})`;
  const [group, leaf] = path.split(".");
  if (!leaf) return has(source, `${owner}${prop(group)}`) || has(source, `${owner}\\[[^\\]\\n]*"${esc(group)}"`);
  const groupExpr = `${owner}${prop(group)}`;
  if (has(source, `${groupExpr}${prop(leaf)}`) || has(source, `\\(${groupExpr}\\s*\\|\\|\\s*\\{\\}\\)${prop(leaf)}`)) return true;
  const bound = [...source.matchAll(new RegExp(`(?:const|let)\\s+(\\w+)\\s*=\\s*${groupExpr}(?:\\s*\\|\\|\\s*\\{\\})?\\s*;`, "gu"))].map((m) => m[1]);
  return bound.some((name) => has(source, `\\b${name}${prop(leaf)}`));
}

/** The document engine: the converter, the page checks and the gate. The allowed-key sets only list names. */
function documentEngineSource() {
  const scripts = join(docxRoot, "scripts");
  return ["docx_design.py", "convert_md_to_docx.py", "docx_layout.py", "qa_docx.py"]
    .map((f) => readFileSync(join(scripts, f), "utf8")).join("\n")
    .replace(/^\s*#.*$/gmu, "")
    .replace(/^(?:PACK_KEYS|DESIGN_KEYS) = \{[^}]*\}/gmu, "");
}

function documentKeyIsRead(source, path) {
  const [top, ...rest] = path.split(".");
  const read = (key) => `(?:\\.get\\([^)\\n]*"${esc(key)}"|\\[\\s*"${esc(key)}"\\s*\\])`;
  return has(source, `\\bpack${read(top)}`) && rest.every((key) => has(source, read(key)));
}

describe("lit-pptx and lit-docx — every tonality key has a reader", () => {
  it("each key a deck tonality pack sets is read by the engine, or listed with its reason", () => {
    const source = deckEngineSource();
    const unread = new Map();
    for (const id of registry.listTonalities()) {
      for (const path of flatten(registry.loadPack(id), DECK_VALUE_MAPS)) {
        if (UNREAD_BY_DESIGN.deck.includes(path) || deckKeyIsRead(source, path)) continue;
        unread.set(path, [unread.get(path), id].filter(Boolean).join(", "));
      }
    }
    assert.deepEqual(Object.fromEntries(unread), {}, "pack keys no engine code reads: wire each in or delete it and the sentences that promise it");
  });

  it("each key a document tonality file sets is read by the engine, or listed with its reason", () => {
    const source = documentEngineSource();
    const dir = join(docxRoot, "templates", "tonalities");
    const unread = new Map();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
      for (const path of documentKeyPaths(readFileSync(join(dir, file), "utf8"))) {
        const key = [...DOCUMENT_VALUE_MAPS].find((map) => path.startsWith(`${map}.`)) || path;
        if (UNREAD_BY_DESIGN.document.includes(key) || documentKeyIsRead(source, key)) continue;
        unread.set(key, [...new Set([unread.get(key), file].filter(Boolean).join(", ").split(", "))].join(", "));
      }
    }
    assert.deepEqual(Object.fromEntries(unread), {}, "tonality keys no engine code reads: wire each in or delete it and the sentences that promise it");
  });

  it("no tonality sheet promises a setting the files no longer carry", () => {
    for (const [dir, promise] of [[join(pptxRoot, "references", "tonalities"), /annotation|tabular figures|crop allowed/u],
      [join(docxRoot, "references", "tonalities"), /median target/u]]) {
      for (const file of readdirSync(dir)) assert.doesNotMatch(readFileSync(join(dir, file), "utf8"), promise, file);
    }
  });

  it("the key readers tell a read key from an unread one", () => {
    const deck = 'const t = S.pack.table || {};\nuse(t.rules, (S.pack.display || {}).cover, pack["fill-order"], S.pack.image && S.pack.image.frame);\n';
    for (const path of ["table.rules", "display.cover", "fill-order", "image.frame"]) assert.equal(deckKeyIsRead(deck, path), true, path);
    for (const path of ["table.style", "display.number", "image.crop", "avoid"]) assert.equal(deckKeyIsRead(deck, path), false, path);
    const doc = 'design = pack.get("design") or {}\nratio = (design.get("figure_style") or {}).get("max_height_ratio", 0.45)\n' +
      'font = pack.get("docx").get("font", {})\nbody = font.get("body_pt_en" if en else "body_pt_ko", 10.5)\n';
    assert.equal(documentKeyIsRead(doc, "design.figure_style.max_height_ratio"), true);
    assert.equal(documentKeyIsRead(doc, "docx.font.body_pt_ko"), true);
    assert.equal(documentKeyIsRead(doc, "design.fill.min_page_fill"), false);
    assert.deepEqual(documentKeyPaths("dials: {density: 9}\ndesign:\n  components:\n    allowed: [callout]\n    sidebar: {default_width: third, float: right}\n"),
      ["dials.density", "design.components.allowed", "design.components.sidebar.default_width", "design.components.sidebar.float"]);
  });
});

describe("lit-pptx deck output checks — every limit has a reader", () => {
  it("each OUTPUT limit in craft_extras.py is read by a check", () => {
    const source = readFileSync(join(pptxRoot, "scripts", "craft_extras.py"), "utf8");
    const block = /^OUTPUT = \{([\s\S]*?)^\}/mu.exec(source);
    assert.ok(block, "craft_extras.py defines OUTPUT");
    const rest = source.slice(0, block.index) + source.slice(block.index + block[0].length);
    const unread = [...block[1].matchAll(/"(\w+)":/gu)].map((m) => m[1]).filter((key) => !has(rest, `OUTPUT\\[\\s*"${key}"\\s*\\]`));
    assert.deepEqual(unread, [], "OUTPUT limits no check reads");
  });
});

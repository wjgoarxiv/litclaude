import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// A key in a tonality file that no code reads promises a look the output never gets. These tests
// read the engine source (no runtime needed) and fail on any key without a reader.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docxRoot = join(root, "plugins", "litclaude", "skills", "lit-docx");

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const has = (source, pattern) => new RegExp(pattern, "u").test(source);

// Keys no code reads, and why that is right for each. (The deck half of this check moved with lit-pptx to the
// decks extras plugin.)
const UNREAD_BY_DESIGN = {
  // File metadata: the schema the file follows, the look's display name and its one-line summary.
  document: ["schema_version", "tonality", "summary"],
};

// Maps whose own keys are data, checked as one key.
const DOCUMENT_VALUE_MAPS = new Set(["design.numbering"]);

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

describe("lit-docx — every tonality key has a reader", () => {
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
    for (const [dir, promise] of [[join(docxRoot, "references", "tonalities"), /median target/u]]) {
      for (const file of readdirSync(dir)) assert.doesNotMatch(readFileSync(join(dir, file), "utf8"), promise, file);
    }
  });

  it("the key readers tell a read key from an unread one", () => {
    const doc = 'design = pack.get("design") or {}\nratio = (design.get("figure_style") or {}).get("max_height_ratio", 0.45)\n' +
      'font = pack.get("docx").get("font", {})\nbody = font.get("body_pt_en" if en else "body_pt_ko", 10.5)\n';
    assert.equal(documentKeyIsRead(doc, "design.figure_style.max_height_ratio"), true);
    assert.equal(documentKeyIsRead(doc, "docx.font.body_pt_ko"), true);
    assert.equal(documentKeyIsRead(doc, "design.fill.min_page_fill"), false);
    assert.deepEqual(documentKeyPaths("dials: {density: 9}\ndesign:\n  components:\n    allowed: [callout]\n    sidebar: {default_width: third, float: right}\n"),
      ["dials.density", "design.components.allowed", "design.components.sidebar.default_width", "design.components.sidebar.float"]);
  });
});

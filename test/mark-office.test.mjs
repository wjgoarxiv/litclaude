import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { generatorString } from "../plugins/litclaude/lib/mark.mjs";
import { nodeStatus, pythonStatus } from "../plugins/litclaude/lib/office-runtime.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pluginRoot = join(root, "plugins", "litclaude");
const libDir = join(pluginRoot, "lib");
const docxScript = join(pluginRoot, "skills", "lit-docx", "scripts", "convert_md_to_docx.py");
const deckScript = join(pluginRoot, "skills", "lit-pptx", "scripts", "compile-deck.js");
const fixtures = join(root, "test", "fixtures", "lit-office");
const GEN = generatorString();
const CUSTOM_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties";

const runtimeReady = nodeStatus().ready && pythonStatus().ready;
const work = () => mkdtempSync(join(tmpdir(), "litclaude-mark-office-"));
const envFor = (dir, mode) => ({ ...process.env, LITCLAUDE_HOME: join(dir, "lit-home"), LITCLAUDE_MARK: mode, PYTHONDONTWRITEBYTECODE: "1" });
const part = (file, name) => {
  // unzip reads [...] in a member name as a wildcard class, so the brackets of [Content_Types].xml are escaped.
  const r = spawnSync("unzip", ["-p", file, name.replace(/[[\]]/gu, "\\$&")], { encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
};
const parts = (file) => spawnSync("unzip", ["-Z1", file], { encoding: "utf8" }).stdout.trim().split("\n");

const assertTagged = (file, label) => {
  const app = part(file, "docProps/app.xml");
  assert.ok(app?.includes(`<Application>${GEN}</Application>`), `${label}: app.xml Application`);
  const custom = part(file, "docProps/custom.xml");
  assert.ok(custom, `${label}: custom.xml present`);
  assert.match(custom, new RegExp(`<property [^>]*name="Generator"[^>]*><vt:lpwstr>${GEN.replace(/[.]/gu, "\\.")}</vt:lpwstr></property>`, "u"), `${label}: Generator property`);
  assert.equal((custom.match(/name="Generator"/gu) ?? []).length, 1, `${label}: one Generator`);
  assert.match(part(file, "[Content_Types].xml"), /PartName="\/docProps\/custom\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.custom-properties\+xml"/u, `${label}: content type`);
  assert.ok(part(file, "_rels/.rels").includes(`Type="${CUSTOM_REL}" Target="docProps/custom.xml"`), `${label}: package relationship`);
};
const assertUntagged = (file, label) => {
  for (const name of parts(file).filter((n) => n.startsWith("docProps/") || n.endsWith(".rels") || n === "[Content_Types].xml")) {
    assert.ok(!part(file, name).includes("LitClaude"), `${label}: ${name} carries no generator`);
  }
};

describe("invisible generator tag in office outputs", { skip: runtimeReady ? false : "office runtime not installed; run node plugins/litclaude/lib/office-runtime.mjs ensure" }, () => {
  const docx = (dir, mode, source, extra = []) => spawnSync("python3", [docxScript, join(fixtures, source), join(dir, `${mode}.docx`), ...extra], { cwd: dir, encoding: "utf8", env: envFor(dir, mode) });
  const deck = (dir, mode, extra = []) => spawnSync(process.execPath, [deckScript, join(fixtures, "deck-azure.md"), "--template", "AZURE-PRO", "--pptx", join(dir, `${mode}.pptx`), ...extra], { cwd: dir, encoding: "utf8", env: envFor(dir, mode) });

  for (const [label, source, extra] of [["docx plain", "report-data.md", []], ["docx publisher", "report-ko.md", ["--publisher", "korean-generic"]]]) {
    it(`${label}: tagged in on and meta, untouched in off`, () => {
      const dir = work();
      try {
        for (const mode of ["on", "meta", "off"]) {
          const r = docx(dir, mode, source, extra);
          assert.equal(r.status, 0, r.stderr);
          (mode === "off" ? assertUntagged : assertTagged)(join(dir, `${mode}.docx`), `${label} ${mode}`);
        }
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }

  for (const [label, extra] of [["pptx template", []], ["pptx tonality pack", ["--tonality", "ledger"]], ["pptx with embedded fonts", ["--embed-fonts"]]]) {
    it(`${label}: tagged in on and meta, untouched in off`, () => {
      const dir = work();
      try {
        for (const mode of ["on", "meta", "off"]) {
          const r = deck(dir, mode, extra);
          assert.equal(r.status, 0, r.stderr);
          (mode === "off" ? assertUntagged : assertTagged)(join(dir, `${mode}.pptx`), `${label} ${mode}`);
        }
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }

  it("the soffice PDF render_pages.py writes names the generator in on and meta, not in off", { skip: spawnSync("soffice", ["--version"]).status === 0 ? false : "soffice not on PATH" }, () => {
    const dir = work();
    try {
      for (const mode of ["on", "meta", "off"]) {
        assert.equal(docx(dir, mode, "report-data.md").status, 0);
        const r = spawnSync("python3", [join(libDir, "render_pages.py"), join(dir, `${mode}.docx`), "--out-dir", join(dir, `pages-${mode}`), "--pages", "1"], { encoding: "utf8", env: envFor(dir, mode), timeout: 300_000 });
        assert.equal(r.status, 0, r.stdout + r.stderr);
        const meta = spawnSync(pythonStatus().interpreter, ["-B", "-c", "import json, sys, pymupdf; m = pymupdf.open(sys.argv[1]).metadata; print(json.dumps([m.get('creator'), m.get('producer')]))", join(dir, `pages-${mode}`, `${mode}.pdf`)], { encoding: "utf8" });
        assert.equal(meta.status, 0, meta.stderr);
        const [creator, producer] = JSON.parse(meta.stdout);
        if (mode === "off") assert.ok(!String(creator).includes("LitClaude") && !String(producer).includes("LitClaude"), `off: ${creator} / ${producer}`);
        else assert.deepEqual([creator, producer], [GEN, GEN], mode);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("a tagged docx keeps every other part byte for byte", () => {
    const dir = work();
    try {
      for (const mode of ["meta", "off"]) assert.equal(docx(dir, mode, "report-data.md").status, 0);
      const touched = new Set(["docProps/app.xml", "docProps/custom.xml", "docProps/core.xml", "[Content_Types].xml", "_rels/.rels"]);
      const off = parts(join(dir, "off.docx")).filter((n) => !touched.has(n));
      assert.deepEqual(parts(join(dir, "meta.docx")).filter((n) => !touched.has(n)).sort(), [...off].sort());
      for (const name of off) assert.equal(part(join(dir, "meta.docx"), name), part(join(dir, "off.docx"), name), name);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("generator tag in lit-docx PDF builds", () => {
  const latex = (tex, mode) => spawnSync("python3", ["-I", "-B", "-c", "import sys; sys.path.insert(0, sys.argv[1]); import output_mark; sys.stdout.write(output_mark.tag_latex(sys.stdin.read(), output_mark.meta_generator()))", libDir], {
    input: tex, encoding: "utf8", env: { ...process.env, LITCLAUDE_HOME: join(tmpdir(), "litclaude-mark-none"), LITCLAUDE_MARK: mode },
  });
  const tex = "\\documentclass{article}\n\\usepackage{hyperref}\n\\begin{document}\nBody\n\\end{document}\n";
  const hex = `FEFF${Buffer.from(GEN, "utf16le").swap16().toString("hex").toUpperCase()}`;

  it("adds one pdf:docinfo special right after \\begin{document} in on and meta", () => {
    for (const mode of ["on", "meta"]) {
      const r = latex(tex, mode);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, tex.replace("\\begin{document}\n", `\\begin{document}\n\\special{pdf:docinfo<</Creator<${hex}>/Producer<${hex}>>>}%\n`));
    }
  });

  it("leaves the LaTeX source unchanged in off and when there is no \\begin{document}", () => {
    assert.equal(latex(tex, "off").stdout, tex);
    assert.equal(latex("no document here\n", "on").stdout, "no document here\n");
  });

  it("is wired into the PDF build", () => {
    const source = readFileSync(join(pluginRoot, "skills", "lit-docx", "scripts", "convert_md_to_pdf.py"), "utf8");
    assert.match(source, /output_mark\.tag_latex\(/u);
  });
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const testDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(testDir, "..");
const scriptsDir = join(root, "plugins", "litclaude", "skills", "lit-diagram-drawer", "scripts");
const drawioScript = join(scriptsDir, "drawio-extract.mjs");
const mermaidScript = join(scriptsDir, "mermaid-extract.mjs");
const excalidrawScript = join(scriptsDir, "excalidraw-extract.mjs");

const canonicalDir = resolve(testDir, "..", "..", "..", "plans", "lit-diagram-canonical");
const canonicalScripts = join(canonicalDir, "scripts");

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
function pngChunk(kind, data) {
  const body = Buffer.concat([Buffer.from(kind), data]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}

function runNode(scriptPath, args) {
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8" });
}
function runPython(scriptName, args) {
  return spawnSync("python3", [join(canonicalScripts, scriptName), ...args], { encoding: "utf8" });
}

function drawioXml(name = "sample") {
  return (
    '<mxfile><diagram name="' + name + '"><mxGraphModel><root>' +
    '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="src" value="Source &amp; input" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="2" y="4" width="30" height="20" as="geometry"/></mxCell>' +
    '<mxCell id="dst" value="Store" style="shape=cylinder;" vertex="1" parent="1"><mxGeometry x="80" y="4" width="30" height="20" as="geometry"/></mxCell>' +
    '<mxCell id="edge" value="HTTPS" edge="1" parent="1" source="src" target="dst" style="endArrow=block;"/>' +
    '</root></mxGraphModel></diagram></mxfile>'
  );
}

let base;

before(() => {
  base = mkdtempSync(join(tmpdir(), "lit-diagram-import-"));

  const xml = drawioXml();
  writeFileSync(join(base, "raw.drawio"), xml);

  const model = xml.slice(xml.indexOf("<mxGraphModel>"), xml.indexOf("</mxGraphModel>") + "</mxGraphModel>".length);
  const packed = zlib.deflateRawSync(Buffer.from(encodeURIComponent(model), "utf8"));
  writeFileSync(
    join(base, "compressed.drawio"),
    '<mxfile><diagram name="packed">' + packed.toString("base64") + "</diagram></mxfile>",
  );

  const escaped = xml.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  writeFileSync(join(base, "embedded.drawio.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><metadata content="' + escaped + '"/></svg>');

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);
  const textChunk = Buffer.concat([Buffer.from("mxfile\x00"), Buffer.from(xml, "utf8")]);
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pngBytes = Buffer.concat([pngMagic, pngChunk("IHDR", ihdr), pngChunk("tEXt", textChunk), pngChunk("IEND", Buffer.alloc(0))]);
  writeFileSync(join(base, "embedded.drawio.png"), pngBytes);

  const corrupt = Buffer.from(pngBytes);
  const textCrcOffset = 8 + 25 + 8 + textChunk.length;
  corrupt[textCrcOffset] ^= 1;
  writeFileSync(join(base, "bad.drawio.png"), corrupt);

  writeFileSync(join(base, "plain.png"), Buffer.concat([pngMagic, pngChunk("IHDR", ihdr), pngChunk("IEND", Buffer.alloc(0))]));

  writeFileSync(join(base, "good.mmd"), "flowchart LR\nA[Input] -->|valid| B{Policy}\nB -->|yes| C[Store]\n");
  writeFileSync(join(base, "bad.mmd"), "flowchart LR\nA[<script>alert(1)</script>] --> B[Store]\n");
  writeFileSync(join(base, "unsupported.mmd"), 'pie\ntitle A\n"A" : 1\n');

  writeFileSync(join(base, "scene.excalidraw"), JSON.stringify({
    type: "excalidraw",
    elements: [
      { id: "a", type: "rectangle", x: 0, y: 0, width: 80, height: 30, boundElements: [{ id: "label", type: "text" }] },
      { id: "label", type: "text", text: "Input", containerId: "a" },
      { id: "b", type: "ellipse", x: 120, y: 0, width: 80, height: 30 },
      { id: "arrow", type: "arrow", startBinding: { elementId: "a" }, endBinding: { elementId: "b" } },
    ],
  }));
  writeFileSync(join(base, "bad.excalidraw"), JSON.stringify({
    type: "excalidraw",
    elements: [{ id: "x", type: "text", text: "<script>" }],
  }));
});

after(() => {
  if (base) rmSync(base, { recursive: true, force: true });
});

describe("draw.io importer", () => {
  it("extracts relationships from raw XML", () => {
    const result = runNode(drawioScript, [join(base, "raw.drawio")]);
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.relationships.length, 1);
    assert.equal(json.sourceFormat, "drawio");
    assert.equal(json.schemaVersion, 1);
  });

  it("extracts a compressed page and keeps the page title", () => {
    const result = runNode(drawioScript, [join(base, "compressed.drawio")]);
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.title, "packed");
  });

  it("extracts nodes from embedded SVG metadata", () => {
    const result = runNode(drawioScript, [join(base, "embedded.drawio.svg")]);
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.nodes.length, 2);
  });

  it("extracts nodes from an embedded PNG tEXt chunk", () => {
    const result = runNode(drawioScript, [join(base, "embedded.drawio.png")]);
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.nodes.length, 2);
  });

  it("rejects a PNG with a corrupted metadata CRC", () => {
    const result = runNode(drawioScript, [join(base, "bad.drawio.png")]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^drawio_extract: /);
  });

  it("rejects a PNG without embedded mxfile metadata", () => {
    const result = runNode(drawioScript, [join(base, "plain.png")]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^drawio_extract: /);
  });
});

describe("Mermaid importer", () => {
  it("extracts two relationships from a good flowchart", () => {
    const result = runNode(mermaidScript, [join(base, "good.mmd")]);
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.relationships.length, 2);
    assert.equal(json.sourceFormat, "mermaid");
  });

  it("rejects a node label containing a script tag", () => {
    const result = runNode(mermaidScript, [join(base, "bad.mmd")]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^mermaid_extract: /);
  });

  it("rejects an unsupported pie diagram", () => {
    const result = runNode(mermaidScript, [join(base, "unsupported.mmd")]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^mermaid_extract: /);
  });
});

describe("Excalidraw importer", () => {
  it("extracts one relationship from a bound-text scene", () => {
    const result = runNode(excalidrawScript, [join(base, "scene.excalidraw")]);
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.relationships.length, 1);
    assert.equal(json.sourceFormat, "excalidraw");
  });

  it("rejects malicious text content", () => {
    const result = runNode(excalidrawScript, [join(base, "bad.excalidraw")]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^excalidraw_extract: /);
  });
});

describe("Python parity", () => {
  const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
  const havePython = python.status === 0;
  const haveCanonical = existsSync(canonicalScripts);

  it("draw.io: Node output deep-equals the canonical Python extractor", (t) => {
    if (!havePython) return t.skip("python3 is not available in this environment");
    if (!haveCanonical) return t.skip("plans/lit-diagram-canonical is not present in this checkout");
    for (const file of ["raw.drawio", "compressed.drawio", "embedded.drawio.svg", "embedded.drawio.png"]) {
      const nodeResult = runNode(drawioScript, [join(base, file)]);
      const pyResult = runPython("drawio_extract.py", [join(base, file)]);
      assert.equal(nodeResult.status, 0, `node rejected ${file}: ${nodeResult.stderr}`);
      assert.equal(pyResult.status, 0, `python rejected ${file}: ${pyResult.stderr}`);
      assert.deepEqual(JSON.parse(nodeResult.stdout), JSON.parse(pyResult.stdout), file);
    }
    return undefined;
  });

  it("mermaid: Node output deep-equals the canonical Python extractor", (t) => {
    if (!havePython) return t.skip("python3 is not available in this environment");
    if (!haveCanonical) return t.skip("plans/lit-diagram-canonical is not present in this checkout");
    for (const file of ["good.mmd"]) {
      const nodeResult = runNode(mermaidScript, [join(base, file)]);
      const pyResult = runPython("mermaid_extract.py", [join(base, file)]);
      assert.equal(nodeResult.status, 0, `node rejected ${file}: ${nodeResult.stderr}`);
      assert.equal(pyResult.status, 0, `python rejected ${file}: ${pyResult.stderr}`);
      assert.deepEqual(JSON.parse(nodeResult.stdout), JSON.parse(pyResult.stdout), file);
    }
    return undefined;
  });

  it("excalidraw: Node output deep-equals the canonical Python extractor", (t) => {
    if (!havePython) return t.skip("python3 is not available in this environment");
    if (!haveCanonical) return t.skip("plans/lit-diagram-canonical is not present in this checkout");
    for (const file of ["scene.excalidraw"]) {
      const nodeResult = runNode(excalidrawScript, [join(base, file)]);
      const pyResult = runPython("excalidraw_extract.py", [join(base, file)]);
      assert.equal(nodeResult.status, 0, `node rejected ${file}: ${nodeResult.stderr}`);
      assert.equal(pyResult.status, 0, `python rejected ${file}: ${pyResult.stderr}`);
      assert.deepEqual(JSON.parse(nodeResult.stdout), JSON.parse(pyResult.stdout), file);
    }
    return undefined;
  });
});

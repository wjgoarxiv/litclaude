import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(root, "plugins", "litclaude");
const originalRoot = join(pluginRoot, "vendor", "scientific-visualization");
const doctorPath = join(pluginRoot, "bin", "litclaude-scientific-visualization-doctor.js");
const approvedManifestHash = "5a01a2768a1b29d4820bdc895fb7cb75c329110fd711de8fd07bdeaa1e42b9ab";

const capablePython = [process.env.LITCLAUDE_PYTHON, "python3", "python", "python3.13", "/usr/bin/python3"]
  .filter(Boolean)
  .find((candidate) => {
    const result = spawnSync(candidate, ["-c", "import matplotlib; print(matplotlib.__version__)"], {
      encoding: "utf8",
      env: { ...process.env, MPLBACKEND: "Agg" },
    });
    return result.status === 0;
  });

const isolatedCapablePython = [
  process.env.LITCLAUDE_PYTHON,
  "python3",
  "python",
  "python3.14",
  "python3.13",
  "python3.12",
  "python3.11",
  "/usr/bin/python3",
].filter(Boolean).find((candidate) => {
  const result = spawnSync(candidate, ["-I", "-B", "-c", "import matplotlib"], {
    encoding: "utf8",
    env: { ...process.env, MPLBACKEND: "Agg", PYTHONDONTWRITEBYTECODE: "1" },
  });
  return result.status === 0;
});

describe("LitClaude scientific-visualization runtime", () => {
  it("reports missing Python capability as DEGRADED without installing anything", () => {
    const result = spawnSync(process.execPath, [doctorPath, "--json"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: "", LITCLAUDE_PYTHON: "/definitely/missing/python" },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "DEGRADED");
    assert.equal(report.payload, "PASS");
    assert.equal(report.autoInstall, false);
    assert.equal(report.required.matplotlib, false);
    assert.equal(report.required.packagedHelpers, false);
    assert.equal(report.required.packagedPalette, false);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /pip\s+install|conda\s+install|uv\s+add/iu);
  });

  it("verifies exact handoff/science hashes and rejects extras or tampering", () => {
    const fixture = mkdtempSync(join(tmpdir(), "litclaude-bundled-skills-doctor-"));
    const fixturePlugin = join(fixture, "litclaude");
    try {
      cpSync(join(pluginRoot, "vendor"), join(fixturePlugin, "vendor"), { recursive: true });

      const valid = spawnSync(process.execPath, [doctorPath, "--json", "--plugin-root", fixturePlugin], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, PATH: "", LITCLAUDE_PYTHON: "/definitely/missing/python" },
      });
      assert.equal(valid.status, 0, valid.stderr);
      const validReport = JSON.parse(valid.stdout);
      assert.equal(validReport.payload, "PASS");
      assert.equal(validReport.integrity.handoff.status, "PASS");
      assert.equal(validReport.integrity.scientificVisualization.status, "PASS");
      assert.equal(validReport.integrity.scientificVisualization.aggregate, approvedManifestHash);

      writeFileSync(join(fixturePlugin, "vendor", "scientific-visualization", "scripts", "rogue.pyc"), "rogue\n");
      const extra = spawnSync(process.execPath, [doctorPath, "--json", "--plugin-root", fixturePlugin], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, PATH: "", LITCLAUDE_PYTHON: "/definitely/missing/python" },
      });
      assert.equal(extra.status, 1, extra.stderr);
      assert.match(extra.stdout, /rogue\.pyc/u);
      rmSync(join(fixturePlugin, "vendor", "scientific-visualization", "scripts", "rogue.pyc"));

      writeFileSync(join(fixturePlugin, "vendor", "handoff", "SKILL.md"), "tampered\n");
      const tampered = spawnSync(process.execPath, [doctorPath, "--json", "--plugin-root", fixturePlugin], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, PATH: "", LITCLAUDE_PYTHON: "/definitely/missing/python" },
      });
      assert.equal(tampered.status, 1, tampered.stderr);
      const tamperedReport = JSON.parse(tampered.stdout);
      assert.equal(tamperedReport.integrity.handoff.status, "FAIL");
      assert.match(JSON.stringify(tamperedReport.integrity.handoff.hashMismatches), /SKILL\.md/u);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("actually imports matplotlib and packaged helpers with isolated Python", {
    skip: isolatedCapablePython ? false : "no isolated matplotlib-capable Python is available",
  }, () => {
    const result = spawnSync(process.execPath, [doctorPath, "--json"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, LITCLAUDE_PYTHON: isolatedCapablePython },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "PASS");
    assert.equal(report.required.matplotlib, true);
    assert.equal(report.required.packagedHelpers, true);
    assert.equal(report.required.packagedPalette, true);
    assert.match(report.python.isolation, /-I/u);
  });

  it("passes the unchanged source Python unit tests when matplotlib is available", {
    skip: capablePython ? false : "matplotlib-capable Python is optional and not installed by LitClaude",
  }, () => {
    const result = spawnSync(capablePython, ["-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"], {
      cwd: originalRoot,
      encoding: "utf8",
      env: { ...process.env, MPLBACKEND: "Agg", PYTHONDONTWRITEBYTECODE: "1" },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /OK/u);
  });

  it("exports a real scatter-only 600-DPI PNG and editable PDF from the packaged scripts", {
    skip: capablePython ? false : "matplotlib-capable Python is optional and not installed by LitClaude",
  }, () => {
    const outputDir = mkdtempSync(join(tmpdir(), "litclaude-sciviz-smoke-"));
    const script = `
import pathlib, struct, sys
source = pathlib.Path(sys.argv[1])
output = pathlib.Path(sys.argv[2])
sys.path.insert(0, str(source / "scripts"))
sys.path.insert(0, str(source / "assets"))
from style_presets import rcparams, plot_scatter_only
from figure_export import save_publication_figure
from color_palettes import OKABE_ITO_LIST
import matplotlib.pyplot as plt
assert len(OKABE_ITO_LIST) == 8
rcparams()
fig, ax = plt.subplots(layout="constrained")
plot_scatter_only(ax, [0, 1, 2], [1, 4, 2], color="#0072B2")
ax.set_xlabel("Time (s)")
ax.set_ylabel("Response (a.u.)")
assert len(ax.lines) == 0
assert len(ax.collections) == 1
paths = save_publication_figure(fig, output / "smoke", formats=["png", "pdf"], dpi=600)
assert {path.suffix for path in paths} == {".png", ".pdf"}
png = output / "smoke.png"
pdf = output / "smoke.pdf"
assert png.stat().st_size > 1000 and pdf.stat().st_size > 1000
assert pdf.read_bytes().startswith(b"%PDF")
data = png.read_bytes()
offset = 8
dpi = None
while offset + 12 <= len(data):
    length = struct.unpack(">I", data[offset:offset + 4])[0]
    kind = data[offset + 4:offset + 8]
    chunk = data[offset + 8:offset + 8 + length]
    if kind == b"pHYs":
        x_ppm, _, unit = struct.unpack(">IIB", chunk)
        if unit == 1:
            dpi = x_ppm * 0.0254
        break
    offset += 12 + length
assert dpi is not None and dpi > 500, dpi
print(f"FIGURE_EXPORT_PASS png={png.stat().st_size} pdf={pdf.stat().st_size} dpi={dpi:.1f}")
`;
    try {
      const result = spawnSync(capablePython, ["-B", "-c", script, originalRoot, outputDir], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, MPLBACKEND: "Agg", PYTHONDWRITEBYTECODE: "1" },
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /FIGURE_EXPORT_PASS/u);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

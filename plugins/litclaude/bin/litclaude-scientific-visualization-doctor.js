#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBundledSkillsIntegrity } from "../lib/bundled-skills-integrity.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const pluginRootIndex = args.indexOf("--plugin-root");
const defaultPluginRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pluginRoot = pluginRootIndex === -1 ? defaultPluginRoot : resolve(args[pluginRootIndex + 1] ?? "");
const sourceRoot = resolve(pluginRoot, "vendor", "scientific-visualization");
const integrity = verifyBundledSkillsIntegrity(pluginRoot);

const moduleNames = ["matplotlib", "numpy", "seaborn", "pandas", "scipy", "plotly", "kaleido", "MDAnalysis"];
const pythonProbe = `
import json, pathlib, sys
source_root = pathlib.Path(sys.argv[1]).resolve()
sys.path.insert(0, str(source_root / "scripts"))
sys.path.insert(0, str(source_root / "assets"))
modules = ${JSON.stringify(moduleNames)}
available = {}
errors = {}
for name in modules:
    try:
        __import__(name)
        available[name] = True
    except Exception as exc:
        available[name] = False
        errors[name] = f"{type(exc).__name__}: {exc}"
packaged_helpers = False
packaged_palette = False
helper_error = None
if available.get("matplotlib"):
    try:
        import style_presets
        import figure_export
        import color_palettes
        style_presets.rcparams()
        assert callable(style_presets.plot_scatter_only)
        assert callable(figure_export.save_publication_figure)
        assert callable(color_palettes.apply_palette)
        assert len(color_palettes.OKABE_ITO_LIST) == 8
        packaged_helpers = True
        packaged_palette = True
    except Exception as exc:
        helper_error = f"{type(exc).__name__}: {exc}"
print(json.dumps({
    "executable": sys.executable,
    "version": sys.version.split()[0],
    "modules": available,
    "moduleErrors": errors,
    "packagedHelpers": packaged_helpers,
    "packagedPalette": packaged_palette,
    "helperError": helper_error,
}))
`;

const unique = (values) => [...new Set(values.filter(Boolean))];
const candidates = process.env.LITCLAUDE_PYTHON
  ? [process.env.LITCLAUDE_PYTHON]
  : unique(["python3", "python", "python3.14", "python3.13", "python3.12", "python3.11", "/usr/bin/python3"]);

let fallbackProbe;
let readyProbe;
for (const candidate of candidates) {
  const result = spawnSync(candidate, ["-I", "-B", "-c", pythonProbe, sourceRoot], {
    encoding: "utf8",
    env: { ...process.env, MPLBACKEND: "Agg", PYTHONDONTWRITEBYTECODE: "1" },
    shell: false,
  });
  if (result.status !== 0) continue;
  try {
    const parsed = JSON.parse(result.stdout);
    fallbackProbe ??= parsed;
    if (parsed.modules.matplotlib && parsed.packagedHelpers && parsed.packagedPalette) {
      readyProbe = parsed;
      break;
    }
  } catch {
    // A malformed interpreter response is not a capability proof; try the next candidate.
  }
}

const probe = readyProbe ?? fallbackProbe;
const modules = Object.fromEntries(moduleNames.map((name) => [name, Boolean(probe?.modules?.[name])]));
const payload = integrity.status;
const runtimeReady = modules.matplotlib && Boolean(probe?.packagedHelpers) && Boolean(probe?.packagedPalette);
const status = payload === "FAIL" ? "FAIL" : runtimeReady ? "PASS" : "DEGRADED";
const report = {
  status,
  payload,
  pluginRoot,
  sourceRoot,
  integrity,
  python: probe
    ? { executable: probe.executable, version: probe.version, isolation: "-I -B", helperError: probe.helperError }
    : null,
  required: {
    python: Boolean(probe),
    matplotlib: modules.matplotlib,
    packagedHelpers: Boolean(probe?.packagedHelpers),
    packagedPalette: Boolean(probe?.packagedPalette),
  },
  optional: Object.fromEntries(moduleNames.filter((name) => name !== "matplotlib").map((name) => [name, modules[name]])),
  autoInstall: false,
  guidance: "Dependency installation is never automatic. Ask the user before changing a Python environment.",
};

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  if (payload === "PASS") {
    process.stdout.write("BUNDLED_SKILLS_INTEGRITY_PASS: handoff=4/4 scientific-visualization=16/16\n");
  } else {
    process.stderr.write(`BUNDLED_SKILLS_INTEGRITY_FAIL: ${JSON.stringify(integrity)}\n`);
  }

  if (status === "PASS") {
    process.stdout.write(
      `SCIENTIFIC_VISUALIZATION_RUNTIME_PASS: ${probe.executable} ${probe.version}; isolated matplotlib and packaged helper imports passed\n`,
    );
  } else if (status === "DEGRADED") {
    const reason = probe ? "matplotlib or packaged helpers unavailable" : "Python unavailable";
    process.stdout.write(`SCIENTIFIC_VISUALIZATION_DEGRADED: ${reason}; no dependency installation was attempted\n`);
  }

  const optionalStatus = Object.entries(report.optional)
    .map(([name, available]) => `${name}=${available ? "yes" : "no"}`)
    .join(" ");
  process.stdout.write(`SCIENTIFIC_VISUALIZATION_OPTIONAL: ${optionalStatus}\n`);
}

process.exit(status === "FAIL" ? 1 : 0);

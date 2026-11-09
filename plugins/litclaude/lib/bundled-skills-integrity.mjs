import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const handoffHashes = new Map([
  ["SKILL.md", "e5bbd253dfa5b5baa9739dfaebc458003daab43cb27c4a407423da1e7a31dec6"],
  ["evals/evals.json", "0a70f0d149e59641100c7dcf8b9f2f1c0ceae57b98518e165f08088f2c2484da"],
  ["examples/HANDOFF-example-generic-auth-refactor.md", "43c767e573ac8c8900832d2b7a92ee1e83fd2d3d794fe2c82ecef87e5737f2a3"],
  ["templates/HANDOFF.md", "2a795a06e7bb81a57e6675ae70ed26db0dbfdb792c01f0a60f96f02cbef49fbd"],
]);

const scientificVisualizationHashes = new Map([
  ["SKILL.md", "d6084a7e3adf283157820ea20dbe1b46fa22fa1be17b138ab1203be550f4ef68"],
  ["assets/color_palettes.py", "ffea28da930406ecb11bbeaebfc530dfac40b772827a7653f449cb3b0bb35309"],
  ["assets/nature.mplstyle", "6a7343788bf772b7e1bc813d094f7bafa97c1e5544586e7b76002ad8547229b6"],
  ["assets/presentation.mplstyle", "e3ee23f0470d7fb07a0be75cd1210e231becfc2f5267aa404e4186aa077a3339"],
  ["assets/publication.mplstyle", "18447af3bc47310d23fc27255413c23d8bbe3ff441463cc54fcecdfacd205bea"],
  ["evals/evals.json", "366dc61b6e042f08f28bf33f2534feea80219d771b84497ec7094b30263e935b"],
  ["references/color_palettes.md", "0298691c8de8379570488a7b7768663971bc20af1fb05d464c5438d43a21dcfa"],
  ["references/journal_requirements.md", "56fdde590a9d778547dbcb609b77d86f1f31865e803bcecca5d8c4c72b91b3c7"],
  ["references/matplotlib_examples.md", "c99cd4f83e2452773e9580e2fa0984e61433c7a9b57ca0d2562dc400dfe4f83d"],
  ["references/mdanalysis_martini_visualization.md", "abcb3c61f1c3984ba9014d9ae197b726d23c1df844dc90988ecc4d8f0e349bfe"],
  ["references/publication_guidelines.md", "d9f5d0f115872c4c190a11d83432d44635e38ef9f1740db471fcc70f4c91dd2c"],
  ["references/seaborn_for_publications.md", "2da2147ae8974b4b5d16096c1484b982d5d1e5f91113808ebfd12111a0a6597a"],
  ["scripts/figure_export.py", "b22c7708afaf2a1cfa4f821eb9230d4262f1d52948af7f0815855aa9d0960403"],
  ["scripts/style_presets.py", "e9d450bd4ab6b11303b02d5029177c8d49466cc597648d12de0ecdb7620f64c4"],
  ["tests/test_figure_export.py", "b18414369e6721ad93d417914114d71af006248675eb20bb1f4989c48ec9a58e"],
  ["tests/test_style_presets.py", "ff0e190196480848f1fea2398220038771f386ee7967a0ef122b0dfbca3aed46"],
]);

const scientificVisualizationAggregate = "5a01a2768a1b29d4820bdc895fb7cb75c329110fd711de8fd07bdeaa1e42b9ab";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const listFiles = (root) => {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  visit(root);
  return files.sort();
};

const verifyFileSet = (root, expectedHashes, aggregatePrefix, expectedAggregate) => {
  const expectedFiles = [...expectedHashes.keys()];
  const actualFiles = listFiles(root);
  const expectedSet = new Set(expectedFiles);
  const actualSet = new Set(actualFiles);
  const missing = expectedFiles.filter((path) => !actualSet.has(path));
  const extra = actualFiles.filter((path) => !expectedSet.has(path));
  const nonRegular = actualFiles.filter((path) => !lstatSync(join(root, path)).isFile());
  const hashMismatches = [];
  const actualHashes = new Map();

  for (const [path, expected] of expectedHashes) {
    if (!actualSet.has(path) || nonRegular.includes(path)) continue;
    const actual = sha256(readFileSync(join(root, path)));
    actualHashes.set(path, actual);
    if (actual !== expected) hashMismatches.push({ path, expected, actual });
  }

  const aggregate = missing.length === 0
    ? sha256(expectedFiles.map((path) => `${actualHashes.get(path)}  ${aggregatePrefix}/${path}\n`).join(""))
    : null;
  const aggregateMatches = expectedAggregate === undefined || aggregate === expectedAggregate;
  const status = missing.length === 0
    && extra.length === 0
    && nonRegular.length === 0
    && hashMismatches.length === 0
    && aggregateMatches
    ? "PASS"
    : "FAIL";

  return {
    status,
    root,
    expectedCount: expectedFiles.length,
    actualCount: actualFiles.length,
    missing,
    extra,
    nonRegular,
    hashMismatches,
    ...(expectedAggregate === undefined ? {} : { aggregate, expectedAggregate, aggregateMatches }),
  };
};

export const verifyBundledSkillsIntegrity = (pluginRoot) => {
  const handoff = verifyFileSet(join(pluginRoot, "vendor", "handoff"), handoffHashes, "handoff");
  const scientificVisualization = verifyFileSet(
    join(pluginRoot, "vendor", "scientific-visualization"),
    scientificVisualizationHashes,
    "scientific-visualization",
    scientificVisualizationAggregate,
  );
  return {
    status: handoff.status === "PASS" && scientificVisualization.status === "PASS" ? "PASS" : "FAIL",
    handoff,
    scientificVisualization,
  };
};

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const documentedPaths = [
  "plugins/litclaude/commands/deep-interview.md",
  "plugins/litclaude/skills/deep-interview/SKILL.md",
  "plugins/litclaude/skills/lit-loop/SKILL.md",
  "plugins/litclaude/skills/litwork/SKILL.md",
  "plugins/litclaude/skills/lit-plan/SKILL.md",
  "docs/migration.md",
];
const artifactPaths = [
  ".litclaude/deep-interview/{slug}-state.json",
  ".litclaude/deep-interview/{slug}-context.md",
  ".litclaude/deep-interview/{slug}-transcript.md",
  ".litclaude/deep-interview/{slug}-spec.md",
];
const bareRepositoryArtifactPath = /(?<!\.litclaude\/)deep-interview\//u;

test("documents project-local interview artifacts and excludes local state from the package", () => {
  const documents = documentedPaths.map((path) => [path, readFileSync(join(root, path), "utf8")]);
  const deepInterviewSkill = documents.find(([path]) => path.endsWith("skills/deep-interview/SKILL.md"))[1];

  for (const artifactPath of artifactPaths) {
    assert.match(
      deepInterviewSkill,
      new RegExp(artifactPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
      `deep-interview must document ${artifactPath}`,
    );
  }

  for (const [path, document] of documents) {
    assert.doesNotMatch(
      document,
      bareRepositoryArtifactPath,
      `${path} must not describe repository-root deep-interview artifacts`,
    );
  }

  const pack = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(pack.status, 0, pack.stderr);
  const [manifest] = JSON.parse(pack.stdout);
  const files = manifest.files.map(({ path }) => path);

  // Inspect only the local-state segment. Plugin source directories are not artifact paths.
  assert.equal(
    files.some((path) => path.split("/").includes(".litclaude")),
    false,
    "the packed payload must exclude every .litclaude state path",
  );
});

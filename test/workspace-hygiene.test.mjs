import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { README_SKILL_IMAGE_PATHS, findOffenders } from "../tools/check-pack-payload.mjs";

// Source-trace hygiene is owned by the single fail-closed guarded-token gate at
// tools/scan-legacy-tokens.mjs. Repo-visible and packed artifact assertions stay
// local to this test.

const root = fileURLToPath(new URL("..", import.meta.url));

test("workspace quarantines OMC local state outside package and git surfaces", () => {
  const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  assert.match(gitignore, /^\.omc\/$/m);
  assert.match(gitignore, /^\.litcodex\/$/m);
  assert.match(gitignore, /^\.litclaude\/$/m);
  assert.match(gitignore, /^\.\[o\]\[m\]\[o\]\/$/m);
  assert.match(gitignore, /^evidence\/$/m);
  assert.doesNotMatch(gitignore, /^test\/$|^test\/\*$/m);
  assert.match(gitignore, /^test\/evidence\/$/m);
  assert.match(gitignore, /^\\# REFERENCE\/$/m);
  assert.doesNotMatch(gitignore, /^\.\/test\/$/m);
  assert.doesNotMatch(gitignore, /^!node_modules\//m);
  assert.match(gitignore, /^__pycache__\/$/m);
  assert.match(gitignore, /^\*\.pyc$/m);
  assert.equal(packageJson.files.includes(".omc"), false);
  assert.equal(packageJson.files.includes(".litcodex"), false);
  assert.equal(packageJson.files.includes(".litclaude"), false);
  assert.equal(packageJson.files.includes("evidence"), false);
  assert.equal(packageJson.files.includes("# REFERENCE"), false);
  assert.equal(packageJson.files.includes(".claude-plugin"), false);

  const ignored = spawnSync("git", ["check-ignore", "# REFERENCE/private-input.md"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(ignored.status, 0, ignored.stderr);
  assert.match(ignored.stdout, /# REFERENCE\/private-input\.md/u);

  const trackedShim = spawnSync("git", ["ls-files", "node_modules/.bin/litclaude-ai"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(trackedShim.status, 0, trackedShim.stderr);
  assert.equal(
    trackedShim.stdout.trim(),
    "",
    "node_modules/.bin/litclaude-ai must not be tracked",
  );

  const humanizerWorkflowTest = spawnSync("git", ["check-ignore", "test/lit-humanizer-workflow.test.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(humanizerWorkflowTest.status, 1, humanizerWorkflowTest.stdout);

  const securityHardeningTest = spawnSync("git", ["check-ignore", "--no-index", "test/security-hardening.test.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(securityHardeningTest.status, 1, securityHardeningTest.stdout);

  const litgoalAutoloopTest = spawnSync("git", ["check-ignore", "--no-index", "test/litgoal-autoloop.test.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(litgoalAutoloopTest.status, 1, litgoalAutoloopTest.stdout);

  const unenrolledTest = spawnSync("git", ["check-ignore", "--no-index", "test/not-enrolled.test.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(unenrolledTest.status, 1, unenrolledTest.stdout);

  const generatedEvidence = spawnSync("git", ["check-ignore", "--no-index", "test/evidence/generated.json"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(generatedEvidence.status, 0, generatedEvidence.stderr);
  assert.match(generatedEvidence.stdout, /test\/evidence\/generated\.json/u);
});

test("npm pack dry-run includes runtime payload and excludes local state", () => {
  const githubReadmes = ["README.md", "README_ko-KR.md"].map((name) => readFileSync(join(root, name)));
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  // prepack swaps the npm README in and postpack must put the GitHub README back, byte for byte.
  ["README.md", "README_ko-KR.md"].forEach((name, index) => {
    assert.ok(readFileSync(join(root, name)).equals(githubReadmes[index]), `${name} must be restored after npm pack`);
  });

  assert.equal(result.status, 0, result.stderr);
  const [pack] = JSON.parse(result.stdout);
  const files = pack.files.map((file) => file.path);

  assert.equal(pack.version, "1.0.16");

  for (const required of [
    "bin/litclaude-ai.js",
    "bin/update-notifier.mjs",
    "bin/update-notifier-refresh.mjs",
    "docs/native-goal-surface.md",
    "scripts/postinstall.mjs",
    "plugins/litclaude/.claude-plugin/plugin.json",
    "plugins/litclaude/.mcp.json",
    "plugins/litclaude/.lsp.json",
    "plugins/litclaude/commands/lit-loop.md",
    "plugins/litclaude/commands/lit-plan.md",
    "plugins/litclaude/commands/start-work.md",
    "plugins/litclaude/commands/deep-interview.md",
    "plugins/litclaude/commands/review-work.md",
    "plugins/litclaude/commands/litgoal.md",
    "plugins/litclaude/commands/autoresearch.md",
    "plugins/litclaude/commands/autoconference.md",
    "plugins/litclaude/commands/wikify.md",
    "plugins/litclaude/bin/litclaude-hud.js",
    "plugins/litclaude/lib/litgoal/paths.mjs",
    "plugins/litclaude/lib/litgoal/state.mjs",
    "plugins/litclaude/lib/litgoal/ledger.mjs",
    "plugins/litclaude/lib/litgoal/cli.mjs",
    "plugins/litclaude/lib/start-work-cli.mjs",
    "plugins/litclaude/lib/start-work-lifecycle.mjs",
    "plugins/litclaude/lib/public-source-reader/reader.mjs",
    "plugins/litclaude/lib/public-source-reader/validator.mjs",
    "plugins/litclaude/lib/workflow-check.mjs",
    "plugins/litclaude/lib/canonical-frontend-corpus.mjs",
    "plugins/litclaude/lib/canonical-runtime-closures.mjs",
    "plugins/litclaude/lib/deliverable-hedge-guard.mjs",
    "plugins/litclaude/skills/deep-interview/SKILL.md",
    "plugins/litclaude/skills/review-work/SKILL.md",
    "plugins/litclaude/skills/litgoal/SKILL.md",
    "plugins/litclaude/skills/deep-interview/scripts/render_progress.py",
    "plugins/litclaude/skills/lit-loop/SKILL.md",
    "plugins/litclaude/skills/autoresearch/SKILL.md",
    "plugins/litclaude/skills/autoconference/SKILL.md",
    "plugins/litclaude/skills/wikify/SKILL.md",
    "plugins/litclaude/vendor/canonical-runtime-closures.json",
    "plugins/litclaude/agents/lit-planner.md",
    "README.md",
    "README_ko-KR.md",
    "LICENSE",
  ]) {
    assert.ok(files.includes(required), `package should include ${required}`);
  }

  const landingAssets = new Set([
    "docs/assets/cover.webp",
    "docs/assets/cover-motion.webp",
    "docs/assets/cover-motion-still.webp",
    "docs/assets/litclaude-wordmark.svg",
    "docs/assets/litclaude-clay-icon.png",
    "docs/assets/readme/badge-version.svg",
    "docs/assets/readme/badge-license.svg",
    "docs/assets/readme/ascii-readme.svg",
    "docs/assets/readme/lucide-book-open.svg",
    "docs/assets/readme/lucide-play.svg",
    "docs/assets/readme/lucide-shield-check.svg",
    "docs/assets/readme/ignition-film.mp4",
    "docs/assets/readme/ignition-poster.png",
    "docs/assets/readme/ignition-readme.gif",
    "docs/assets/readme/Lucide-LICENSE.txt",
    "docs/assets/readme/JetBrainsMono-OFL.txt",
    "docs/assets/litclaude-ignition-1600.webp",
    "docs/assets/litclaude-continuity-1600.webp",
    "docs/assets/litfamily-machines.png",
    ...README_SKILL_IMAGE_PATHS,
  ]);
  assert.equal(README_SKILL_IMAGE_PATHS.length, 36, "one skill-table snapshot per README row");
  for (const requiredLanding of landingAssets) {
    assert.ok(files.includes(requiredLanding), `package should include ${requiredLanding}`);
  }

  // The npm README sources become README.md and README_ko-KR.md inside the tarball.
  assert.equal(files.some((file) => /^README_npm/u.test(file)), false, "npm README sources must not ship as extra files");
  for (const name of ["README_npm.md", "README_npm_ko-KR.md"]) {
    const readme = readFileSync(join(root, name), "utf8");
    const cdnBase = `https://cdn.jsdelivr.net/npm/@litfamily/litclaude@${pack.version}/`;
    const references = [
      ...[...readme.matchAll(/\b(?:src|srcset|href)="([^"]+)"/gu)].map((match) => match[1]),
      ...[...readme.matchAll(/!?\[[^\]]*\]\(([^)\s]+)/gu)].map((match) => match[1]),
    ];
    const mediaReferences = [
      ...[...readme.matchAll(/\b(?:src|srcset)="([^"]+)"/gu)].map((match) => match[1]),
      ...[...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)/gu)].map((match) => match[1]),
    ];
    for (const reference of mediaReferences) {
      assert.ok(reference.startsWith(cdnBase), `npm README media must use its version-pinned jsDelivr URL: ${reference}`);
    }
    for (const reference of references) {
      if (reference.startsWith("#")) continue;
      assert.match(reference, /^https:\/\//u, `npm README reference must be absolute: ${reference}`);
      if (/\.(?:mp4|gif|png|webp)$/iu.test(new URL(reference).pathname)) {
        assert.ok(reference.startsWith(cdnBase), `npm README film/poster links must use jsDelivr: ${reference}`);
      }
      if (!reference.startsWith("https://cdn.jsdelivr.net/npm/@litfamily/litclaude@")) continue;
      assert.ok(reference.startsWith(cdnBase), `npm README CDN URL must pin ${pack.version}: ${reference}`);
      const packagePath = decodeURIComponent(new URL(reference).pathname.slice(`/npm/@litfamily/litclaude@${pack.version}/`.length));
      assert.ok(files.includes(packagePath), `npm README CDN URL must resolve to a packed file: ${packagePath}`);
    }
  }

  assert.equal(
    files.some((file) => /^docs\/assets\//u.test(file) && !landingAssets.has(file)),
    false,
    "package should exclude non-landing docs/assets",
  );

  for (const excludedPattern of [
    /^(?:cover\.png|generate_cover\.py|RELEASE_CHECKLIST\.md)$/u,
    /^\.omc\//u,
    /(^|\/)\.litclaude(?:\/|$)/u,
    /^evidence\//u,
    /^test\//u,
    /^plans\//u,
    /^# REFERENCE\//u,
    /^\.debug-journal\.md$/u,
    /^\.claude-plugin\//u,
    /npm-debug\.log/u,
  ]) {
    assert.equal(
      files.some((file) => excludedPattern.test(file) && !landingAssets.has(file)),
      false,
      `package should exclude ${excludedPattern}`,
    );
  }

  // Internal spec docs must NOT ship; public docs/*.md still ship.
  assert.equal(
    files.some((file) => /^docs\/spec\//u.test(file)),
    false,
    "internal docs/spec must not be packaged",
  );
});

test("pack guard excludes non-README artwork and release sources while allowing native icons", () => {
  const excluded = [
    "cover.png", "generate_cover.py", "RELEASE_CHECKLIST.md", "docs/assets/cover.svg",
    "docs/assets/readme/unreferenced-artwork.svg", "README_npm.md", "README_npm_ko-KR.md",
  ];
  assert.deepEqual(findOffenders(excluded).map(({ filePath }) => filePath), excluded);
  assert.deepEqual(findOffenders(["plugins/litclaude/assets/icon-512.png", "bin/litclaude-ai.js"]), []);
});

test("pack payload guard rejects nested product-local state under included trees", () => {
  const staging = mkdtempSync(join(tmpdir(), "litclaude-pack-state-"));
  const stateFiles = [
    "plugins/litclaude/skills/wikify/.litclaude/knowledge/claims.jsonl",
    "plugins/litclaude/skills/litgoal/.litclaude/litgoal/goals.json",
    "plugins/litclaude/vendor/example/.litclaude/teams/team.json",
  ];
  try {
    for (const file of stateFiles) {
      const absolute = join(staging, file);
      mkdirSync(join(absolute, ".."), { recursive: true });
      writeFileSync(absolute, "local state\n");
    }
    const files = readdirSync(staging, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(staging, join(entry.parentPath, entry.name)));
    const offenders = findOffenders(files);
    assert.deepEqual(offenders.map(({ filePath }) => filePath).sort(), stateFiles.sort());
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
});

test("uiux.package-assets", async () => {
  const catalog = await import(new URL("../plugins/litclaude/lib/canonical-skill-catalog.mjs", import.meta.url));
  const resources = catalog.canonicalSkillResourceFiles;

  assert.ok(
    Array.isArray(resources),
    "canonical skill catalog must own nested UI/UX and visual-QA resources, not only SKILL.md entrypoints",
  );
  assert.ok(resources.length > catalog.canonicalSkillFiles.length);

  const inventory = resources.join("\n");
  for (const pattern of [
    /^skills\/frontend-ui-ux\/data\/.+\.json$/mu,
    /^skills\/frontend-ui-ux\/schemas\/design-contract-v1alpha1\.schema\.json$/mu,
    /^skills\/frontend-ui-ux\/schemas\/design-contract-v1beta1\.schema\.json$/mu,
    /^skills\/frontend-ui-ux\/schemas\/design-contract-v1beta2\.schema\.json$/mu,
    /^skills\/frontend-ui-ux\/scripts\/import-design-intelligence\.mjs$/mu,
    /^skills\/frontend-ui-ux\/scripts\/query-design-intelligence\.mjs$/mu,
    /^skills\/frontend-ui-ux\/PROVENANCE\.json$/mu,
    /^skills\/frontend-ui-ux\/THIRD-PARTY-NOTICE\.txt$/mu,
    /^skills\/frontend-ui-ux\/LICENSE[^/]*$/mu,
    /^skills\/visual-qa\/schemas\/evidence-manifest-v1alpha1\.schema\.json$/mu,
    /^skills\/visual-qa\/schemas\/evidence-manifest-v1beta1\.schema\.json$/mu,
    /^skills\/visual-qa\/schemas\/design-contract-v1beta1\.schema\.json$/mu,
    /^skills\/visual-qa\/schemas\/design-contract-v1beta2\.schema\.json$/mu,
    /^skills\/visual-qa\/schemas\/review-receipt-v1alpha1\.schema\.json$/mu,
    /^skills\/visual-qa\/scripts\/cli\.mjs$/mu,
  ]) {
    assert.match(inventory, pattern, `canonical nested-resource inventory must include ${pattern}`);
  }

  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const [pack] = JSON.parse(result.stdout);
  const packedFiles = new Set(pack.files.map((file) => file.path));

  for (const relativePath of resources) {
    assert.equal(
      packedFiles.has(`plugins/litclaude/${relativePath}`),
      true,
      `package is missing canonical skill resource ${relativePath}`,
    );
  }
  assert.equal(
    resources.some((relativePath) => /(?:^|\/)(?:test|fixtures?)\//u.test(relativePath)),
    false,
    "canonical runtime inventory must not leak source tests or fixtures into the package",
  );
});

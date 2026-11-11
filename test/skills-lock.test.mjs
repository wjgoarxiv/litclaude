import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  LOCK_FILE,
  SKILLS_DIR,
  budgetViolations,
  buildLock,
  checkLock,
  measureSkills,
  readLock,
  renderLock,
  seedBudget,
  trackedFiles,
} from "../tools/gen-skills-lock.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const tool = join(root, "tools", "gen-skills-lock.mjs");

const git = (cwd, ...args) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
};

// A throwaway Git repository shaped like this one: plugins/litclaude/skills/<id>/... plus a lock.
function fixtureRepo(skills) {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-skills-lock-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "fixture@example.invalid");
  git(dir, "config", "user.name", "fixture");
  for (const [id, files] of Object.entries(skills)) {
    for (const [rel, body] of Object.entries(files)) write(dir, join(SKILLS_DIR, id, rel), body);
  }
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "fixture");
  return dir;
}

function write(dir, rel, body) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), body);
}

const runTool = (dir, ...args) =>
  spawnSync(process.execPath, [tool, "--root", dir, "--no-pack", ...args], { cwd: dir, encoding: "utf8" });

const twoSkills = () => ({
  alpha: { "SKILL.md": `---\nname: alpha\n---\n${"a".repeat(4000)}\n`, "references/one.md": "one\n" },
  beta: { "SKILL.md": `---\nname: beta\n---\n${"b".repeat(2500)}\n` },
});

describe("skills.lock.json", () => {
  it("is current (run npm run gen:skills-lock after a skill or pack change)", () => {
    const { drift, violations } = checkLock(root);
    assert.deepEqual(violations, [], `budget or pack violations:\n${violations.join("\n")}`);
    assert.deepEqual(drift, [], `skills.lock.json is stale (npm run gen:skills-lock): ${drift.join(", ")}`);
  });

  it("gives every shipped skill one budget and keeps each skill inside it", () => {
    const lock = readLock(join(root, LOCK_FILE));
    const measured = measureSkills(root);
    assert.deepEqual(Object.keys(lock.budgets).sort(), Object.keys(measured).sort());
    assert.deepEqual(budgetViolations(measured, lock.budgets), []);
  });

  it("carries the old hand-written SKILL.md floors unchanged", () => {
    const { budgets } = readLock(join(root, LOCK_FILE));
    assert.equal(budgets["lit-hijack"].minSkillBytes, 18_000);
    assert.equal(budgets["lit-brainstorm"].minSkillBytes, 18_000);
  });

  it("catches a placeholder, a trimmed folder and a bloated skill", () => {
    const budget = { minSkillBytes: 4000, maxSkillBytes: 6000, minFiles: 2, maxFiles: 3, maxBytes: 7000 };
    const skill = (bytes, files, total) => ({ skillMd: { bytes, sha256: "x" }, files, bytes: total, sha256: "y" });
    assert.deepEqual(budgetViolations({ s: skill(5000, 2, 5100) }, { s: budget }), []);
    assert.match(budgetViolations({ s: skill(61, 2, 5100) }, { s: budget }).join("\n"), /s: SKILL\.md 61 B is below its floor 4000 B/u);
    assert.match(budgetViolations({ s: skill(5000, 1, 5000) }, { s: budget }).join("\n"), /s: 1 files is below its floor 2/u);
    const bloated = budgetViolations({ s: skill(9000, 4, 9900) }, { s: budget }).join("\n");
    assert.match(bloated, /SKILL\.md 9000 B is above its ceiling 6000 B/u);
    assert.match(bloated, /4 files is above its ceiling 3/u);
    assert.match(bloated, /9900 B in the folder is above its ceiling 7000 B/u);
    assert.deepEqual(seedBudget(skill(4321, 3, 5678)), {
      minSkillBytes: 4300, maxSkillBytes: 7000, minFiles: 3, maxFiles: 5, maxBytes: 9000,
    });
  });
});

describe("gen-skills-lock", () => {
  it("keeps budgets as written, seeds or drops one only when named, and is deterministic", () => {
    const dir = fixtureRepo(twoSkills());
    try {
      assert.throws(() => buildLock({ root: dir, pack: [], previous: {}, drop: ["alpha"] }), /--drop alpha names no gone skill/u);
      const first = buildLock({ root: dir, pack: [], previous: {}, acceptNew: ["alpha", "beta"] });
      assert.deepEqual(Object.keys(first.budgets), ["alpha", "beta"]);
      assert.equal(first.skills.alpha.files, 2);
      assert.equal(renderLock(buildLock({ root: dir, pack: [], previous: first })), renderLock(first));
      assert.throws(() => buildLock({ root: dir, pack: [], previous: first, acceptNew: ["alpha"] }), /--accept-new alpha names no new skill/u);

      const handEdited = { ...first, budgets: { ...first.budgets, alpha: { ...first.budgets.alpha, minSkillBytes: 1234 } } };
      assert.equal(buildLock({ root: dir, pack: [], previous: handEdited }).budgets.alpha.minSkillBytes, 1234);

      write(dir, join(SKILLS_DIR, "alpha", "references", "one.md"), "one, edited\n");
      const edited = buildLock({ root: dir, pack: [], previous: first });
      assert.notEqual(edited.skills.alpha.sha256, first.skills.alpha.sha256, "a reference edit moves the skill hash");
      assert.equal(edited.skills.alpha.skillMd.sha256, first.skills.alpha.skillMd.sha256);

      git(dir, "rm", "-q", "-r", join(SKILLS_DIR, "beta"));
      const orphan = buildLock({ root: dir, pack: [], previous: first });
      assert.ok(orphan.budgets.beta, "a gone skill keeps its budget until --drop names it");
      assert.match(budgetViolations(orphan.skills, orphan.budgets).join("\n"), /beta: budget for a skill that is gone \(npm run gen:skills-lock -- --drop beta\)/u);
      assert.equal(buildLock({ root: dir, pack: [], previous: first, drop: ["beta"] }).budgets.beta, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses remove, regenerate, then re-add smaller without --drop and --accept-new", () => {
    const dir = fixtureRepo(twoSkills());
    try {
      assert.equal(runTool(dir, "--accept-new", "alpha", "--accept-new", "beta").status, 0);
      const lockPath = join(dir, LOCK_FILE);
      const original = readFileSync(lockPath, "utf8");

      git(dir, "rm", "-q", "-r", join(SKILLS_DIR, "alpha"));
      const removed = runTool(dir);
      assert.equal(removed.status, 1, removed.stdout);
      assert.match(removed.stdout, /alpha: budget for a skill that is gone/u);
      assert.equal(readFileSync(lockPath, "utf8"), original);

      write(dir, join(SKILLS_DIR, "alpha", "SKILL.md"), "---\nname: alpha\n---\nstub\n");
      git(dir, "add", ".");
      const smaller = runTool(dir);
      assert.equal(smaller.status, 1, smaller.stdout);
      assert.match(smaller.stdout, /alpha: SKILL\.md \d+ B is below its floor 4000 B/u);
      assert.equal(readFileSync(lockPath, "utf8"), original);

      const wrongFlag = runTool(dir, "--drop", "alpha");
      assert.equal(wrongFlag.status, 2);
      assert.match(wrongFlag.stderr, /--drop alpha names no gone skill/u);
      assert.equal(readFileSync(lockPath, "utf8"), original);

      git(dir, "rm", "-q", "-r", "-f", join(SKILLS_DIR, "alpha"));
      assert.equal(runTool(dir, "--drop", "alpha").status, 0);
      const dropped = readFileSync(lockPath, "utf8");
      write(dir, join(SKILLS_DIR, "alpha", "SKILL.md"), "---\nname: alpha\n---\nstub\n");
      git(dir, "add", ".");
      const unbudgeted = runTool(dir);
      assert.equal(unbudgeted.status, 1);
      assert.match(unbudgeted.stdout, /alpha: new skill without a budget \(npm run gen:skills-lock -- --accept-new alpha\)/u);
      assert.equal(readFileSync(lockPath, "utf8"), dropped);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("measures only Git-tracked files and refuses to pin an untracked file npm would pack", () => {
    const dir = fixtureRepo(twoSkills());
    try {
      const before = measureSkills(dir);
      write(dir, join(SKILLS_DIR, "alpha", ".DS_Store"), "finder");
      write(dir, join(SKILLS_DIR, "alpha", "references", "stray-note.md"), "local note\n");
      assert.deepEqual(measureSkills(dir), before);
      assert.ok(!trackedFiles(dir).includes(`${SKILLS_DIR}/alpha/references/stray-note.md`));

      const stray = `${SKILLS_DIR}/alpha/references/stray-note.md`;
      const tracked = trackedFiles(dir).filter((path) => path.startsWith(`${SKILLS_DIR}/`));
      const lock = buildLock({ root: dir, pack: tracked, previous: {}, acceptNew: ["alpha", "beta"] });
      const { violations } = checkLock(dir, { lock, pack: [...tracked, stray] });
      assert.deepEqual(violations, [`pack: ${stray} would ship, but Git does not track it`]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes nothing on a violation, --check never writes, and the scripts are wired", () => {
    const dir = fixtureRepo(twoSkills());
    try {
      assert.equal(runTool(dir, "--accept-new", "alpha", "--accept-new", "beta").status, 0);
      const lockPath = join(dir, LOCK_FILE);
      const original = readFileSync(lockPath, "utf8");
      assert.match(runTool(dir).stdout, /already current \(2 skills/u);

      write(dir, join(SKILLS_DIR, "beta", "SKILL.md"), `---\nname: beta\n---\n${"b".repeat(2600)}\n`);
      const stale = runTool(dir, "--check");
      assert.equal(stale.status, 1);
      assert.match(stale.stdout, /stale: skill beta/u);
      assert.equal(readFileSync(lockPath, "utf8"), original);
      assert.equal(runTool(dir, "--check", "--drop", "beta").status, 2, "--check takes no flags that change budgets");
      assert.equal(runTool(dir, "--bogus").status, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(pkg.scripts["gen:skills-lock"], "node tools/gen-skills-lock.mjs");
    assert.equal(pkg.scripts["check:skills-lock"], "node tools/gen-skills-lock.mjs --check");
    const lock = readLock(join(root, LOCK_FILE));
    assert.ok(!lock.pack.includes(LOCK_FILE), "the lock is not packed");
    assert.ok(!lock.pack.includes("tools/gen-skills-lock.mjs"), "the generator is not packed");
    assert.ok(existsSync(join(root, LOCK_FILE)));
  });
});

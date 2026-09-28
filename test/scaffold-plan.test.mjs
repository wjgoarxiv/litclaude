import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildDraft,
  buildPlanSkeleton,
  checkPlanStructure,
  FINAL_VERIFICATION_ITEMS,
  parseArgs,
  PLAN_SECTION_HEADERS,
  resolveSafePlanPath,
  scaffold,
  writeGuarded,
} from "../scripts/scaffold-plan.mjs";
import { readPlanProgress } from "../plugins/litclaude/lib/start-work-lifecycle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = join(root, "scripts", "scaffold-plan.mjs");
const scaffoldModule = pathToFileURL(scriptPath).href;

const temps = [];
const makeWorkspace = () => {
  const dir = mkdtempSync(join(tmpdir(), "litscaffold-"));
  temps.push(dir);
  return dir;
};
const run = (cwd, args) => spawnSync(process.execPath, [scriptPath, ...args], { cwd, encoding: "utf8" });
const runAsync = (cwd, args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [scriptPath, ...args], { cwd });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
});

const ctimeChurnPreload = (directory) => {
  const path = join(directory, "ctime-churn-preload.mjs");
  writeFileSync(path, `
import fs from "node:fs";
import promises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

const target = process.env.LITCLAUDE_CTIME_TARGET;
const realOpen = fs.openSync;
const realFstat = fs.fstatSync;
const realLstat = promises.lstat;
let targetFd;
let fstatCount = 0;
let churn = false;
const current = (stat) => {
  if (churn && stat) stat.ctimeMs = Number(stat.ctimeMs) + 1;
  return stat;
};
fs.openSync = function patchedOpen(pathValue, ...args) {
  const fd = realOpen.call(this, pathValue, ...args);
  if (String(pathValue) === target) targetFd = fd;
  return fd;
};
fs.fstatSync = function patchedFstat(fd, ...args) {
  const stat = realFstat.call(this, fd, ...args);
  if (fd !== targetFd) return stat;
  fstatCount += 1;
  if (fstatCount === 4) churn = true;
  return current(stat);
};
promises.lstat = async function patchedLstat(pathValue, ...args) {
  const stat = await realLstat.call(this, pathValue, ...args);
  return String(pathValue) === target ? current(stat) : stat;
};
syncBuiltinESMExports();
`);
  return path;
};

const lockRotationPreload = (directory) => {
  const path = join(directory, "lock-rotation-preload.mjs");
  writeFileSync(path, `
import promises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

const target = process.env.LITCLAUDE_LOCK_TARGET;
const realUnlink = promises.unlink;
let installed = false;
promises.unlink = async function patchedUnlink(pathValue, ...args) {
  const result = await realUnlink.call(this, pathValue, ...args);
  const source = String(pathValue);
  if (!installed && (source === target || source.startsWith(target + ".remove."))) {
    installed = true;
    await promises.writeFile(target, String(process.pid) + ":next-owner\\n", { mode: 0o600, flag: "wx" });
  }
  return result;
};
syncBuiltinESMExports();
`);
  return path;
};

afterEach(() => {
  while (temps.length) rmSync(temps.pop(), { recursive: true, force: true });
});

describe("scaffold-plan — arguments", () => {
  it("parses the documented flags", () => {
    const parsed = parseArgs(["node", "s", "my-slug", "--unclear", "--draft-only", "--review-required"]);
    assert.equal(parsed.mode, "scaffold");
    assert.equal(parsed.slug, "my-slug");
    assert.equal(parsed.intent, "unclear");
    assert.equal(parsed.draftOnly, true);
    assert.equal(parsed.reviewRequired, true);
  });

  it("parses --check", () => {
    assert.deepEqual(parseArgs(["node", "s", "--check", "plans/a.md"]), { mode: "check", checkPath: "plans/a.md" });
  });

  it("rejects a bad slug, an unknown flag, and a missing slug", () => {
    assert.throws(() => parseArgs(["node", "s", "Bad Slug"]), /invalid slug/u);
    assert.throws(() => parseArgs(["node", "s", "bad--slug"]), /invalid slug/u);
    assert.throws(() => parseArgs(["node", "s", "bad-"]), /invalid slug/u);
    assert.throws(() => parseArgs(["node", "s", "a".repeat(81)]), /invalid slug/u);
    assert.throws(() => parseArgs(["node", "s", "ok", "--nope"]), /unknown flag/u);
    assert.throws(() => parseArgs(["node", "s"]), /usage/u);
    assert.throws(() => parseArgs(["node", "s", "../escape"]), /invalid slug/u);
  });
});

describe("scaffold-plan — write boundary", () => {
  it("allows only .litclaude/ and plans/, and only .md", () => {
    const cwd = makeWorkspace();
    assert.doesNotThrow(() => resolveSafePlanPath(cwd, ".litclaude/drafts/a.md"));
    assert.doesNotThrow(() => resolveSafePlanPath(cwd, "plans/a.md"));
    assert.throws(() => resolveSafePlanPath(cwd, "src/a.md"), /may only write under/u);
    assert.throws(() => resolveSafePlanPath(cwd, "plans/a.txt"), /may only write \.md/u);
    assert.throws(() => resolveSafePlanPath(cwd, "../outside/a.md"), /escapes the workspace root/u);
    assert.throws(() => resolveSafePlanPath(cwd, "/etc/passwd.md"), /escapes the workspace root/u);
  });

  it("refuses a symlinked directory component", async () => {
    const cwd = makeWorkspace();
    const outside = makeWorkspace();
    mkdirSync(join(cwd, ".litclaude"), { recursive: true });
    symlinkSync(outside, join(cwd, ".litclaude", "drafts"), "dir");
    await assert.rejects(scaffold(cwd, { slug: "x", intent: "clear", draftOnly: true }), /symlink/u);
  });

  it("refuses a symlinked target file", async () => {
    const cwd = makeWorkspace();
    const outside = makeWorkspace();
    const decoy = join(outside, "decoy.md");
    writeFileSync(decoy, "outside");
    mkdirSync(join(cwd, ".litclaude", "drafts"), { recursive: true });
    symlinkSync(decoy, join(cwd, ".litclaude", "drafts", "x.md"));
    await assert.rejects(scaffold(cwd, { slug: "x", intent: "clear", draftOnly: true }), /symlink/u);
    assert.equal(readFileSync(decoy, "utf8"), "outside", "the symlink target must be untouched");
  });

  it("refuses a symlinked plans directory", async () => {
    const cwd = makeWorkspace();
    const outside = makeWorkspace();
    symlinkSync(outside, join(cwd, "plans"), "dir");
    await assert.rejects(scaffold(cwd, { slug: "x", intent: "clear" }), /symlink/u);
  });
});

describe("scaffold-plan — generation and resume safety", () => {
  it("creates the draft and the plan in the decided roots", async () => {
    const cwd = makeWorkspace();
    const results = await scaffold(cwd, { slug: "my-feature", intent: "clear" });
    assert.deepEqual(results.map((r) => r.status), ["created", "created"]);
    assert.match(readFileSync(join(cwd, ".litclaude", "drafts", "my-feature.md"), "utf8"), /# Draft: my-feature/u);
    assert.match(readFileSync(join(cwd, "plans", "my-feature.md"), "utf8"), /# my-feature — Work Plan/u);
  });

  it("--draft-only writes the draft and no plan", async () => {
    const cwd = makeWorkspace();
    const results = await scaffold(cwd, { slug: "x", intent: "clear", draftOnly: true });
    assert.equal(results.length, 1);
    assert.throws(() => readFileSync(join(cwd, "plans", "x.md"), "utf8"));
  });

  it("a plain re-run is a NO-OP that preserves appended todos", async () => {
    const cwd = makeWorkspace();
    await scaffold(cwd, { slug: "x", intent: "clear" });
    const planPath = join(cwd, "plans", "x.md");
    writeFileSync(planPath, `${readFileSync(planPath, "utf8")}\n- [ ] 2. my appended todo\n`);

    const second = await scaffold(cwd, { slug: "x", intent: "clear" });
    assert.deepEqual(second.map((r) => r.status), ["exists", "exists"]);
    assert.match(readFileSync(planPath, "utf8"), /my appended todo/u, "a re-run must never clobber appended work");
  });

  it("monotonically arms review on a later turn without overwriting draft edits", async () => {
    const cwd = makeWorkspace();
    await scaffold(cwd, { slug: "x", intent: "clear", draftOnly: true });
    const draftPath = join(cwd, ".litclaude", "drafts", "x.md");
    writeFileSync(draftPath, `${readFileSync(draftPath, "utf8")}\nUSER FINDING: preserve this exact text\n`);

    const armed = await scaffold(cwd, { slug: "x", intent: "clear", draftOnly: true, reviewRequired: true });
    const afterArm = readFileSync(draftPath, "utf8");
    assert.equal(armed[0].status, "updated");
    assert.match(afterArm, /^review_required: true$/mu);
    assert.match(afterArm, /litclaude:quality-reviewer/u);
    assert.match(afterArm, /litclaude:lit-verifier/u);
    assert.match(afterArm, /USER FINDING: preserve this exact text/u);

    await scaffold(cwd, { slug: "x", intent: "clear", draftOnly: true, reviewRequired: false });
    assert.equal(readFileSync(draftPath, "utf8"), afterArm, "review intent must never downgrade true to false");
  });

  it("--reset refuses to discard hand edits without --force", async () => {
    const cwd = makeWorkspace();
    await scaffold(cwd, { slug: "x", intent: "clear" });
    const planPath = join(cwd, "plans", "x.md");
    writeFileSync(planPath, `${readFileSync(planPath, "utf8")}\n- [ ] 2. hand edit\n`);

    await assert.rejects(scaffold(cwd, { slug: "x", intent: "clear", reset: true }), /--reset --force/u);
    assert.match(readFileSync(planPath, "utf8"), /hand edit/u);

    await scaffold(cwd, { slug: "x", intent: "clear", reset: true, force: true });
    assert.doesNotMatch(readFileSync(planPath, "utf8"), /hand edit/u, "--reset --force discards them");
  });

  it("refuses to overwrite a file it did not author", async () => {
    const cwd = makeWorkspace();
    mkdirSync(join(cwd, "plans"), { recursive: true });
    writeFileSync(join(cwd, "plans", "x.md"), "someone else's document");
    await assert.rejects(scaffold(cwd, { slug: "x", intent: "clear" }), /not a scaffold artifact/u);
  });

  it("cleans a newly created draft when the paired plan write fails", async () => {
    const cwd = makeWorkspace();
    mkdirSync(join(cwd, "plans"), { recursive: true });
    const planPath = join(cwd, "plans", "x.md");
    writeFileSync(planPath, "user-owned plan\n");

    let failure;
    try {
      await scaffold(cwd, { slug: "x", intent: "clear" });
    } catch (error) {
      failure = error;
    }
    assert.match(failure?.message ?? "", /not a scaffold artifact/u);
    assert.equal(existsSync(join(cwd, ".litclaude", "drafts", "x.md")), false);
    assert.equal(readFileSync(planPath, "utf8"), "user-owned plan\n");
    assert.equal(readdirSync(cwd, { recursive: true }).some((entry) => entry.endsWith(".tmp")), false);
    assert.ok(failure?.cleanupReceipt?.some((receipt) => receipt.status === "removed" && receipt.residue === false));
  });

  it("removes a newly created target when interruption arrives after commit", async () => {
    const cwd = makeWorkspace();
    mkdirSync(join(cwd, "plans"), { recursive: true });
    let checks = 0;
    const interruption = {
      throwIfInterrupted() {
        checks += 1;
        if (checks === 3) throw new Error("write interrupted by SIGTERM");
      },
    };

    let failure;
    try {
      await writeGuarded(cwd, "plans/interrupted.md", "new plan\n", { interruption });
    } catch (error) {
      failure = error;
    }
    assert.match(failure?.message ?? "", /write interrupted by SIGTERM/u);
    assert.equal(existsSync(join(cwd, "plans", "interrupted.md")), false);
    assert.ok(failure?.cleanupReceipt?.some((receipt) => receipt.status === "removed" && receipt.residue === false));
  });

  it("reports cleanup residue when a created target changes before rollback", async () => {
    const cwd = makeWorkspace();
    mkdirSync(join(cwd, "plans"), { recursive: true });
    let target;
    let failure;
    try {
      await writeGuarded(cwd, "plans/residue.md", "new plan\n", {
        onCreated(entry) {
          target = entry.target;
          writeFileSync(target, "user replacement\n");
          throw new Error("paired write failed after commit");
        },
      });
    } catch (error) {
      failure = error;
    }
    assert.match(failure?.message ?? "", /paired write failed after commit/u);
    assert.ok(failure?.cleanupReceipt?.some((receipt) => receipt.target === target && receipt.residue === true));
    assert.equal(readFileSync(target, "utf8"), "user replacement\n");
  });

  it("fails closed when the write parent changes before commit", async () => {
    const cwd = makeWorkspace();
    const plans = join(cwd, "plans");
    mkdirSync(plans, { recursive: true });
    let failure;
    try {
      await writeGuarded(cwd, "plans/parent-swap.md", "new plan\n", {
        beforeCommit() {
          renameSync(plans, join(cwd, "plans-moved"));
          mkdirSync(plans);
        },
      });
    } catch (error) {
      failure = error;
    }
    assert.match(failure?.message ?? "", /write parent changed|cleanup residue/u);
    assert.equal(existsSync(join(plans, "parent-swap.md")), false);
    assert.ok(failure?.cleanupReceipt?.some((receipt) => receipt.residue === true));
  });

  it("fails closed when an existing target changes before commit", async () => {
    const cwd = makeWorkspace();
    const target = join(cwd, "plans", "existing-race.md");
    mkdirSync(join(cwd, "plans"), { recursive: true });
    const original = buildPlanSkeleton("existing-race", "clear");
    writeFileSync(target, original);
    let failure;
    try {
      await writeGuarded(cwd, "plans/existing-race.md", "replacement\n", {
        reset: true,
        force: true,
        beforeCommit() {
          writeFileSync(target, "concurrent replacement\n");
        },
      });
    } catch (error) {
      failure = error;
    }
    assert.match(failure?.message ?? "", /target changed during write/u);
    assert.equal(readFileSync(target, "utf8"), "concurrent replacement\n");
  });

  it("accepts authorized child ctime churn while the write parent stays pinned", () => {
    const cwd = makeWorkspace();
    const plans = join(cwd, "plans");
    mkdirSync(plans, { recursive: true });
    const target = join(plans, "ctime-churn.md");
    const preload = ctimeChurnPreload(cwd);
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `import { writeGuarded } from ${JSON.stringify(scaffoldModule)}; await writeGuarded(process.argv[1], process.argv[2], "safe plan\\n", {});`, cwd, target],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          LITCLAUDE_CTIME_TARGET: plans,
          NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(target, "utf8"), "safe plan\n");
  });

  it("keeps concurrent paired writers serialized and leaves one valid pair", async () => {
    const cwd = makeWorkspace();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => runAsync(cwd, ["concurrent-writer"])),
    );
    assert.ok(results.some((result) => result.status === 0), results.map((result) => result.stderr).join("\n"));
    assert.ok(
      results.every((result) => result.status === 0 || /write lock exists/u.test(result.stderr)),
      results.map((result) => `${result.status}: ${result.stderr}`).join("\n"),
    );
    assert.equal(checkPlanStructure(readFileSync(join(cwd, "plans", "concurrent-writer.md"), "utf8")).ok, false);
    assert.match(readFileSync(join(cwd, ".litclaude", "drafts", "concurrent-writer.md"), "utf8"), /# Draft: concurrent-writer/u);
    assert.equal(readdirSync(cwd, { recursive: true }).some((entry) => /\.tmp$|\.pair\.lock$|\.litclaude-lock$/u.test(entry)), false);
  });

  it("accepts a legitimate next lock owner during cleanup", () => {
    const cwd = makeWorkspace();
    mkdirSync(join(cwd, "plans"), { recursive: true });
    const lockPath = join(cwd, "plans", "rotation.md.litclaude-lock");
    const preload = lockRotationPreload(cwd);
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `import { writeGuarded } from ${JSON.stringify(scaffoldModule)}; await writeGuarded(process.argv[1], process.argv[2], "safe plan\\n", {});`, cwd, join(cwd, "plans", "rotation.md")],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          LITCLAUDE_LOCK_TARGET: lockPath,
          NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(cwd, "plans", "rotation.md"), "utf8"), "safe plan\n");
    assert.equal(existsSync(lockPath), true, "the next owner's lock must not be removed by the prior owner");
  });

  // Reproduces the observed 2026-09-17 defect: scaffolding two DIFFERENT slugs
  // concurrently makes sibling entries appear/disappear in the shared
  // `.litclaude/drafts/` directory while one invocation is releasing its own
  // pair lock. That sibling churn only ever changes the directory's ctime, not
  // its dev/ino/birthtime identity, so it must never be reported as "write
  // parent changed" or leave a lock behind — especially not after the draft
  // and plan for that slug were already committed successfully. Each round
  // uses a fresh workspace and enough concurrent slugs to land the race
  // reliably; the loop stays bounded so a still-buggy build fails fast.
  it("never reports paired-write lock cleanup residue from concurrent sibling drafts", async () => {
    const rounds = 30;
    const slugsPerRound = 10;
    const badRuns = [];
    for (let round = 0; round < rounds && badRuns.length === 0; round += 1) {
      const cwd = makeWorkspace();
      const slugs = Array.from({ length: slugsPerRound }, (_, i) => `race-r${round}-s${i}`);
      const results = await Promise.all(slugs.map((slug) => runAsync(cwd, [slug])));
      for (const [i, result] of results.entries()) {
        const slug = slugs[i];
        const draftWritten = existsSync(join(cwd, ".litclaude", "drafts", `${slug}.md`));
        const planWritten = existsSync(join(cwd, "plans", `${slug}.md`));
        if (/lock cleanup left residue/u.test(result.stderr) && draftWritten && planWritten) {
          badRuns.push({ round, slug, stderr: result.stderr });
        }
      }
    }
    assert.deepEqual(
      badRuns,
      [],
      `a committed draft+plan must never be reported as a refused write: ${JSON.stringify(badRuns)}`,
    );
  });
});

describe("scaffold-plan — draft contract", () => {
  it("carries the resume-gating status and the review state", () => {
    const draft = buildDraft("x", "clear");
    assert.match(draft, /^status: drafting$/mu);
    assert.match(draft, /^review_required: false$/mu);
    assert.match(draft, /## Approval gate/u);
  });

  it("--review-required makes dual review pending and names both reviewers", () => {
    const draft = buildDraft("x", "clear", { reviewRequired: true });
    assert.match(draft, /^review_required: true$/mu);
    assert.match(draft, /litclaude:quality-reviewer/u);
    assert.match(draft, /litclaude:lit-verifier/u);
    assert.equal(draft.match(/status: pending/gu)?.length, 2, "both review lanes start pending");
  });
});

describe("scaffold-plan — row grammar", () => {
  it("emits column-zero rows that start-work's parser can actually see", () => {
    const cwd = makeWorkspace();
    const planPath = join(cwd, "plan.md");
    writeFileSync(planPath, buildPlanSkeleton("x", "clear"));

    // readPlanProgress returns a summary ({fingerprint,total,checked,unchecked,next_task}),
    // so compatibility is proved by the counts and by which row it picks up first.
    const progress = readPlanProgress(planPath);
    assert.equal(progress.total, 1 + FINAL_VERIFICATION_ITEMS.length, "every generated row must be visible");
    assert.equal(progress.checked, 0);
    assert.equal(progress.unchecked, 1 + FINAL_VERIFICATION_ITEMS.length);
    assert.match(progress.next_task, /^1\. /u, "the first implementation row must be the next task");
  });

  it("an indented row becomes invisible to start-work — the reason the grammar is column-zero", () => {
    const cwd = makeWorkspace();
    const planPath = join(cwd, "plan.md");
    writeFileSync(planPath, buildPlanSkeleton("x", "clear").replace("- [ ] 1. <title>", "  - [ ] 1. <title>"));

    const progress = readPlanProgress(planPath);
    assert.equal(progress.total, FINAL_VERIFICATION_ITEMS.length, "the indented row is silently dropped");
    assert.doesNotMatch(progress.next_task, /^1\. /u);
    // ...which is exactly what the structural self-check exists to catch before handoff.
    const structure = checkPlanStructure(buildPlanSkeleton("x", "clear").replace("- [ ] 1. <title>", "  - [ ] 1. <title>"));
    assert.ok(structure.problems.some((problem) => /invisible to start-work/u.test(problem)));
  });

  it("ships every canonical section header in order", () => {
    const skeleton = buildPlanSkeleton("x", "clear");
    let previous = -1;
    for (const header of PLAN_SECTION_HEADERS) {
      const index = skeleton.indexOf(header);
      assert.notEqual(index, -1, `missing ${header}`);
      assert.ok(index > previous, `${header} out of order`);
      previous = index;
    }
  });
});

describe("scaffold-plan — pre-handoff structural self-check", () => {
  const filledPlan = () =>
    buildPlanSkeleton("x", "clear")
      .replaceAll(/<fill[^>]*>/gu, "done")
      .replace("- [ ] 1. <title>", "- [ ] 1. real title");

  it("passes a filled skeleton", () => {
    const result = checkPlanStructure(filledPlan());
    assert.deepEqual(result.problems, []);
    assert.equal(result.ok, true);
  });

  it("fails while <fill> placeholders remain — a plan is not decision-complete", () => {
    const result = checkPlanStructure(buildPlanSkeleton("x", "clear"));
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => /placeholders remain/u.test(problem)));
  });

  it("fails a missing canonical section", () => {
    const result = checkPlanStructure(filledPlan().replace("## Commit strategy", "## Commits"));
    assert.ok(result.problems.some((problem) => /missing section: ## Commit strategy/u.test(problem)));
  });

  it("catches an indented row that start-work would silently skip", () => {
    const result = checkPlanStructure(filledPlan().replace("- [ ] 1. real title", "  - [ ] 1. real title"));
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => /invisible to start-work/u.test(problem)));
  });

  it("catches duplicate todo numbers", () => {
    const plan = `${filledPlan()}\n- [ ] 1. another one\n  What to do: x\n  References: y\n  Acceptance criteria: z\n  QA scenarios: q\n  Commit: N\n`;
    assert.ok(checkPlanStructure(plan).problems.some((problem) => /duplicate todo numbers: 1/u.test(problem)));
  });

  it("catches a row missing its required sub-fields", () => {
    const plan = filledPlan().replace(/  Acceptance criteria[^\n]*\n/u, "");
    assert.ok(checkPlanStructure(plan).problems.some((problem) => /missing "Acceptance criteria"/u.test(problem)));
  });

  it("catches a plan with no final-verifier rows", () => {
    const plan = filledPlan().replace(/^- \[ \] F\d+\..*$/gmu, "");
    assert.ok(checkPlanStructure(plan).problems.some((problem) => /no final-verifier rows/u.test(problem)));
  });

  it("does not accept implementation or final-verifier examples inside code fences", () => {
    const fencedOnly = filledPlan()
      .replace(/^- \[ \] F\d+\..*$/gmu, "")
      .replace(
        "- [ ] 1. real title",
        "```md\n- [ ] 1. fenced example\n  What to do: x\n  References: y\n  Acceptance criteria: z\n  QA scenarios: q\n  Commit: N\n- [ ] F1. fenced verifier\n```",
      );
    const result = checkPlanStructure(fencedOnly);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => /no implementation rows/u.test(problem)));
    assert.ok(result.problems.some((problem) => /no final-verifier rows/u.test(problem)));
  });

  it("does not accept a Success criteria heading that exists only inside a code fence", () => {
    const fencedOnly = filledPlan().replace("## Success criteria", "```md\n## Success criteria\n```");
    const result = checkPlanStructure(fencedOnly);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => /missing section: ## Success criteria/u.test(problem)));
  });
});

describe("plan machinery — lit-plan documents the grammar and the scope rule", () => {
  const skill = () => readFileSync(join(root, "plugins", "litclaude", "skills", "lit-plan", "SKILL.md"), "utf8");

  it("states the row grammar in metavariable form, not only as a concrete example", () => {
    // The capability shipped earlier written only as `- [ ] F1. <title>`, which meant a
    // reviewer grepping for the general form found nothing and read it as missing.
    const text = skill();
    assert.match(text, /- \[ \] N\. <title>/u);
    assert.match(text, /- \[ \] F<number>\. <title>/u);
    assert.match(text, /column zero/iu);
  });

  it("requires the scaffold and a PLAN_STRUCTURE_PASS receipt before start-work handoff", () => {
    const text = skill();
    assert.match(text, /Do NOT hand-build the draft or the plan skeleton/iu);
    assert.match(text, /`PLAN_STRUCTURE_PASS` is required before handoff/iu);
    assert.match(text, /do not hand off a red check/iu);
  });

  it("makes full scope the default and disambiguates it from minimum-first", () => {
    const text = skill();
    assert.match(text, /Full scope is the default/u);
    assert.match(text, /never invented/iu);
    assert.match(text, /minimum-first constrains \*\*how much code each item costs\*\*/u);
  });
});

describe("plan machinery — high-accuracy review gate is required, not optional", () => {
  const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
  const armed = (prompt) => {
    const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
    });
    assert.equal(result.status, 0, result.stderr);
    return /Review gate ARMED/u.test(JSON.parse(result.stdout).hookSpecificOutput.additionalContext);
  };

  const skillOf = (prompt) => {
    const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
    });
    return /Skill\(([a-z-]+)\)/u.exec(JSON.parse(result.stdout).hookSpecificOutput.additionalContext)?.[1];
  };

  it("arms on an English review modifier in a planning turn", () => {
    assert.equal(armed("lit plan the migration with high accuracy"), true);
    assert.equal(armed("lit-crucible this release, deep review please"), true);
  });

  it("keeps explicit planning routed to lit-plan and arms a review modifier in any turn", () => {
    assert.equal(skillOf("lit plan this rigorous review"), "lit-plan");
    assert.equal(armed("lit plan this rigorous review"), true);
    assert.equal(skillOf("lit plan this 고정밀"), "lit-plan");
    assert.equal(armed("lit plan this 고정밀"), true);
  });

  it("arms on the Korean modifier", () => {
    assert.equal(armed("lit plan the migration 고정밀로"), true);
  });

  it("stays disarmed without a modifier — negative control", () => {
    assert.equal(armed("lit plan the migration"), false);
  });

  it("does not arm outside a planning discipline", () => {
    assert.equal(armed("litwork ship it with high accuracy"), false);
  });

  it("a modifier inside a code span is inert", () => {
    assert.equal(armed("lit plan and mention `high accuracy` in a code span"), false);
  });

  it("demands BOTH review lanes, and says inconclusive is not approval", () => {
    const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "lit plan it with high accuracy", cwd: root }),
    });
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.match(context, /litclaude:quality-reviewer/u);
    assert.match(context, /litclaude:lit-verifier/u);
    assert.match(context, /One lane approving is not approval/u);
    assert.match(context, /inconclusive is not approval/u);
    assert.match(context, /--review-required/u);
  });
});

describe("scaffold-plan — CLI surface", () => {
  it("reports created paths and the next action", () => {
    const cwd = makeWorkspace();
    const result = run(cwd, ["my-slug", "--draft-only"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /created: \.litclaude[/\\]drafts[/\\]my-slug\.md/u);
    assert.match(result.stdout, /next: record intent/u);
  });

  it("--check exits non-zero and names each problem", () => {
    const cwd = makeWorkspace();
    mkdirSync(join(cwd, "plans"), { recursive: true });
    writeFileSync(join(cwd, "plans", "bad.md"), "# nothing here\n");
    const result = run(cwd, ["--check", "plans/bad.md"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /PLAN_STRUCTURE_FAIL/u);
    assert.match(result.stderr, /missing section/u);
  });

  it("--check exits zero on a filled plan", () => {
    const cwd = makeWorkspace();
    mkdirSync(join(cwd, "plans"), { recursive: true });
    const filled = buildPlanSkeleton("x", "clear").replaceAll(/<fill[^>]*>/gu, "done");
    writeFileSync(join(cwd, "plans", "good.md"), filled);
    const result = run(cwd, ["--check", "plans/good.md"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PLAN_STRUCTURE_PASS/u);
  });

  it("--check refuses symlinked parents and files", () => {
    const cwd = makeWorkspace();
    const outside = makeWorkspace();
    mkdirSync(join(outside, "plans"), { recursive: true });
    writeFileSync(join(outside, "plans", "linked.md"), buildPlanSkeleton("linked", "clear"));
    symlinkSync(join(outside, "plans"), join(cwd, "plans"), "dir");
    const parentLink = run(cwd, ["--check", "plans/linked.md"]);
    assert.equal(parentLink.status, 1);
    assert.match(parentLink.stderr, /refused|ANCESTOR|symlink/u);

    rmSync(join(cwd, "plans"), { force: true });
    mkdirSync(join(cwd, "plans"), { recursive: true });
    symlinkSync(join(outside, "plans", "linked.md"), join(cwd, "plans", "linked.md"), "file");
    const fileLink = run(cwd, ["--check", "plans/linked.md"]);
    assert.equal(fileLink.status, 1);
    assert.match(fileLink.stderr, /refused|NON_REGULAR|symlink/u);
  });

  it("exits non-zero with a readable message on a bad slug", () => {
    const result = run(makeWorkspace(), ["Not A Slug"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid slug/u);
  });

  it("executes when invoked through a realpath alias such as a symlinked or macOS /var path", () => {
    const cwd = makeWorkspace();
    const aliasRoot = makeWorkspace();
    const aliasPath = join(aliasRoot, "scaffold-plan-alias.mjs");
    symlinkSync(scriptPath, aliasPath, "file");
    assert.notEqual(aliasPath, realpathSync(aliasPath), "the fixture must exercise distinct lexical and real paths");

    const result = spawnSync(process.execPath, [aliasPath, "alias-probe", "--draft-only"], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /created: .*alias-probe\.md/u);
  });
});

// LC-1 and LC-8 (1.0.40 security review): a cloned repository can carry `.litclaude`, a folder
// below it or a state file as a symlink. No state write may follow one: the SessionStart marker,
// next-step, workflow-stack and ledger writers refuse instead of writing outside the project.
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { appendLitgoalLedger } from "../plugins/litclaude/lib/litgoal/ledger.mjs";
import { prepareStateDir } from "../plugins/litclaude/lib/project-state-root.mjs";
import { writeNextStep } from "../plugins/litclaude/lib/rewind/next-step.mjs";
import { adhdSuggestion } from "../plugins/litclaude/lib/rewind/suggest.mjs";
import { projectSlug } from "../plugins/litclaude/lib/rewind/transcripts.mjs";
import { writeStack } from "../plugins/litclaude/lib/workflow-stack.mjs";

const cleanups = [];
afterEach(() => {
  while (cleanups.length) rmSync(cleanups.pop(), { recursive: true, force: true });
});
const scratch = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "state-link-")));
  cleanups.push(dir);
  return dir;
};

const NOW = Date.parse("2026-10-25T12:00:00.000Z");
// A repository whose `.litclaude` is a symlink to a folder outside it, as a clone can carry.
const linkedRepo = () => {
  const base = scratch();
  const repo = join(base, "repo");
  const outside = join(base, "outside");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(outside);
  symlinkSync(outside, join(repo, ".litclaude"));
  return { base, repo, outside };
};

test("LC-1: the SessionStart marker is never written through a symlinked marker or .litclaude", () => {
  const base = scratch();
  const repo = join(base, "repo");
  const configDir = join(base, "config");
  const folder = join(configDir, "projects", projectSlug(repo));
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "other.jsonl"), "{}\n");
  utimesSync(join(folder, "other.jsonl"), new Date(NOW - 60_000), new Date(NOW - 60_000));
  mkdirSync(join(repo, ".litclaude", "adhd"), { recursive: true });
  const victim = join(base, "victim.txt");
  writeFileSync(victim, "ORIGINAL-SECRET");
  symlinkSync(victim, join(repo, ".litclaude", "adhd", "suggested.json"));
  const line = adhdSuggestion({ cwd: repo, sessionId: "self", configDir, stateRoot: repo, now: NOW });
  assert.equal(readFileSync(victim, "utf8"), "ORIGINAL-SECRET", "the link target is untouched");
  assert.ok(lstatSync(join(repo, ".litclaude", "adhd", "suggested.json")).isSymbolicLink());
  assert.equal(line, null, "a refused write is not a made suggestion");

  const linked = linkedRepo();
  const other = join(configDir, "projects", projectSlug(linked.repo));
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, "other.jsonl"), "{}\n");
  utimesSync(join(other, "other.jsonl"), new Date(NOW - 60_000), new Date(NOW - 60_000));
  assert.equal(adhdSuggestion({ cwd: linked.repo, sessionId: "self", configDir, stateRoot: linked.repo, now: NOW }), null);
  assert.equal(existsSync(join(linked.outside, "adhd")), false, "nothing is created outside the repository");
});

test("LC-8: next-step and workflow-stack writes refuse a symlinked .litclaude instead of planting files outside", () => {
  const { repo, outside } = linkedRepo();
  assert.throws(() => writeNextStep(repo, "s-1", { kind: "none", target: null }), /state folder/u);
  assert.throws(() => writeStack(repo, "s-1", { version: 1, sessionId: "s-1", frames: [], history: [] }), /state folder/u);
  assert.equal(existsSync(join(outside, "adhd")), false);
  assert.equal(existsSync(join(outside, "workflow-stack")), false);
});

test("LC-8: a planted symlink at a ledger or a predictable temp file is refused, not written through", () => {
  const base = scratch();
  const repo = join(base, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, ".litclaude", "litgoal"), { recursive: true });
  mkdirSync(join(repo, ".litclaude", "workflow-stack"), { recursive: true });
  const victim = join(base, "victim.txt");
  writeFileSync(victim, "ORIGINAL");
  const ledger = join(repo, ".litclaude", "litgoal", "ledger.jsonl");
  symlinkSync(victim, ledger);
  assert.throws(() => appendLitgoalLedger(ledger, { event: "x" }));
  const staging = `${join(repo, ".litclaude", "workflow-stack", "s-1.json")}.${process.pid}.tmp`;
  symlinkSync(victim, staging);
  assert.throws(() => writeStack(repo, "s-1", { version: 1, sessionId: "s-1", frames: [], history: [] }));
  assert.equal(readFileSync(victim, "utf8"), "ORIGINAL");
});

test("prepareStateDir walks every folder below .litclaude and refuses a link or a file at any level", () => {
  const base = scratch();
  const repo = join(base, "repo");
  mkdirSync(repo);
  assert.equal(prepareStateDir(join(repo, ".litclaude", "adhd")), true);
  assert.equal(readFileSync(join(repo, ".litclaude", ".gitignore"), "utf8").includes("*"), true);
  assert.equal(prepareStateDir(join(repo, ".litclaude", "adhd")), true, "an existing .gitignore is not a refusal");
  const outside = join(base, "outside");
  mkdirSync(outside);
  symlinkSync(outside, join(repo, ".litclaude", "workflow-stack"));
  assert.equal(prepareStateDir(join(repo, ".litclaude", "workflow-stack")), false);
  writeFileSync(join(repo, ".litclaude", "litgoal"), "not a folder");
  assert.equal(prepareStateDir(join(repo, ".litclaude", "litgoal", "x")), false);
  assert.equal(prepareStateDir(join(repo, "not-state")), false, "a path outside any .litclaude is refused");
  assert.equal(prepareStateDir(join(linkedRepo().repo, ".litclaude", "adhd")), false);
});

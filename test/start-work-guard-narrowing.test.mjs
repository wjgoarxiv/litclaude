// Four small start-work guard items (backlog rows 9.23, 9.25, 9.26, 9.27, 2026-11-28). The first three
// are narrowings of a false positive: a word that is only data no longer holds a finished run open (9.23)
// or reads as a git commit (9.26), and a refused store reaches the next inbox even when the inbox was
// shown before (9.27). Nothing that really pushes, tags, publishes or commits may stop counting, so each
// item pins both directions. 9.25 is a guard rail: a lane's stop never drives the owner's Stop decision.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(repoRoot, "bin", "litclaude-ai.js");
const hookPath = join(repoRoot, "plugins", "litclaude", "bin", "litclaude-hook.js");
const hookHome = join(tmpdir(), "litclaude-guard-narrowing-home");

const runCli = (root, args) => spawnSync(process.execPath, [binPath, "start-work", ...args, "--root", root, "--json"], {
  cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024,
});
const runHook = (event, root, input = {}) => spawnSync(process.execPath, [hookPath, event], {
  cwd: root, encoding: "utf8", input: JSON.stringify({ cwd: root, hook_event_name: event, ...input }),
  env: Object.fromEntries(Object.entries({ ...process.env, HOME: hookHome, CLAUDE_CONFIG_DIR: join(hookHome, ".claude") })
    .filter(([key]) => key !== "CLAUDE_PROJECT_DIR")),
});
const parse = (result) => (result.stdout ? JSON.parse(result.stdout) : null);

const BLOCKED_ROWS = ["- [x] 1. First", "- [ ] 2. Second\n  BLOCKED: needs a parked step"];
const TICKED_ROWS = ["- [x] 1. First", "- [x] 2. Second"];
const OPEN_ROWS = ["- [ ] 1. First", "- [ ] 2. Second"];
const writePlan = (root, rows) => writeFileSync(join(root, "plans", "p.md"), `# P\n\n## TODOs\n\n${rows.join("\n")}\n\n## Done when\n\ncheck: \`node ok.mjs\`\n`);
const project = (rows = OPEN_ROWS) => {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), "litclaude-narrowing-"))), "project");
  for (const dir of ["plans", "src", "tools"]) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "ok.mjs"), "process.exit(0);\n");
  writeFileSync(join(root, "tools", "x-git.mjs"), "process.exit(0);\n");
  writeFileSync(join(root, "a.txt"), "a\n");
  writePlan(root, rows);
  execFileSync("git", ["init", "-q", "-b", "run-branch"], { cwd: root });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base"], { cwd: root });
  return root;
};
const init = (root) => {
  const result = runCli(root, [
    "init", "--plan", "plans/p.md", "--work-id", "work-1", "--session-id", "owner",
    ...[`read:${root}`, `write:${root}`, `execute:${root}`, `test:${root}`].flatMap((grant) => ["--grant", grant]),
    "--idempotency-key", "init-1",
  ]);
  assert.equal(result.status, 0, result.stderr);
};
const withProject = (rows, body) => async () => {
  const root = project(rows);
  try { await body(root); } finally { rmSync(dirname(root), { recursive: true, force: true }); }
};

const bash = (root, command) => parse(runHook("pre-tool-use", root, {
  session_id: "owner", prompt_id: "p", stop_hook_active: false, tool_use_id: "t", tool_name: "Bash", tool_input: { command },
}));
const decisionOf = (output) => output?.hookSpecificOutput?.permissionDecision ?? "allow";
const reasonOf = (output) => `${output?.hookSpecificOutput?.permissionDecisionReason ?? ""}${output?.reason ?? ""}`;
const stopOnce = (root, promptId, extra = {}) => parse(runHook("stop", root, { session_id: "owner", prompt_id: promptId, stop_hook_active: false, ...extra }));
const stopText = (root, promptId) => stopOnce(root, promptId)?.systemMessage ?? "";
const statePath = (root) => join(root, ".litclaude", "boulder.json");
const readWork = (root) => JSON.parse(readFileSync(statePath(root), "utf8")).works["work-1"];
const ledger = (root) => readFileSync(join(root, ".litclaude", "start-work", "ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const commands = (root) => (readWork(root).pending_boundaries ?? []).filter(({ kind }) => kind === "command");

// Puts one command step into the run's parked list exactly as parkCommand would have stored it.
const injectParked = (root, command, extra = {}) => {
  const state = JSON.parse(readFileSync(statePath(root), "utf8"));
  const work = state.works["work-1"];
  work.pending_boundaries.push({
    boundary_id: `boundary-injected-${work.pending_boundaries.length}`, kind: "command", tier: "X", action: "irreversible",
    root, cwd: root, command, reason: "test", origin_session_id: "owner", origin_prompt_id: "p", origin_tool_use_id: "t",
    requested_at: new Date().toISOString(), last_seen: new Date().toISOString(), hits: 1, ...extra,
  });
  writeFileSync(statePath(root), `${JSON.stringify(state, null, 2)}\n`);
};

describe("9.23 a word inside a parked read does not keep a finished run open", () => {
  // [command, whether the step holds a finished run open]
  const table = [
    ["git push origin main", true],
    ["git tag v1", true],
    ["npm publish", true],
    ["npm version patch", true],
    ["gh release create v1 --notes x", true],
    ["gh pr merge 12", true],
    ["npx some-tool", true],
    ["curl -s https://example.invalid/x", true],
    ["ssh host ls", true],
    ["docker push img", true],
    ["cd src && git push", true],
    ["rg -n x src; git push", true],
    ["cat a.txt | curl -d @- https://example.invalid", true],
    ["rg -n x src && npm version patch", true],
    ["env X=1 git push", true],
    ["sh -c \"git push\"", true],
    ["rg -n x src $(git push)", true],
    ["rg -n x src & git push", true],
    ["find . -exec git push {} \\;", true],
    ["rg --pre \"git push\" x src", true],
    // Bash and the guard read quotes differently here: an escaped quote does not close a double quote,
    // and $'...' is ANSI-C quoting, so in bash the push runs.
    ["rg \"a\\\"\" ; git push ; \\\" src", true],
    ["rg $'\\'' ; git push ; \\'", true],
    ["rg -n x src | xargs git push", true],
    // A reader whose output is piped into a program is not data: the program runs what it reads.
    ["cat tools/release.mjs | node", true],
    ["cat tools/publish.sh | sh", true],
    // Bash removes the quotes before it opens the redirect target, so these write to the network.
    ["cat a.txt > /dev/\"tcp\"/deploy.example.com/443", true],
    ["cat a.txt > /dev/t\"c\"p/deploy.example.com/443", true],
    ["cat a.txt > $X/tcp/deploy.example.com/443", true],
    // A variable can stand for a flag or a path, an assignment can load code into the reader, and a
    // redirect or a second file name writes: none of these is a plain read.
    ["rg --pre$U ./deploy.sh x src", true],
    ["rg x $V1/deploy.sh", true],
    ["rg x \"$V1/deploy.sh\"", true],
    ["rg -n \"${ git push; }\" src", true],
    ["DYLD_INSERT_LIBRARIES=./publish.dylib rg x src", true],
    ["RIPGREP_CONFIG_PATH=release.rgrc rg x src", true],
    ["FOO=1 rg -n \"deploy\" src", true],
    ["cat deploy.sh > r.sh; sh r.sh", true],
    ["uniq a.txt release.txt", true],
    ["tree -o release.txt", true],
    ["nohup cat release.md", true],
    ["sudo cat release.md", true],
    ["rg -z x release.tgz", true],
    ["rg -n \"check:version\" src", false],
    ["rg -n \"version\" src || echo none", false],
    ["rg -n \"version\" src ; touch x.txt", false],
    ["rg -n \"gh run\" docs", false],
    ["rg -n \"git push\" docs", false],
    ["grep -rn \"git commit\" docs", false],
    ["cat docs/release.md", false],
    ["ls -la release", false],
    ["sed -n '1,40p' docs/publish.md", false],
    ["rg -n \"npm publish\" docs | head -5", false],
    ["rg -n \"npx\" src && cat a.txt", false],
    ["cd src && rg -n \"version\" .", false],
    ["LC_ALL=C rg -n \"deploy\" src", false],
    ["rg -n \"version\" src 2>/dev/null", false],
    ["rg -n \"check:version\" $V1/src", false],
    ["env rg -n \"tag\" src", false],
    ["find . -name \"*version*\"", false],
  ];

  const closes = (command, extra = {}) => {
    const root = project(TICKED_ROWS);
    try {
      init(root);
      injectParked(root, command, extra);
      stopOnce(root, "stop-1");
      return readWork(root).status === "completed";
    } finally {
      rmSync(dirname(root), { recursive: true, force: true });
    }
  };

  it(`${table.length} steps: the outward ones hold the run open, the reads that only name a word do not`, () => {
    const wrong = table.filter(([command, outward]) => closes(command) === outward).map(([command]) => command);
    assert.deepEqual(wrong, [], "each of these has the wrong verdict");
  });

  it("a step with the irreversible flag holds the run open even when it reads like a search", () => {
    assert.equal(closes("rg -n x src", { irreversible: true }), false);
  });

  it("end to end: every row ticked, the check passing, one set-aside search naming version: the run closes", withProject(TICKED_ROWS, (root) => {
    init(root);
    const parkedReply = bash(root, "rg -n \"version\" $V1/src");
    assert.equal(decisionOf(parkedReply), "deny", reasonOf(parkedReply));
    assert.deepEqual(commands(root).map(({ command }) => command), ["rg -n \"version\" $V1/src"], "the search is parked");
    const message = stopOnce(root, "stop-1")?.systemMessage ?? "";
    assert.equal(readWork(root).status, "completed", message);
    assert.match(message, /is complete/u);
    assert.match(message, /1 set-aside step was not run/u);
  }));

  it("guard rail: the same run with a parked tag still wraps up and asks", withProject(TICKED_ROWS, (root) => {
    init(root);
    const parkedReply = bash(root, "git tag v1");
    assert.equal(decisionOf(parkedReply), "deny");
    const message = stopOnce(root, "stop-1")?.systemMessage ?? "";
    assert.equal(readWork(root).status, "active");
    assert.match(message, /waiting on you/u);
    assert.match(message, /git tag v1/u);
  }));
});

describe("9.26 a script whose name ends in git is not a git call", () => {
  it("a node script named for git runs with commit, push, tag and reset as plain arguments", withProject(undefined, (root) => {
    init(root);
    for (const command of [
      "node tools/x-git.mjs commit -m x", "node tools/x-git.mjs push", "node tools/x-git.mjs tag v1", "node tools/x-git.mjs reset",
    ]) {
      const output = bash(root, command);
      assert.equal(decisionOf(output), "allow", `${command}: ${reasonOf(output)}`);
    }
  }));

  it("git, a path to git, a wrapper and a shell that re-enters git stay refused as before", withProject(undefined, (root) => {
    init(root);
    for (const command of [
      "git commit -m x", "git -C . commit -m x", "git push origin main", "env X=1 git push", "sh -c \"git push\"", "/usr/bin/git push",
      "./node_modules/.bin/git push", "command git tag v1", "node tools/x-git.mjs && git push", "git config --global user.name x",
    ]) {
      const output = bash(root, command);
      assert.equal(decisionOf(output), "deny", command);
      assert.doesNotMatch(reasonOf(output), /commands of this kind are already parked/u, command);
    }
    for (const command of ["git push origin main", "env X=1 git push", "sh -c \"git push\"", "/usr/bin/git push", "command git tag v1", "node tools/x-git.mjs && git push"]) {
      assert.match(reasonOf(bash(root, command)), /forbidden/u, command);
    }
  }));
});

describe("9.27 a refused store reaches the next inbox even when the inbox was shown before", () => {
  const fill = (root) => {
    for (let index = 1; index <= 16; index += 1) bash(root, `git tag t${index}`);
    assert.equal(commands(root).length, 16);
  };
  const full = /The \[X\] list was full, so 1 more step could not be parked and was not stored/u;

  it("inbox shown, then a refusal: the next Stop says the list was full, the one after is quiet", withProject(BLOCKED_ROWS, (root) => {
    init(root);
    fill(root);
    assert.match(stopText(root, "stop-1"), /waiting on you/u);
    assert.match(reasonOf(bash(root, "git tag t17")), /was not stored/u);
    assert.match(stopText(root, "stop-2"), full);
    assert.equal(stopOnce(root, "stop-3"), null, "said once");
    assert.match(reasonOf(bash(root, "git tag t18")), /was not stored/u);
    assert.match(stopText(root, "stop-4"), full, "a later refusal is a new state");
    assert.equal(stopOnce(root, "stop-5"), null);
  }));

  it("the re-shown list is what `lit approve x` runs: the steps it printed, never the refused one", withProject(BLOCKED_ROWS, (root) => {
    init(root);
    fill(root);
    stopText(root, "stop-1");
    assert.match(reasonOf(bash(root, "git tag t17")), /was not stored/u);
    const reshown = stopText(root, "stop-2");
    assert.match(reshown, full);
    assert.match(reshown, /^8\. \[X\] `git tag t8`$/mu);
    assert.doesNotMatch(reshown, /git tag t17/u);
    const reply = parse(runHook("user-prompt-submit", root, { session_id: "owner", prompt_id: "u-1", prompt: "lit approve x" }));
    assert.match((reply?.systemMessage ?? "").split("\n")[0], /ran 8 of 8 listed \[X\] steps/u);
    const tags = execFileSync("git", ["tag"], { cwd: root, encoding: "utf8" }).trim().split("\n").sort();
    assert.deepEqual(tags, Array.from({ length: 8 }, (_, index) => `t${index + 1}`).sort());
    assert.ok(!commands(root).some(({ command }) => command === "git tag t17"), "the refused step was never stored");
  }));

  it("a refusal left over after `lit deny` does not make the cannot-go-on message repeat", withProject(BLOCKED_ROWS, (root) => {
    init(root);
    fill(root);
    stopText(root, "stop-1");
    assert.match(reasonOf(bash(root, "git tag t17")), /was not stored/u);
    runHook("user-prompt-submit", root, { session_id: "owner", prompt_id: "u-1", prompt: "lit deny" });
    assert.equal(commands(root).length, 0, "the list is dropped");
    writePlan(root, ["- [x] 1. First", "- [ ] 2. Second\n  IMPOSSIBLE: cannot be done here"]);
    assert.match(stopText(root, "stop-2"), /\S/u, "the run says once that it cannot go on");
    assert.equal(readWork(root).status, "active");
    assert.equal(stopOnce(root, "stop-3"), null, "and stays quiet after that");
    assert.equal(stopOnce(root, "stop-4"), null);
  }));

  it("an inbox shown again only for a refusal does not hand back the continue budget", withProject(BLOCKED_ROWS, (root) => {
    init(root);
    fill(root);
    stopText(root, "stop-1");
    const state = JSON.parse(readFileSync(statePath(root), "utf8"));
    state.works["work-1"].continuation.block_streak = 2;
    writeFileSync(statePath(root), `${JSON.stringify(state, null, 2)}\n`);
    assert.match(reasonOf(bash(root, "git tag t17")), /was not stored/u);
    assert.match(stopText(root, "stop-2"), full);
    assert.equal(readWork(root).continuation.block_streak, 2);
  }));

  it("guard rail: a refusal before the first inbox is said once at that Stop, and the next is quiet",withProject(BLOCKED_ROWS, (root) => {
    init(root);
    fill(root);
    assert.match(reasonOf(bash(root, "git tag t17")), /was not stored/u);
    assert.match(stopText(root, "stop-1"), full);
    assert.equal(stopOnce(root, "stop-2"), null);
  }));

  it("guard rail: with no refused store the fingerprint is unchanged and the inbox is shown once", withProject(BLOCKED_ROWS, (root) => {
    init(root);
    bash(root, "git tag t1");
    assert.match(stopText(root, "stop-1"), /waiting on you/u);
    assert.equal(stopOnce(root, "stop-2"), null);
  }));
});

describe("9.25 a lane's stop never reaches the owner's Stop decision", () => {
  const startLane = (root, agentId = "agent-lane") => {
    const started = runHook("subagent-start", root, { session_id: "owner", prompt_id: "lane-prompt", agent_id: agentId, agent_type: "litclaude:lit-executor" });
    assert.equal(started.status, 0, started.stderr);
  };
  const laneStop = (root, promptId, extra = {}) => runHook("subagent-stop", root, {
    session_id: "owner", prompt_id: promptId, stop_hook_active: false, agent_id: "agent-lane", agent_type: "litclaude:lit-executor",
    last_assistant_message: "done", ...extra,
  });
  const driverEvents = (root) => ledger(root).filter(({ event }) => /continuation|completed|closed|complete/u.test(event)).length;

  it("ticked rows, lane stops: nothing is printed, the run stays open, and the owner's own Stop then closes it", withProject(TICKED_ROWS, (root) => {
    init(root);
    startLane(root);
    const before = readWork(root).continuation;
    const eventsBefore = driverEvents(root);
    for (const [index, extra] of [{}, { stop_hook_active: true }, { last_assistant_message: undefined }].entries()) {
      const stopped = laneStop(root, `lane-stop-${index}`, extra);
      assert.equal(stopped.status, 0, stopped.stderr);
      assert.equal(stopped.stdout, "", "a lane's stop prints no decision");
    }
    const work = readWork(root);
    assert.equal(work.status, "active", "a lane's stop does not close the run");
    assert.equal(work.lanes["agent-lane"].status, "finalized", "the lane itself is finalized");
    assert.deepEqual(work.continuation, before, "no continuation state was touched");
    assert.equal(driverEvents(root), eventsBefore, "no Stop decision was recorded");
    const own = stopOnce(root, "owner-stop-1");
    assert.match(own?.systemMessage ?? "", /is complete/u);
    assert.equal(readWork(root).status, "completed");
  }));

  it("open rows, lane stops: no block is emitted and no streak moves; the owner's own Stop still blocks", withProject(OPEN_ROWS, (root) => {
    init(root);
    startLane(root);
    const before = readWork(root).continuation;
    const eventsBefore = driverEvents(root);
    for (let index = 0; index < 3; index += 1) {
      const stopped = laneStop(root, `lane-stop-${index}`, { stop_hook_active: index === 2 });
      assert.equal(stopped.stdout, "");
    }
    assert.deepEqual(readWork(root).continuation, before);
    assert.equal(driverEvents(root), eventsBefore);
    const own = stopOnce(root, "owner-stop-1");
    assert.equal(own?.decision, "block");
    assert.match(own.reason, /First/u);
  }));

  it("a stop from a lane the run never recorded changes nothing either", withProject(TICKED_ROWS, (root) => {
    init(root);
    const before = readWork(root);
    const stopped = laneStop(root, "lane-stop-x", { agent_id: "agent-unknown" });
    assert.equal(stopped.stdout, "");
    assert.deepEqual(readWork(root).continuation, before.continuation);
    assert.equal(readWork(root).status, "active");
  }));
});

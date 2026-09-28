import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hudPath = join(root, "plugins", "litclaude", "bin", "litclaude-hud.js");
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const stripAnsi = (value) => value.replace(/\x1b\[[0-9;]*m/gu, "");

const colorEnv = (overrides = {}) => {
  const env = { ...process.env };
  for (const key of ["NO_COLOR", "CI", "LITCLAUDE_HUD_APPEARANCE", "LITCLAUDE_HUD_NO_COLOR", "LITCLAUDE_HUD_COLOR_DEPTH"]) delete env[key];
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return { ...env, ...overrides };
};

const runHook = (input, env) =>
  spawnSync(process.execPath, [hookPath, "user-prompt-submit"], { cwd: root, encoding: "utf8", env, input: JSON.stringify(input) });

const runHud = (status, env) =>
  spawnSync(process.execPath, [hudPath], { encoding: "utf8", env, input: JSON.stringify(status) });

const statusFor = (tmp, sessionId) => ({
  session_id: sessionId,
  cwd: join(tmp, "workspace"),
  transcript_path: join(tmp, "missing-transcript.jsonl"),
  model: { id: "claude-opus-5", display_name: "Claude Opus 5" },
  context_window: { context_window_size: 200000, used_percentage: 12 },
});

test("prompt hook records the ignited discipline per session and the HUD renders a bold, colored 🔥 mark", () => {
  const tmp = mkdtempSync(join(tmpdir(), "litclaude-ignition-"));
  try {
    mkdirSync(join(tmp, "workspace"));
    const env = colorEnv({ HOME: tmp, LITCLAUDE_HUD_STATE_ROOT: join(tmp, "hud-state") });
    const sessionId = "ignition-session-01";

    const ignite = runHook({ session_id: sessionId, cwd: join(tmp, "workspace"), prompt: "keep the loop honest lit" }, env);
    assert.equal(ignite.status, 0, ignite.stderr);
    const statePath = join(tmp, "hud-state", `${sessionId}.json`);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.discipline, "lit-loop");
    assert.equal(state.sessionId, sessionId);
    assert.match(state.at, /^\d{4}-\d{2}-\d{2}T/u);

    const lit = runHud(statusFor(tmp, sessionId), env);
    assert.equal(lit.status, 0, lit.stderr);
    const litPlain = stripAnsi(lit.stdout);
    assert.match(litPlain, /🔥 LIT IGNITED · lit-loop 🔥/u);
    assert.match(lit.stdout, /\x1b\[1m/u, "ignition mark must be bold");
    assert.match(lit.stdout, /\x1b\[38;2;\d+;\d+;\d+m/u, "ignition mark must be truecolor-painted");

    const idle = runHook({ session_id: sessionId, cwd: join(tmp, "workspace"), prompt: "what time is it in Seoul?" }, env);
    assert.equal(idle.status, 0, idle.stderr);
    assert.equal(JSON.parse(readFileSync(statePath, "utf8")).discipline, null);

    const cooled = runHud(statusFor(tmp, sessionId), env);
    assert.equal(cooled.status, 0, cooled.stderr);
    const cooledPlain = stripAnsi(cooled.stdout);
    assert.doesNotMatch(cooledPlain, /IGNITED|🔥 LIT/u);
    assert.match(cooledPlain, /^\[🔥LITCLAUDE v[\d.]+\] \| /u, "cooled line returns to the plain prefix layout");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("HUD with no ignition record for the session shows no mark and another session's record never leaks", () => {
  const tmp = mkdtempSync(join(tmpdir(), "litclaude-ignition-"));
  try {
    mkdirSync(join(tmp, "workspace"));
    const env = colorEnv({ HOME: tmp, LITCLAUDE_HUD_STATE_ROOT: join(tmp, "hud-state") });
    const other = runHook({ session_id: "other-session", cwd: join(tmp, "workspace"), prompt: "ship it lit" }, env);
    assert.equal(other.status, 0, other.stderr);

    const hud = runHud(statusFor(tmp, "fresh-session"), env);
    assert.equal(hud.status, 0, hud.stderr);
    const plain = stripAnsi(hud.stdout);
    assert.doesNotMatch(plain, /IGNITED|🔥 LIT/u);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("NO_COLOR keeps the 🔥 ignition text without any escape codes", () => {
  const tmp = mkdtempSync(join(tmpdir(), "litclaude-ignition-"));
  try {
    mkdirSync(join(tmp, "workspace"));
    const env = colorEnv({ HOME: tmp, LITCLAUDE_HUD_STATE_ROOT: join(tmp, "hud-state"), NO_COLOR: "1" });
    const ignite = runHook({ session_id: "plain-session", cwd: join(tmp, "workspace"), prompt: "recap lit" }, env);
    assert.equal(ignite.status, 0, ignite.stderr);

    const hud = runHud(statusFor(tmp, "plain-session"), env);
    assert.equal(hud.status, 0, hud.stderr);
    assert.doesNotMatch(hud.stdout, /\x1b\[/u);
    assert.match(hud.stdout, /🔥 LIT IGNITED · [a-z-]+ 🔥/u);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("unsafe session ids cannot escape the ignition state root", () => {
  const tmp = mkdtempSync(join(tmpdir(), "litclaude-ignition-"));
  try {
    mkdirSync(join(tmp, "workspace"));
    const env = colorEnv({ HOME: tmp, LITCLAUDE_HUD_STATE_ROOT: join(tmp, "hud-state") });
    const hook = runHook({ session_id: "../../escape", cwd: join(tmp, "workspace"), prompt: "go lit" }, env);
    assert.equal(hook.status, 0, hook.stderr);
    const hud = runHud(statusFor(tmp, "../../escape"), env);
    assert.equal(hud.status, 0, hud.stderr);
    assert.match(stripAnsi(hud.stdout), /🔥 LIT IGNITED · lit-loop 🔥/u);
    assert.equal(existsSync(join(tmp, "escape.json")), false);
    assert.ok(readdirSync(join(tmp, "hud-state")).every((name) => /^[A-Za-z0-9._-]+\.json$/u.test(name)));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("without an override the HUD record lives in the per-user temp directory, not workspace or home HUD state", () => {
  const tmp = mkdtempSync(join(tmpdir(), "litclaude-ignition-"));
  try {
    const workspace = join(tmp, "workspace");
    mkdirSync(join(workspace, ".git"), { recursive: true });
    mkdirSync(join(tmp, "home"));
    mkdirSync(join(tmp, "tmp"));
    const env = colorEnv({ HOME: join(tmp, "home"), TMPDIR: join(tmp, "tmp") });
    const hook = runHook({ session_id: "rooted-session", cwd: join(workspace, "packages", "deep"), prompt: "carry on lit" }, env);
    assert.equal(hook.status, 0, hook.stderr);
    assert.ok(existsSync(join(tmp, "tmp", "litclaude-hud", "rooted-session.json")), "record lives under TMPDIR/litclaude-hud");
    assert.equal(existsSync(join(workspace, ".litclaude", "hud")), false, "HUD state never uses the workspace state root");
    assert.equal(existsSync(join(tmp, "home", ".litclaude")), false, "home directory stays untouched");

    const hud = runHud({ ...statusFor(tmp, "rooted-session"), cwd: join(workspace, "packages", "deep") }, env);
    assert.equal(hud.status, 0, hud.stderr);
    assert.match(stripAnsi(hud.stdout), /🔥 LIT IGNITED · lit-loop 🔥/u);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

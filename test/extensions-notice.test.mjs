import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { extensionsNoticeLines } from "../plugins/litclaude/lib/extensions-notice.mjs";

// Nine file-making skills are now LitFamily extensions on the wjgoarxiv-skills shelf. The installer says so
// after every install or update, and the first session that runs a new version says so once. On an upgrade
// both name what older versions left on disk. Neither reaches a JSON result.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const ESC = String.fromCharCode(27);

const NOTICE = [
  "LitFamily extensions",
  "LitClaude's core is complete and works on its own.",
  "Nine skills that make files (decks, documents, figures, design, video covers) are now LitFamily",
  "extensions, kept on the extension shelf at github.com/wjgoarxiv/wjgoarxiv-skills.",
  "to get the full LitFamily experience",
  "claude plugin marketplace add wjgoarxiv/wjgoarxiv-skills",
  "claude plugin install decks@wjgoarxiv-skills",
];
const UPGRADE = "Older versions left these behind.";

const sandbox = (t) => {
  const path = mkdtempSync(join(tmpdir(), "litclaude-extensions-"));
  t.after(() => rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const project = join(path, "project");
  mkdirSync(project);
  const env = {
    ...process.env,
    HOME: path,
    LITCLAUDE_HOME: join(path, "lit"),
    CLAUDE_CONFIG_DIR: join(path, "claude"),
    CLAUDE_HOME: join(path, "claude"),
    XDG_CACHE_HOME: join(path, "cache"),
    TMPDIR: path,
    npm_config_cache: join(path, "npm-cache"),
    CI: "1",
    NO_COLOR: "1",
    LITCLAUDE_NO_UPDATE_CHECK: "1",
    LITCLAUDE_NO_AUTO_UPDATE: "1",
  };
  const cliIn = (cwd, ...args) => spawnSync(process.execPath, [join(root, "bin", "litclaude-ai.js"), "--no-auto-update", ...args], {
    cwd, encoding: "utf8", timeout: 120000, env,
  });
  const cli = (...args) => cliIn(root, ...args);
  const plugin = join(env.CLAUDE_CONFIG_DIR, "plugins", "cache", "litclaude-ai", "litclaude", version);
  const session = (sessionId, { hookRoot = plugin, source = "startup" } = {}) => {
    const result = spawnSync(process.execPath, [join(hookRoot, "bin", "litclaude-hook.js"), "session-start"], {
      cwd: project, encoding: "utf8", timeout: 60000, env,
      input: JSON.stringify({ hook_event_name: "SessionStart", session_id: sessionId, cwd: project, source }),
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const record = join(env.LITCLAUDE_HOME, "extensions-notice.json");
  return { path, project, env, cli, cliIn, plugin, session, record };
};

const install = (box) => {
  const result = box.cli("install", "--yes");
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout;
};

const hasNotice = (text) => NOTICE.every((line) => text.includes(line));

describe("LitFamily extensions notice", () => {
  it("prints after an install, in plain text, without the upgrade part on a clean machine", (t) => {
    const stdout = install(sandbox(t));
    assert.ok(hasNotice(stdout), stdout);
    assert.ok(!stdout.includes(UPGRADE), "a first install has nothing left behind");
    const notice = stdout.slice(stdout.indexOf("LitFamily extensions"));
    assert.ok(!notice.includes(ESC), "no colour codes");
    assert.ok(stdout.indexOf("INSTALL_PASS") < stdout.indexOf("LitFamily extensions"), "after the install result");
  });

  it("on an upgrade names the old version folders and runtime caches older versions left", (t) => {
    const box = sandbox(t);
    const oldCache = join(box.env.CLAUDE_CONFIG_DIR, "plugins", "cache", "litclaude-ai", "litclaude", "1.0.49");
    const oldCompat = join(box.env.LITCLAUDE_HOME, "litclaude-ai", "1.0.49");
    for (const dir of [oldCache, oldCompat, join(box.env.XDG_CACHE_HOME, "litclaude", "office-runtime"), join(box.env.XDG_CACHE_HOME, "litclaude", "motion-runtime")]) {
      mkdirSync(dir, { recursive: true });
    }
    const stdout = box.cli("update", "--yes").stdout;
    assert.ok(hasNotice(stdout), stdout);
    assert.ok(stdout.includes(UPGRADE), stdout);
    assert.ok(stdout.includes(`~/claude/plugins/cache/litclaude-ai/litclaude/ old versions 1.0.49 (keep ${version})`), stdout);
    assert.ok(stdout.includes(`~/lit/litclaude-ai/ old versions 1.0.49 (keep ${version})`), stdout);
    assert.ok(stdout.includes("~/cache/litclaude/office-runtime"), stdout);
    assert.ok(stdout.includes("~/cache/litclaude/motion-runtime"), stdout);
    assert.ok(!stdout.includes(`old versions ${version}`), "the running version is never offered for deletion");
  });

  it("lets old version folders go whatever the user decides about the extensions", () => {
    // Old version folders are dead weight either way; only the runtime caches serve the extensions.
    const text = extensionsNoticeLines({ leftovers: ["~/.cache/litclaude/office-runtime"] }).join(" ").replace(/\s+/gu, " ");
    assert.match(text, /old version folders can be deleted once older Claude Code sessions are closed/u);
    assert.match(text, /extensions reuse the runtime caches, so delete those only if you do not install them/u);
    assert.doesNotMatch(text, /delete all of these/u);
  });

  it("a dry run installs nothing and says nothing about extensions", (t) => {
    const result = sandbox(t).cli("--dry-run", "install");
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes("LitFamily extensions"));
  });

  it("shows once in the first session after an install, and again only after a version change", (t) => {
    const box = sandbox(t);
    install(box);
    const first = box.session("session-one");
    assert.ok(hasNotice(first.systemMessage), first.systemMessage);
    assert.ok(!first.systemMessage.includes(ESC), "no colour codes");
    assert.match(first.hookSpecificOutput.additionalContext, /The user was shown the LitFamily extensions notice/u);
    assert.equal(JSON.parse(readFileSync(box.record, "utf8")).version, version, "recorded in LitClaude's own home");

    const second = box.session("session-two");
    assert.ok(!String(second.systemMessage ?? "").includes("LitFamily extensions"), "shown once");
    assert.doesNotMatch(second.hookSpecificOutput.additionalContext, /extensions notice/u);

    writeFileSync(box.record, `${JSON.stringify({ version: "1.0.49" })}\n`);
    assert.ok(hasNotice(box.session("session-three").systemMessage), "a version change shows it again");
    assert.ok(!String(box.session("session-four", { source: "compact" }).systemMessage ?? "").includes("LitFamily extensions"));
  });

  it("names what older versions left in the first session after an upgrade", (t) => {
    const box = sandbox(t);
    install(box);
    mkdirSync(join(box.env.XDG_CACHE_HOME, "litclaude", "office-runtime"), { recursive: true });
    mkdirSync(join(box.env.LITCLAUDE_HOME, "litclaude-ai", "1.0.48"), { recursive: true });
    const message = box.session("session-upgrade").systemMessage;
    assert.ok(message.includes(UPGRADE), message);
    assert.ok(message.includes(`~/lit/litclaude-ai/ old versions 1.0.48 (keep ${version})`), message);
    assert.ok(message.includes("~/cache/litclaude/office-runtime"), message);
  });

  it("never shows from a checkout and never writes a record there", (t) => {
    const box = sandbox(t);
    mkdirSync(box.env.LITCLAUDE_HOME, { recursive: true });
    const output = box.session("session-checkout", { hookRoot: join(root, "plugins", "litclaude") });
    assert.ok(!String(output.systemMessage ?? "").includes("LitFamily extensions"));
    assert.equal(existsSync(box.record), false);
  });

  it("stays out of JSON results", (t) => {
    const box = sandbox(t);
    install(box);
    // From the sandbox project: rewind reports the git history of its folder, and this repository's own
    // commit messages may well mention extensions.
    for (const args of [["invite", "--json"], ["rewind", "--json"]]) {
      const result = box.cliIn(box.project, ...args);
      assert.doesNotThrow(() => JSON.parse(result.stdout), `${args.join(" ")}: ${result.stdout}`);
      assert.ok(!result.stdout.includes("LitFamily extensions"), args.join(" "));
    }
    const context = box.session("session-json").hookSpecificOutput.additionalContext;
    assert.ok(!context.includes("claude plugin install decks@wjgoarxiv-skills"), "the model context gets one sentence, not the notice");
  });
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// `litclaude-ai extensions` runs Claude Code's own plugin commands. Here a stand-in `claude` keeps the host's two
// records in a throwaway HOME, so each verb is checked against the same files the real host writes.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE = join(root, "test", "helpers", "fake-claude-plugins.mjs");
const FAMILIES = {
  decks: ["lit-pptx"],
  documents: ["lit-docx"],
  figures: ["lit-diagram-drawer", "lit-schematic", "lit-scientific-visualization"],
  design: ["frontend-ui-ux", "visual-qa"],
  "video-covers": ["lit-typographic-motion", "readme-studio"],
};

const writeShelf = (dir, versions = {}) => {
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "marketplace.json"), JSON.stringify({
    name: "wjgoarxiv-skills",
    plugins: Object.keys(FAMILIES).map((name) => ({ name, source: `./plugins/${name}` })),
  }));
  for (const [family, ids] of Object.entries(FAMILIES)) {
    const plugin = join(dir, "plugins", family);
    mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
    writeFileSync(join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: family, version: versions[family] ?? "0.1.0" }));
    for (const id of ids) {
      mkdirSync(join(plugin, "skills", id), { recursive: true });
      writeFileSync(join(plugin, "skills", id, "SKILL.md"), `---\nname: ${id}\n---\n${versions[family] ?? "0.1.0"}\n`);
    }
  }
};

const sandbox = (t) => {
  const path = mkdtempSync(join(tmpdir(), "litclaude-ext-cli-"));
  t.after(() => rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const bin = join(path, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec '${process.execPath}' '${FAKE}' "$@"\n`);
  chmodSync(join(bin, "claude"), 0o755);
  const project = join(path, "project");
  mkdirSync(project);
  const shelf = join(path, "shelf");
  writeShelf(shelf);
  const claude = join(path, "claude");
  const log = join(path, "host.log");
  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    HOME: path,
    CLAUDE_CONFIG_DIR: claude,
    CLAUDE_HOME: claude,
    LITCLAUDE_HOME: join(path, "lit"),
    XDG_CACHE_HOME: join(path, "cache"),
    FAKE_CLAUDE_LOG: log,
    CI: "1",
    NO_COLOR: "1",
    LITCLAUDE_NO_UPDATE_CHECK: "1",
    LITCLAUDE_NO_AUTO_UPDATE: "1",
  };
  const run = (...args) => spawnSync(process.execPath, [join(root, "bin", "litclaude-ai.js"), "--no-auto-update", "extensions", ...args], {
    cwd: project, encoding: "utf8", timeout: 60000, env,
  });
  const hostCalls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter((line) => line && line !== "--version") : []);
  const registry = () => {
    const file = join(claude, "plugins", "installed_plugins.json");
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).plugins : {};
  };
  const ownSkill = (base, id) => {
    const dir = join(base, "skills", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${id}\n---\nmy own\n`);
    writeFileSync(join(dir, "notes.txt"), "keep me\n");
    return dir;
  };
  return { path, project, shelf, claude, env, run, hostCalls, registry, ownSkill };
};

const ok = (result) => {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
};

describe("litclaude-ai extensions", () => {
  it("lists the nine extensions as not installed on a fresh machine, also as JSON", (t) => {
    const box = sandbox(t);
    const text = ok(box.run("list"));
    for (const ids of Object.values(FAMILIES)) for (const id of ids) assert.match(text, new RegExp(`${id}\\s+\\S+\\s+not installed`, "u"));
    assert.match(text, /Marketplace: not added/u);
    const json = JSON.parse(ok(box.run("list", "--json")));
    assert.equal(json.extensions.length, 9);
    assert.ok(json.extensions.every((row) => row.state === "not installed"));
    assert.deepEqual(box.hostCalls(), []);
  });

  it("install only prints its plan without --yes, then runs the host lines with --yes", (t) => {
    const box = sandbox(t);
    const plan = ok(box.run("install", "decks", "--from", box.shelf));
    assert.ok(plan.includes(`claude plugin marketplace add ${box.shelf}`), plan);
    assert.ok(plan.includes("claude plugin install decks@wjgoarxiv-skills"), plan);
    assert.match(plan, /Nothing changed\. Add --yes/u);
    assert.deepEqual(box.hostCalls(), [], "a dry run calls no host command");
    assert.deepEqual(box.registry(), {});

    const done = ok(box.run("install", "lit-pptx", "--from", box.shelf, "--yes"));
    assert.match(done, /installed decks@wjgoarxiv-skills 0\.1\.0/u);
    assert.deepEqual(box.hostCalls(), [`plugin marketplace add ${box.shelf}`, "plugin install decks@wjgoarxiv-skills"]);
    assert.equal(box.registry()["decks@wjgoarxiv-skills"][0].version, "0.1.0");
    const list = ok(box.run("list"));
    assert.match(list, /lit-pptx\s+decks\s+installed 0\.1\.0 \(user, \d{4}-\d\d-\d\d\)/u);
    assert.ok(list.includes(`Marketplace: wjgoarxiv-skills from ${box.shelf}`), list);
    assert.match(ok(box.run("install", "decks", "--yes")), /already installed \(0\.1\.0\)/u);
  });

  it("stops at a same-name skill of the user's own, names it, and installs once it is moved aside", (t) => {
    const box = sandbox(t);
    const personal = box.ownSkill(box.claude, "lit-pptx");
    const project = box.ownSkill(join(box.project, ".claude"), "lit-pptx");
    const stopped = box.run("install", "decks", "--from", box.shelf, "--yes");
    assert.equal(stopped.status, 1, stopped.stdout);
    assert.match(stopped.stderr, /Stopped: a skill of your own has the name of an extension/u);
    assert.ok(stopped.stderr.includes("~/claude/skills/lit-pptx would compete with decks:lit-pptx"), stopped.stderr);
    assert.ok(stopped.stderr.includes("~/project/.claude/skills/lit-pptx would compete with decks:lit-pptx"), stopped.stderr);
    assert.deepEqual(box.hostCalls(), [], "nothing ran");
    assert.ok(existsSync(join(personal, "notes.txt")) && existsSync(join(project, "notes.txt")), "never touched");

    const moves = stopped.stderr.split("\n").filter((line) => line.trim().startsWith("d=")).map((line) => line.trim());
    assert.equal(moves.length, 2);
    for (const line of moves) {
      const moved = spawnSync("bash", ["-c", line], { cwd: box.project, env: box.env, encoding: "utf8" });
      assert.equal(moved.status, 0, moved.stderr);
    }
    assert.ok(!existsSync(personal) && !existsSync(project));
    const [stamp] = readdirSync(join(box.claude, "extension-backups"));
    assert.equal(readFileSync(join(box.claude, "extension-backups", stamp, "lit-pptx", "notes.txt"), "utf8"), "keep me\n");

    ok(box.run("install", "decks", "--from", box.shelf, "--yes"));
    const check = box.run("check");
    assert.equal(check.status, 0, check.stdout);
    assert.match(check.stdout, /Nothing needs action/u);
    assert.match(check.stdout, /note: 2 backup folder\(s\) in extension-backups/u);
  });

  it("--allow-shadow installs beside a same-name skill with a warning, and check then reports it", (t) => {
    const box = sandbox(t);
    const personal = box.ownSkill(box.claude, "visual-qa");
    const result = box.run("install", "design", "--from", box.shelf, "--yes", "--allow-shadow");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Warning: these skills of your own will load beside the extension/u);
    assert.ok(existsSync(join(personal, "notes.txt")));
    const check = box.run("check");
    assert.equal(check.status, 1);
    assert.match(check.stdout, /NEEDS ACTION: ~\/claude\/skills\/visual-qa competes with design:visual-qa/u);
    assert.match(check.stdout, /fix: d="\$HOME\/claude\/extension-backups\/\$\(date \+%Y%m%d-%H%M%S\)"; mkdir -p "\$d" && mv "\$HOME\/claude\/skills\/visual-qa" "\$d"\//u);
    assert.match(ok(box.run("list")), /visual-qa\s+design\s+installed 0\.1\.0[^\n]*\n\s+competes with ~\/claude\/skills\/visual-qa \(personal\)/u);
  });

  it("update refreshes the shelf first, installs a changed version, and reports current otherwise", (t) => {
    const box = sandbox(t);
    ok(box.run("install", "decks", "figures", "--from", box.shelf, "--yes"));
    writeShelf(box.shelf, { decks: "0.1.1" });
    const plan = ok(box.run("update"));
    assert.match(plan, /claude plugin marketplace update wjgoarxiv-skills\n\s+claude plugin update decks@wjgoarxiv-skills\n\s+claude plugin update figures@wjgoarxiv-skills/u);
    const before = box.hostCalls().length;
    const done = ok(box.run("update", "--yes"));
    assert.deepEqual(box.hostCalls().slice(before), [
      "plugin marketplace update wjgoarxiv-skills",
      "plugin update decks@wjgoarxiv-skills",
      "plugin update figures@wjgoarxiv-skills",
    ]);
    assert.match(done, /updated decks@wjgoarxiv-skills 0\.1\.0 -> 0\.1\.1/u);
    assert.match(done, /current figures@wjgoarxiv-skills 0\.1\.0/u);
    assert.match(ok(box.run("update", "decks", "--yes")), /current decks@wjgoarxiv-skills 0\.1\.1/u);
  });

  it("remove uninstalls through the host and refuses a skill folder of the user's own", (t) => {
    const box = sandbox(t);
    ok(box.run("install", "decks", "--from", box.shelf, "--yes"));
    const own = box.ownSkill(box.claude, "lit-docx");
    const refused = box.run("remove", "lit-docx", "--yes");
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Refused: ~\/claude\/skills\/lit-docx is a skill of your own/u);
    assert.ok(existsSync(join(own, "notes.txt")));
    assert.ok(!box.hostCalls().some((line) => line.includes("uninstall")));

    const plan = ok(box.run("remove", "decks"));
    assert.match(plan, /claude plugin uninstall decks@wjgoarxiv-skills/u);
    assert.ok(box.registry()["decks@wjgoarxiv-skills"], "the dry run keeps it");
    assert.match(ok(box.run("remove", "decks", "--yes")), /removed decks@wjgoarxiv-skills/u);
    assert.equal(box.registry()["decks@wjgoarxiv-skills"], undefined);
    assert.match(ok(box.run("remove", "lit-schematic", "--yes")), /figures@wjgoarxiv-skills is not installed/u);
  });

  it("prune-backups lists dated backups with sizes and deletes them only with --yes", (t) => {
    const box = sandbox(t);
    const backups = join(box.claude, "extension-backups");
    const oldOne = join(backups, "20260101-120000");
    const newOne = join(backups, "20261112-120000");
    for (const dir of [oldOne, newOne]) {
      mkdirSync(join(dir, "lit-pptx"), { recursive: true });
      writeFileSync(join(dir, "lit-pptx", "SKILL.md"), "x".repeat(2048));
    }
    const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    utimesSync(oldOne, past, past);
    mkdirSync(join(box.path, "elsewhere"));
    symlinkSync(join(box.path, "elsewhere"), join(backups, "20260101-000000"));

    const dry = ok(box.run("prune-backups"));
    assert.ok(dry.includes(`${oldOne}  2.0 KiB, 40 day(s) old, holds lit-pptx`), dry);
    assert.ok(dry.includes(`left alone (not a dated backup folder): ${join(backups, "20260101-000000")}`), dry);
    assert.match(dry, /Would delete 2 folder\(s\), 4\.0 KiB\. Nothing changed/u);
    assert.ok(existsSync(oldOne) && existsSync(newOne));

    const older = ok(box.run("prune-backups", "--older-than", "30", "--yes"));
    assert.ok(older.includes(`deleted ${oldOne}`), older);
    assert.ok(older.includes(`kept (newer): ${newOne}`), older);
    assert.ok(!existsSync(oldOne) && existsSync(newOne));
    assert.ok(existsSync(join(box.path, "elsewhere")), "a symlink target is never followed");
  });

  it("stops before any change when the shelf cannot be fetched or --from is not a clone", (t) => {
    const box = sandbox(t);
    const offline = box.run("install", "decks", "--yes");
    assert.equal(offline.status, 1);
    assert.match(offline.stderr, /Stopped: `claude plugin marketplace add wjgoarxiv\/wjgoarxiv-skills` failed, so no plugin was installed or updated/u);
    assert.match(offline.stderr, /--from <path to a wjgoarxiv-skills clone>/u);
    assert.deepEqual(box.hostCalls(), ["plugin marketplace add wjgoarxiv/wjgoarxiv-skills"], "no install after a failed shelf");
    assert.deepEqual(box.registry(), {});

    const wrong = box.run("install", "decks", "--from", join(box.path, "missing"), "--yes");
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /is not a wjgoarxiv-skills clone/u);

    ok(box.run("install", "decks", "--from", box.shelf, "--yes"));
    rmSync(box.shelf, { recursive: true });
    const gone = box.run("update", "--yes");
    assert.equal(gone.status, 1);
    assert.match(gone.stderr, /points at .*which no longer exists/u);
    const check = box.run("check");
    assert.equal(check.status, 1);
    assert.match(check.stdout, /fix: claude plugin marketplace add wjgoarxiv\/wjgoarxiv-skills/u);
  });

  it("help names the extensions verbs, and an unknown verb or option is refused", (t) => {
    const box = sandbox(t);
    const help = spawnSync(process.execPath, [join(root, "bin", "litclaude-ai.js"), "--help"], { encoding: "utf8", env: box.env });
    assert.match(help.stdout, /extensions <list\|check\|install\|update\|remove\|prune-backups>/u);
    assert.match(ok(box.run("--help")), /prune-backups \[--older-than <days>\]/u);
    assert.equal(box.run("frobnicate").status, 64);
    assert.equal(box.run("install", "decks", "--force").status, 64);
    assert.equal(box.run("install", "slides").status, 64);
  });
});

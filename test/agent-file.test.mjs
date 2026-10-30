// The LitFamily block in the global CLAUDE.md: a marker-delimited section LitClaude adds on install,
// refreshes on update and removes on uninstall, never touching the user's own text. `agent-file
// project` writes the project block into AGENTS.md for `lit init`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AGENT_FILE_MAX_BYTES,
  agentFileBody,
  agentFileState,
  applyAgentFile,
  readAgentFileMode,
  writeAgentFileMode,
} from "../plugins/litclaude/lib/agent-file/apply.mjs";
import { inspectBlock, removeBlock, upsertBlock } from "../plugins/litclaude/lib/agent-file/managed-block.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(root, "bin", "litclaude-ai.js");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const START = (id, v) => `<!-- litfamily:${id}:start v=${v} -->`;
const END = (id) => `<!-- litfamily:${id}:end -->`;
const block = { id: "litclaude", version: "9.1.0", body: "## LitFamily\n\n- rule one\n" };

const withDir = (fn) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-agent-file-")));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("managed block on text", () => {
  it("adds the block to an empty file and to the end of user text, keeping the user's bytes", () => {
    const empty = upsertBlock("", block);
    assert.equal(empty.changed, true);
    assert.equal(empty.text, `${START("litclaude", "9.1.0")}\n## LitFamily\n\n- rule one\n${END("litclaude")}\n`);
    const mine = upsertBlock("# Mine\n\nmy rule\n", block);
    assert.ok(mine.text.startsWith("# Mine\n\nmy rule\n\n<!-- litfamily:litclaude:start"));
    assert.deepEqual(inspectBlock(mine.text, "litclaude"), { state: "present", version: "9.1.0", created: false });
  });

  it("is idempotent and replaces only the bytes between its markers", () => {
    const first = upsertBlock("mine\n", block).text;
    assert.deepEqual(upsertBlock(first, block), { text: first, changed: false });
    const withAfter = `${first}\nafter the block\n`;
    const next = upsertBlock(withAfter, { ...block, version: "9.1.1", body: "## LitFamily\n\n- rule two\n" });
    assert.equal(next.changed, true);
    assert.ok(next.text.startsWith("mine\n\n"));
    assert.ok(next.text.endsWith("\nafter the block\n"));
    assert.match(next.text, /rule two/u);
    assert.doesNotMatch(next.text, /rule one/u);
    assert.equal(inspectBlock(next.text, "litclaude").version, "9.1.1");
  });

  it("removes exactly what it added", () => {
    for (const original of ["mine\n", "# Title\n\nline\n\n", "", "no newline at the end", "mixed\r\nendings\n"]) {
      const added = upsertBlock(original, block).text;
      assert.equal(removeBlock(added, "litclaude").text, original, JSON.stringify(original));
      const refreshed = upsertBlock(added, { ...block, version: "2.0.0", body: "## LitFamily\n\n- newer\n" }).text;
      assert.equal(removeBlock(refreshed, "litclaude").text, original, `after a refresh: ${JSON.stringify(original)}`);
    }
    const added = upsertBlock("mine\n", block).text;
    assert.equal(removeBlock(`${added}tail\n`, "litclaude").text, "mine\ntail\n");
    assert.deepEqual(removeBlock("no block here\n", "litclaude"), { text: "no block here\n", changed: false, created: false });
  });

  it("keeps Windows line endings and leaves another product's block alone", () => {
    const crlf = "mine\r\nsecond\r\n";
    const added = upsertBlock(crlf, block).text;
    assert.ok(!/[^\r]\n/u.test(added), "every new line ends with CRLF");
    assert.equal(removeBlock(added, "litclaude").text, crlf);
    const other = upsertBlock("mine\n", { id: "litmuse", version: "0.1.4", body: "muse rules\n" }).text;
    const both = upsertBlock(other, block).text;
    assert.match(both, /muse rules/u);
    assert.equal(removeBlock(both, "litclaude").text, other);
  });

  it("refuses a malformed marker pair instead of guessing", () => {
    const start = START("litclaude", "9.1.0");
    for (const text of [`${start}\nbody\n`, `${END("litclaude")}\n${start}\n`, `${start}\n${start}\n${END("litclaude")}\n`]) {
      assert.equal(inspectBlock(text, "litclaude").state, "malformed");
      assert.throws(() => upsertBlock(text, block), /malformed/u);
      assert.throws(() => removeBlock(text, "litclaude"), /malformed/u);
    }
  });
});

describe("agent file on disk", () => {
  it("creates a missing file, backs up an existing one once, and writes nothing on a repeat or dry run", () => withDir((dir) => {
    const fresh = join(dir, "fresh", "CLAUDE.md");
    assert.equal(applyAgentFile({ path: fresh, ...block, action: "install" }).status, "created");
    assert.equal(readdirSync(join(dir, "fresh")).length, 1, "no backup for a file that did not exist");

    const path = join(dir, "CLAUDE.md");
    writeFileSync(path, "mine\n");
    const dry = applyAgentFile({ path, ...block, action: "install", dryRun: true });
    assert.equal(dry.status, "dry-run");
    assert.match(dry.preview, /litfamily:litclaude:start/u);
    assert.equal(readFileSync(path, "utf8"), "mine\n");

    const first = applyAgentFile({ path, ...block, action: "install", now: new Date("2026-10-30T00:00:00Z") });
    assert.equal(first.status, "updated");
    assert.equal(readFileSync(first.backup, "utf8"), "mine\n");
    assert.equal(applyAgentFile({ path, ...block, action: "install" }).status, "unchanged");
    assert.equal(readdirSync(dir).filter((name) => name.includes("litfamily-backup")).length, 1);
  }));

  it("uninstall restores the user's file byte for byte, and deletes a file it alone created", () => withDir((dir) => {
    const path = join(dir, "CLAUDE.md");
    writeFileSync(path, "# Mine\r\n\r\nkeep me\r\n");
    applyAgentFile({ path, ...block, action: "install" });
    assert.equal(applyAgentFile({ path, ...block, action: "uninstall" }).status, "removed");
    assert.equal(readFileSync(path, "utf8"), "# Mine\r\n\r\nkeep me\r\n");
    assert.equal(applyAgentFile({ path, ...block, action: "uninstall" }).status, "absent");

    const own = join(dir, "own", "CLAUDE.md");
    applyAgentFile({ path: own, ...block, action: "install" });
    applyAgentFile({ path: own, ...block, action: "uninstall" });
    assert.equal(existsSync(own), false);

    const empty = join(dir, "empty.md");
    writeFileSync(empty, "");
    applyAgentFile({ path: empty, ...block, action: "install" });
    applyAgentFile({ path: empty, ...block, action: "uninstall" });
    assert.equal(readFileSync(empty, "utf8"), "", "an empty file the user had stays, empty");
  }));

  it("keeps the file mode, leaves no staging file, and refuses text that is not UTF-8", () => withDir((dir) => {
    const path = join(dir, "CLAUDE.md");
    writeFileSync(path, "mine\n", { mode: 0o600 });
    chmodSync(path, 0o600);
    applyAgentFile({ path, ...block, action: "install" });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(dir).filter((name) => name.endsWith(".tmp")), []);

    for (const [name, bytes] of [["latin1.md", Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])], ["utf16.md", Buffer.from([0xff, 0xfe, 0x61, 0x00, 0x0a, 0x00])]]) {
      const file = join(dir, name);
      writeFileSync(file, bytes);
      assert.equal(applyAgentFile({ path: file, ...block, action: "install" }).status, "refused-not-utf8", name);
      assert.deepEqual(readFileSync(file), bytes);
    }
  }));

  it("refuses a symlinked file and a malformed block without writing", () => withDir((dir) => {
    const target = join(dir, "real.md");
    writeFileSync(target, "real\n");
    const link = join(dir, "CLAUDE.md");
    symlinkSync(target, link);
    assert.equal(applyAgentFile({ path: link, ...block, action: "install" }).status, "refused-symlink");
    assert.equal(readFileSync(target, "utf8"), "real\n");

    const broken = join(dir, "broken.md");
    writeFileSync(broken, `${START("litclaude", "9.1.0")}\nhalf\n`);
    assert.equal(applyAgentFile({ path: broken, ...block, action: "install" }).status, "refused-malformed");
    assert.equal(readFileSync(broken, "utf8"), `${START("litclaude", "9.1.0")}\nhalf\n`);
  }));

  it("reports present, stale, absent and malformed", () => withDir((dir) => {
    const path = join(dir, "CLAUDE.md");
    assert.equal(agentFileState({ path, id: "litclaude", version: "9.1.0" }), "absent");
    applyAgentFile({ path, ...block, action: "install" });
    assert.equal(agentFileState({ path, id: "litclaude", version: "9.1.0" }), "present v=9.1.0");
    assert.equal(agentFileState({ path, id: "litclaude", version: "2.0.0" }), "stale v=9.1.0");
    writeFileSync(path, `${START("litclaude", "9.1.0")}\n`);
    assert.equal(agentFileState({ path, id: "litclaude", version: "9.1.0" }), "malformed");
    const link = join(dir, "linked.md");
    symlinkSync(path, link);
    assert.equal(agentFileState({ path: link, id: "litclaude", version: "9.1.0" }), "symlink");
  }));

  it("keeps the on/off setting in config.json beside the other keys, with an env override", () => withDir((litHome) => {
    writeFileSync(join(litHome, "config.json"), `${JSON.stringify({ mark: "off" })}\n`);
    assert.equal(readAgentFileMode({ env: {}, litHome }), "on");
    writeAgentFileMode(litHome, "off");
    assert.deepEqual(JSON.parse(readFileSync(join(litHome, "config.json"), "utf8")), { mark: "off", agentFile: "off" });
    assert.equal(readAgentFileMode({ env: {}, litHome }), "off");
    assert.equal(readAgentFileMode({ env: { LITCLAUDE_AGENT_FILE: "on" }, litHome }), "on");
    writeFileSync(join(litHome, "config.json"), "{ not json");
    assert.throws(() => writeAgentFileMode(litHome, "on"), /config\.json/u);
    assert.equal(readFileSync(join(litHome, "config.json"), "utf8"), "{ not json", "an unreadable config is never overwritten");
  }));

  it("ships short bodies that name the off switch", () => {
    for (const kind of ["global", "project"]) {
      const body = agentFileBody(kind);
      assert.ok(Buffer.byteLength(body, "utf8") <= AGENT_FILE_MAX_BYTES, `${kind} body is ${Buffer.byteLength(body, "utf8")} bytes`);
      assert.match(body, /^## LitFamily/u);
    }
    assert.match(agentFileBody("global"), /litclaude-ai config agentFile off/u);
  });
});

describe("installer, doctor, config and project surfaces", () => {
  const baseEnv = { ...process.env };
  for (const key of ["CLAUDE_CONFIG_DIR", "LITCLAUDE_AGENT_FILE", "LITCLAUDE_AGENT_FILE_PROMPT", "LITCLAUDE_ATTRIBUTION", "LITCLAUDE_ATTRIBUTION_PROMPT"]) delete baseEnv[key];
  const cli = (args, { litHome, claudeHome, cwd = root, env = {} }) => spawnSync(process.execPath, [binPath, "--no-auto-update", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...baseEnv, HOME: join(litHome, ".."), LITCLAUDE_MOTION_PREWARM: "0", LITCLAUDE_HOME: litHome, CLAUDE_HOME: claudeHome, ...env },
  });
  const homes = (dir) => ({ litHome: join(dir, "lit"), claudeHome: join(dir, "claude") });

  it("install --yes adds the block, doctor sees it, uninstall gives the user's file back", { timeout: 300_000 }, () => withDir((dir) => {
    const h = homes(dir);
    mkdirSync(h.claudeHome, { recursive: true });
    const path = join(h.claudeHome, "CLAUDE.md");
    writeFileSync(path, "# My rules\n\n- be brief\n");
    const install = cli(["install", "--yes"], h);
    assert.equal(install.status, 0, install.stderr);
    assert.match(install.stdout, /AGENT_FILE: updated/u);
    assert.ok(readFileSync(path, "utf8").startsWith("# My rules\n\n- be brief\n\n<!-- litfamily:litclaude:start"));
    assert.match(cli(["doctor"], h).stdout, new RegExp(`AGENT_FILE: present v=${version.replaceAll(".", "\\.")}`, "u"));
    assert.equal(cli(["install", "--yes"], h).status, 0);
    assert.equal(readFileSync(path, "utf8").split("litfamily:litclaude:start").length, 2, "one block after two installs");
    const uninstall = cli(["uninstall"], h);
    assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.equal(readFileSync(path, "utf8"), "# My rules\n\n- be brief\n");
  }));

  it("a non-interactive install without --yes, --no-agent-file and a dry run leave CLAUDE.md alone", { timeout: 300_000 }, () => withDir((dir) => {
    const h = homes(dir);
    const path = join(h.claudeHome, "CLAUDE.md");
    const quiet = cli(["install"], h);
    assert.equal(quiet.status, 0, quiet.stderr);
    assert.match(quiet.stdout, /AGENT_FILE: skipped/u);
    assert.equal(existsSync(path), false);
    assert.equal(cli(["install", "--yes", "--no-agent-file"], h).status, 0);
    assert.equal(existsSync(path), false);
    const dry = cli(["--dry-run", "install"], h);
    assert.match(dry.stdout, /Would add the LitFamily block to .*CLAUDE\.md/u);
    assert.equal(existsSync(path), false);
  }));

  it("config agentFile off removes the block and keeps it off; on writes it back", { timeout: 300_000 }, () => withDir((dir) => {
    const h = homes(dir);
    const path = join(h.claudeHome, "CLAUDE.md");
    assert.equal(cli(["install", "--yes"], h).status, 0);
    assert.equal(existsSync(path), true);
    const off = cli(["config", "agentFile", "off"], h);
    assert.equal(off.status, 0, off.stderr);
    assert.equal(existsSync(path), false, "the file only held our block");
    assert.equal(cli(["install", "--yes"], h).status, 0);
    assert.equal(existsSync(path), false);
    assert.match(cli(["doctor"], h).stdout, /AGENT_FILE: off/u);
    assert.equal(cli(["config", "agentFile", "on"], h).status, 0);
    assert.match(readFileSync(path, "utf8"), /litfamily:litclaude:start/u);
    assert.equal(cli(["config", "agentFile", "maybe"], h).status, 64);
  }));

  it("agent-file project writes the project block into AGENTS.md and a CLAUDE.md that imports it", () => withDir((dir) => {
    const h = homes(dir);
    const repo = join(dir, "repo");
    mkdirSync(repo);
    writeFileSync(join(repo, "AGENTS.md"), "# Repo\n\nbuild with make\n");
    const run = cli(["agent-file", "project", "--dir", repo], h);
    assert.equal(run.status, 0, run.stderr);
    const agents = readFileSync(join(repo, "AGENTS.md"), "utf8");
    assert.ok(agents.startsWith("# Repo\n\nbuild with make\n\n<!-- litfamily:litclaude:start"));
    assert.equal(readFileSync(join(repo, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");

    const other = join(dir, "other");
    mkdirSync(other);
    writeFileSync(join(other, "CLAUDE.md"), "own claude rules\n");
    const kept = cli(["agent-file", "project", "--dir", other], h);
    assert.equal(kept.status, 0, kept.stderr);
    assert.equal(readFileSync(join(other, "CLAUDE.md"), "utf8"), "own claude rules\n");
    assert.match(kept.stdout, /add `@AGENTS\.md`/u);
    assert.deepEqual(readdirSync(other).filter((name) => name.includes("litfamily-backup")), [], "no backup file left in a repo");

    const odd = join(dir, "odd");
    mkdirSync(join(odd, "CLAUDE.md"), { recursive: true });
    const dirClaude = cli(["agent-file", "project", "--dir", odd], h);
    assert.equal(dirClaude.status, 0, dirClaude.stderr);
    assert.match(dirClaude.stdout, /AGENT_FILE: refused-not-file .*CLAUDE\.md/u);

    const typo = cli(["agent-file", "project", "--dir", join(dir, "no-such-repo")], h);
    assert.equal(typo.status, 64);
    assert.equal(existsSync(join(dir, "no-such-repo")), false, "a mistyped --dir is never created");
  }));
});

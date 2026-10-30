// The attribution switch: `keep` (default) leaves Claude Code's own Co-Authored-By and PR line as they
// are; `off` hides them through Claude Code's native `attribution` setting and adds one line to the
// LitFamily block. LitClaude remembers what the setting was before it changed it and puts that back.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { AGENT_FILE_MAX_BYTES, agentFileBody } from "../plugins/litclaude/lib/agent-file/apply.mjs";
import {
  ATTRIBUTION_LINE,
  HIDDEN_ATTRIBUTION,
  applyAttribution,
  readAttributionMode,
  restoreAttribution,
  writeAttributionMode,
} from "../plugins/litclaude/lib/agent-file/attribution.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(root, "bin", "litclaude-ai.js");

const withDir = (fn) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-attribution-")));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("attribution setting on settings.json data", () => {
  it("off hides all three parts and remembers that nothing was set before", () => {
    const settings = { theme: "dark" };
    const record = {};
    applyAttribution(settings, record);
    assert.deepEqual(settings.attribution, HIDDEN_ATTRIBUTION);
    assert.deepEqual(HIDDEN_ATTRIBUTION, { commit: "", pr: "", sessionUrl: false });
    restoreAttribution(settings, record);
    assert.deepEqual(settings, { theme: "dark" });
    assert.deepEqual(record, {});
  });

  it("puts the user's own value back exactly, even after two offs", () => {
    const own = { commit: "Signed-off-by: me", pr: "" };
    const settings = { attribution: structuredClone(own) };
    const record = {};
    applyAttribution(settings, record);
    applyAttribution(settings, record);
    assert.deepEqual(settings.attribution, HIDDEN_ATTRIBUTION);
    restoreAttribution(settings, record);
    assert.deepEqual(settings.attribution, own);
  });

  it("restore leaves a value LitClaude never wrote alone", () => {
    const settings = { attribution: { pr: "mine" } };
    restoreAttribution(settings, {});
    assert.deepEqual(settings.attribution, { pr: "mine" });
  });

  it("a value the user set after the hide survives keep, uninstall and the next install", () => {
    const settings = {};
    const record = {};
    applyAttribution(settings, record);
    settings.attribution = { commit: "Reviewed-by: me" };
    assert.equal(applyAttribution(settings, record), "user-changed");
    assert.deepEqual(settings.attribution, { commit: "Reviewed-by: me" });
    restoreAttribution(settings, record);
    assert.deepEqual(settings.attribution, { commit: "Reviewed-by: me" });
    assert.deepEqual(record, {});
  });

  it("keeps the mode in config.json, keep by default, with an env override", () => withDir((litHome) => {
    assert.equal(readAttributionMode({ env: {}, litHome }), "keep");
    writeAttributionMode(litHome, "off");
    assert.equal(readAttributionMode({ env: {}, litHome }), "off");
    assert.equal(readAttributionMode({ env: { LITCLAUDE_ATTRIBUTION: "keep" }, litHome }), "keep");
    assert.throws(() => writeAttributionMode(litHome, "maybe"), /attribution takes one of/u);
  }));

  it("adds the attribution line to both blocks only when off, within the size cap", () => {
    for (const kind of ["global", "project"]) {
      assert.doesNotMatch(agentFileBody(kind), /Co-Authored-By/u);
      const off = agentFileBody(kind, { attribution: "off" });
      assert.ok(off.includes(ATTRIBUTION_LINE), kind);
      assert.ok(Buffer.byteLength(off, "utf8") <= AGENT_FILE_MAX_BYTES, kind);
    }
    assert.ok(agentFileBody("global", { attribution: "off" }).includes(`${ATTRIBUTION_LINE}\n- Turn this block off`), "the line sits before the off switch");
  });
});

describe("attribution through the CLI", () => {
  const baseEnv = { ...process.env };
  for (const key of ["CLAUDE_CONFIG_DIR", "LITCLAUDE_AGENT_FILE", "LITCLAUDE_AGENT_FILE_PROMPT", "LITCLAUDE_ATTRIBUTION", "LITCLAUDE_ATTRIBUTION_PROMPT"]) delete baseEnv[key];
  const cli = (args, { litHome, claudeHome }) => spawnSync(process.execPath, [binPath, "--no-auto-update", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...baseEnv, LITCLAUDE_HOME: litHome, CLAUDE_HOME: claudeHome },
  });
  const homes = (dir) => ({ litHome: join(dir, "lit"), claudeHome: join(dir, "claude") });
  const settingsOf = (h) => JSON.parse(readFileSync(join(h.claudeHome, "settings.json"), "utf8"));

  it("install --yes changes nothing about attribution; doctor says keep", { timeout: 300_000 }, () => withDir((dir) => {
    const h = homes(dir);
    assert.equal(cli(["install", "--yes"], h).status, 0);
    assert.equal(settingsOf(h).attribution, undefined);
    assert.match(cli(["doctor"], h).stdout, /ATTRIBUTION: keep/u);
  }));

  it("config attribution off hides it and adds the block line; keep and uninstall put the user's value back", { timeout: 300_000 }, () => withDir((dir) => {
    const h = homes(dir);
    mkdirSync(h.claudeHome, { recursive: true });
    writeFileSync(join(h.claudeHome, "settings.json"), `${JSON.stringify({ attribution: { pr: "mine" } })}\n`);
    assert.equal(cli(["install", "--yes"], h).status, 0);
    const off = cli(["config", "attribution", "off"], h);
    assert.equal(off.status, 0, off.stderr);
    assert.deepEqual(settingsOf(h).attribution, { commit: "", pr: "", sessionUrl: false });
    assert.ok(readFileSync(join(h.claudeHome, "CLAUDE.md"), "utf8").includes(ATTRIBUTION_LINE));
    assert.match(cli(["doctor"], h).stdout, /ATTRIBUTION: off/u);

    assert.equal(cli(["config", "attribution", "keep"], h).status, 0);
    assert.deepEqual(settingsOf(h).attribution, { pr: "mine" });
    assert.ok(!readFileSync(join(h.claudeHome, "CLAUDE.md"), "utf8").includes(ATTRIBUTION_LINE));

    assert.equal(cli(["config", "attribution", "off"], h).status, 0);
    assert.equal(cli(["uninstall"], h).status, 0);
    assert.deepEqual(settingsOf(h).attribution, { pr: "mine" });
    assert.equal(cli(["config", "attribution", "sometimes"], h).status, 64);
  }));
});

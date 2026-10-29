import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { MARK_MODES, generatorString, markConfigPath, readMarkMode, writeMarkMode } from "../plugins/litclaude/lib/mark.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const binPath = join(root, "bin", "litclaude-ai.js");
const libDir = join(root, "plugins", "litclaude", "lib");
const version = JSON.parse(readFileSync(join(root, "plugins", "litclaude", ".claude-plugin", "plugin.json"), "utf8")).version;

const tempHome = () => mkdtempSync(join(tmpdir(), "litclaude-mark-"));
const config = (litHome, claudeHome, ...args) => spawnSync(process.execPath, [binPath, "config", ...args], {
  encoding: "utf8",
  env: { ...process.env, LITCLAUDE_HOME: litHome, CLAUDE_CONFIG_DIR: claudeHome, LITCLAUDE_NO_AUTO_UPDATE: "1", LITCLAUDE_MARK: "" },
});
const pyMode = (litHome, mark) => spawnSync("python3", ["-I", "-B", "-c", "import sys; sys.path.insert(0, sys.argv[1]); import output_mark; print(output_mark.mode()); print(output_mark.generator())", libDir], {
  encoding: "utf8",
  env: { ...process.env, LITCLAUDE_HOME: litHome, LITCLAUDE_MARK: mark ?? "" },
});

describe("mark setting", () => {
  it("defaults to on with no stored config", () => {
    const home = tempHome();
    try {
      assert.deepEqual(MARK_MODES, ["on", "meta", "off"]);
      assert.equal(readMarkMode({ env: {}, litHome: home }), "on");
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it("stores each value through `config mark` in LitClaude's own config, never in Claude settings", () => {
    const home = tempHome();
    const claude = join(home, "claude");
    try {
      for (const value of MARK_MODES) {
        const r = config(home, claude, "mark", value);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, new RegExp(`MARK: ${value}`, "u"));
        assert.equal(readMarkMode({ env: {}, litHome: home }), value);
        assert.equal(JSON.parse(readFileSync(markConfigPath(home), "utf8")).mark, value);
      }
      assert.equal(existsSync(join(claude, "settings.json")), false);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it("lets LITCLAUDE_MARK override the stored value for one run", () => {
    const home = tempHome();
    try {
      writeMarkMode(home, "off");
      assert.equal(readMarkMode({ env: { LITCLAUDE_MARK: "meta" }, litHome: home }), "meta");
      assert.equal(readMarkMode({ env: { LITCLAUDE_MARK: "loud" }, litHome: home }), "off");
      assert.equal(readMarkMode({ env: {}, litHome: home }), "off");
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it("refuses an invalid value with exit 64 and writes nothing", () => {
    const home = tempHome();
    try {
      const r = config(home, join(home, "claude"), "mark", "loud");
      assert.equal(r.status, 64);
      assert.match(r.stderr, /mark takes one of: on, meta, off/u);
      assert.equal(existsSync(markConfigPath(home)), false);
      assert.throws(() => writeMarkMode(home, "loud"), /mark takes one of/u);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it("reads an unreadable or malformed config as on", () => {
    const home = tempHome();
    try {
      writeFileSync(markConfigPath(home), "{not json");
      assert.equal(readMarkMode({ env: {}, litHome: home }), "on");
      writeFileSync(markConfigPath(home), JSON.stringify({ mark: "loud" }));
      assert.equal(readMarkMode({ env: {}, litHome: home }), "on");
      rmSync(markConfigPath(home));
      mkdirSync(markConfigPath(home));
      assert.equal(readMarkMode({ env: {}, litHome: home }), "on");
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it("refuses to write through a symlinked config and leaves the target untouched", () => {
    const home = tempHome();
    try {
      const target = join(home, "elsewhere.json");
      writeFileSync(target, "{}\n");
      symlinkSync(target, markConfigPath(home));
      assert.throws(() => writeMarkMode(home, "off"), /symlink/u);
      const r = config(home, join(home, "claude"), "mark", "off");
      assert.notEqual(r.status, 0);
      assert.equal(readFileSync(target, "utf8"), "{}\n");
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it("keeps other keys in config.json when it writes mark", () => {
    const home = tempHome();
    try {
      writeFileSync(markConfigPath(home), JSON.stringify({ other: 1 }));
      writeMarkMode(home, "meta");
      assert.deepEqual(JSON.parse(readFileSync(markConfigPath(home), "utf8")), { other: 1, mark: "meta" });
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it("names the plugin version and official repo in the generator string", () => {
    assert.equal(generatorString(), `LitClaude ${version} · github.com/wjgoarxiv/litclaude`);
  });

  it("gives the Python engines the same mode and generator", () => {
    const home = tempHome();
    try {
      let r = pyMode(home);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(r.stdout.trim().split("\n"), ["on", generatorString()]);
      writeMarkMode(home, "off");
      assert.equal(pyMode(home).stdout.split("\n")[0], "off");
      assert.equal(pyMode(home, "meta").stdout.split("\n")[0], "meta");
      writeFileSync(markConfigPath(home), "{not json");
      assert.equal(pyMode(home).stdout.split("\n")[0], "on");
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it("makes no network call from the mark helpers", async () => {
    for (const file of ["mark.mjs", "output_mark.py"]) {
      const source = readFileSync(join(libDir, file), "utf8");
      assert.doesNotMatch(source, /node:(?:http|https|net|dgram|tls)\b|\bfetch\s*\(|import\s+(?:urllib|socket|http|requests)\b/u, file);
    }
    const http = await import("node:http");
    const https = await import("node:https");
    const net = await import("node:net");
    const saved = { fetch: globalThis.fetch, request: http.default.request, get: http.default.get, srequest: https.default.request, connect: net.default.connect };
    const calls = [];
    const trap = (name) => () => { calls.push(name); throw new Error(`network ${name}`); };
    globalThis.fetch = trap("fetch");
    http.default.request = trap("http.request");
    http.default.get = trap("http.get");
    https.default.request = trap("https.request");
    net.default.connect = trap("net.connect");
    const home = tempHome();
    try {
      writeMarkMode(home, "meta");
      readMarkMode({ env: {}, litHome: home });
      generatorString();
    } finally {
      globalThis.fetch = saved.fetch;
      http.default.request = saved.request;
      http.default.get = saved.get;
      https.default.request = saved.srequest;
      net.default.connect = saved.connect;
      rmSync(home, { recursive: true, force: true });
    }
    assert.deepEqual(calls, []);
  });
});

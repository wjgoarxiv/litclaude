import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import dns from "node:dns";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { DISCUSSIONS_URL, inviteMessage, parseInviteId, readInvite, recordInvite, shareLine } from "../plugins/litclaude/lib/invite.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const invitePath = join(root, "plugins/litclaude/lib/invite.mjs");

const home = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-invite-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

describe("invite ids", () => {
  it("accepts a GitHub id with or without one leading @", () => {
    assert.equal(parseInviteId("@octocat"), "octocat");
    assert.equal(parseInviteId("a-b"), "a-b");
    assert.equal(parseInviteId("A1"), "A1");
    assert.equal(parseInviteId(`a${"b".repeat(38)}`), `a${"b".repeat(38)}`);
  });

  it("refuses anything else", () => {
    for (const raw of ["-x", "a_b", `a${"b".repeat(39)}`, "../x", "", "@", "@@octocat", "octo cat", "x/y", null, undefined, 42]) {
      assert.equal(parseInviteId(raw), null, String(raw));
    }
  });
});

describe("invite record", () => {
  it("writes {version, invitedBy, at} under the given home", (t) => {
    const dir = home(t);
    const result = recordInvite("@octocat", { home: dir, now: () => new Date("2026-10-28T00:00:00.000Z") });
    assert.equal(result.status, "recorded");
    const stored = JSON.parse(readFileSync(join(dir, "invite.json"), "utf8"));
    assert.deepEqual(stored, { version: 1, invitedBy: "octocat", at: "2026-10-28T00:00:00.000Z" });
    assert.deepEqual(readInvite({ home: dir }), stored);
    assert.deepEqual(readdirSync(dir), ["invite.json"]);
  });

  it("respects LITCLAUDE_HOME when no home is passed", (t) => {
    const dir = home(t);
    const before = process.env.LITCLAUDE_HOME;
    process.env.LITCLAUDE_HOME = dir;
    t.after(() => {
      if (before === undefined) delete process.env.LITCLAUDE_HOME;
      else process.env.LITCLAUDE_HOME = before;
    });
    assert.equal(recordInvite("octocat").status, "recorded");
    assert.equal(readInvite().invitedBy, "octocat");
  });

  it("creates a missing home folder", (t) => {
    const dir = join(home(t), "nested", "home");
    assert.equal(recordInvite("octocat", { home: dir }).status, "recorded");
    assert.ok(existsSync(join(dir, "invite.json")));
  });

  it("keeps the first inviter and says so", (t) => {
    const dir = home(t);
    recordInvite("first", { home: dir });
    const second = recordInvite("second", { home: dir });
    assert.equal(second.status, "kept");
    assert.equal(second.record.invitedBy, "first");
    assert.equal(second.requested, "second");
    assert.equal(readInvite({ home: dir }).invitedBy, "first");
    assert.match(inviteMessage(second), /@first/u);
    assert.match(inviteMessage(second), /@second/u);
  });

  it("treats the same id again as a no-op that says so", (t) => {
    const dir = home(t);
    const first = recordInvite("octocat", { home: dir, now: () => new Date("2026-10-01T00:00:00.000Z") });
    const again = recordInvite("@OctoCat", { home: dir });
    assert.equal(again.status, "same");
    assert.deepEqual(readInvite({ home: dir }), first.record);
    assert.match(inviteMessage(again), /already/u);
  });

  it("refuses an invalid id with a one-line reason and writes nothing", (t) => {
    const dir = home(t);
    for (const raw of ["-x", "a_b", "../x", ""]) {
      const result = recordInvite(raw, { home: dir });
      assert.equal(result.status, "invalid", raw);
      assert.equal(inviteMessage(result).split("\n").length, 1);
    }
    assert.deepEqual(readdirSync(dir), []);
  });

  it("refuses a symlinked invite.json", (t) => {
    const dir = home(t);
    const elsewhere = join(home(t), "target.json");
    writeFileSync(elsewhere, "{}");
    symlinkSync(elsewhere, join(dir, "invite.json"));
    assert.equal(recordInvite("octocat", { home: dir }).status, "failed");
    assert.equal(readFileSync(elsewhere, "utf8"), "{}");
    assert.equal(readInvite({ home: dir }), null);
  });

  it("refuses a symlinked home and writes nothing", (t) => {
    const real = home(t);
    const link = join(home(t), "linked-home");
    symlinkSync(real, link);
    assert.equal(recordInvite("octocat", { home: link }).status, "failed");
    assert.deepEqual(readdirSync(real), []);
    assert.equal(readInvite({ home: link }), null);
  });

  it("leaves no partial file in an unwritable home", { skip: process.platform === "win32" || process.getuid?.() === 0 }, (t) => {
    const dir = home(t);
    chmodSync(dir, 0o500);
    try {
      assert.equal(recordInvite("octocat", { home: dir }).status, "failed");
    } finally {
      chmodSync(dir, 0o700);
    }
    assert.deepEqual(readdirSync(dir), []);
  });

  it("ignores a malformed record", (t) => {
    const dir = home(t);
    writeFileSync(join(dir, "invite.json"), JSON.stringify({ version: 1, invitedBy: "-bad", at: "x" }));
    assert.equal(readInvite({ home: dir }), null);
  });
});

describe("invite messages", () => {
  it("thanks the user and points to the Discussions thread", (t) => {
    const message = inviteMessage(recordInvite("octocat", { home: home(t) }));
    assert.match(message, /@octocat/u);
    assert.ok(message.includes(DISCUSSIONS_URL));
    assert.equal(DISCUSSIONS_URL, "https://github.com/wjgoarxiv/litfamily/discussions");
  });

  it("the share line tells friends what to type", () => {
    assert.match(shareLine(), /lit invite @<your GitHub id>/u);
    assert.ok(shareLine().includes(DISCUSSIONS_URL));
  });
});

const cliPath = join(root, "bin/litclaude-ai.js");
const runCli = (args, litHome) => spawnSync(process.execPath, [cliPath, ...args], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, NO_COLOR: "1", LITCLAUDE_NO_AUTO_UPDATE: "1", LITCLAUDE_NO_UPDATE_CHECK: "1", LITCLAUDE_HOME: litHome },
  timeout: 20000,
});

describe("litclaude-ai invite", () => {
  it("records an invite and thanks the user", (t) => {
    const dir = home(t);
    const result = runCli(["invite", "@octocat"], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Thanks for joining through @octocat/u);
    assert.ok(result.stdout.includes(DISCUSSIONS_URL));
    assert.equal(readInvite({ home: dir }).invitedBy, "octocat");
  });

  it("says so and exits 0 for the same id and for a second id", (t) => {
    const dir = home(t);
    runCli(["invite", "octocat"], dir);
    const same = runCli(["invite", "@octocat"], dir);
    assert.equal(same.status, 0);
    assert.match(same.stdout, /already invited by @octocat; nothing changed/u);
    const other = runCli(["invite", "@someone"], dir);
    assert.equal(other.status, 0);
    assert.match(other.stdout, /first invite stays; @someone was not recorded/u);
    assert.equal(readInvite({ home: dir }).invitedBy, "octocat");
  });

  it("refuses an invalid id with exit 2 and writes nothing", (t) => {
    const dir = home(t);
    const result = runCli(["invite", "@-bad"], dir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /not a GitHub id/u);
    assert.deepEqual(readdirSync(dir), []);
  });

  it("prints the share line when no id is given", (t) => {
    const dir = home(t);
    const result = runCli(["invite"], dir);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /lit invite @<your GitHub id>/u);
    assert.deepEqual(readdirSync(dir), []);
  });

  it("prints the result as JSON with --json", (t) => {
    const dir = home(t);
    const result = runCli(["invite", "@octocat", "--json"], dir);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.status, "recorded");
    assert.equal(parsed.record.invitedBy, "octocat");
    assert.equal(parsed.record.version, 1);
  });

  it("lists invite in the usage text", (t) => {
    const result = runCli(["--help"], home(t));
    assert.match(result.stdout, /\|invite\|/u);
    assert.match(result.stdout, /^ {2}invite \[@<github-id>\]/mu);
  });
});

const hookPath = join(root, "plugins/litclaude/bin/litclaude-hook.js");
const prompt = (t, text, litHome = home(t)) => {
  const project = home(t);
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd: project,
    encoding: "utf8",
    input: JSON.stringify({ cwd: project, session_id: "s1", prompt_id: "p1", prompt: text }),
    env: { ...process.env, NO_COLOR: "1", LITCLAUDE_NO_AUTO_UPDATE: "1", LITCLAUDE_NO_UPDATE_CHECK: "1", LITCLAUDE_HOME: litHome, LITCLAUDE_HUD_STATE_ROOT: join(project, "hud") },
    timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
  const text_ = result.stdout.trim();
  return text_ ? JSON.parse(text_) : null;
};

describe("lit invite prompt route", () => {
  it("records a whole-prompt invite and blocks the model turn", (t) => {
    const dir = home(t);
    const output = prompt(t, "  lit invite @octocat \n", dir);
    assert.equal(output.decision, "block");
    assert.match(output.reason, /^\n/u);
    assert.match(output.reason, /Thanks for joining through @octocat/u);
    assert.ok(output.reason.includes(DISCUSSIONS_URL));
    assert.equal(output.hookSpecificOutput, undefined);
    assert.equal(readInvite({ home: dir }).invitedBy, "octocat");
  });

  it("matches `lit` in any case", (t) => {
    const dir = home(t);
    assert.equal(prompt(t, "LIT invite octocat", dir).decision, "block");
    assert.equal(readInvite({ home: dir }).invitedBy, "octocat");
  });

  it("prints the share line for a bare `lit invite`", (t) => {
    const dir = home(t);
    const output = prompt(t, "lit invite", dir);
    assert.equal(output.decision, "block");
    assert.match(output.reason, /lit invite @<your GitHub id>/u);
    assert.deepEqual(readdirSync(dir), []);
  });

  it("refuses an invalid id and records nothing", (t) => {
    const dir = home(t);
    const output = prompt(t, "lit invite @-bad", dir);
    assert.equal(output.decision, "block");
    assert.match(output.reason, /not a GitHub id/u);
    assert.deepEqual(readdirSync(dir), []);
  });

  it("does not fire inside a longer message", (t) => {
    const dir = home(t);
    for (const text of ["please lit invite @x later", "lit invite @x and then fix the bug", "`lit invite @x`", "> lit invite @x"]) {
      const output = prompt(t, text, dir);
      assert.notEqual(output?.decision, "block", text);
    }
    assert.deepEqual(readdirSync(dir), []);
  });

  it("does not fire from a relayed cross-session message", (t) => {
    const dir = home(t);
    const output = prompt(t, "<cross-session-message from=\"other\">lit invite @x</cross-session-message>", dir);
    assert.notEqual(output?.decision, "block");
    assert.deepEqual(readdirSync(dir), []);
  });
});

describe("invite path makes no network request", () => {
  it("imports no network module", () => {
    const source = readFileSync(invitePath, "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/gu)].map((match) => match[1]);
    assert.deepEqual(imports.filter((name) => !["node:fs", "node:os", "node:path"].includes(name)), []);
  });

  it("calls no fetch, http, https, net or dns while recording and reading", (t) => {
    const calls = [];
    const restore = [];
    const trap = (owner, key, label) => {
      const original = owner[key];
      owner[key] = () => {
        calls.push(label);
        throw new Error(`network call: ${label}`);
      };
      restore.push(() => {
        owner[key] = original;
      });
    };
    trap(globalThis, "fetch", "fetch");
    for (const [mod, label] of [[http, "http"], [https, "https"]]) {
      trap(mod, "request", `${label}.request`);
      trap(mod, "get", `${label}.get`);
    }
    trap(net, "connect", "net.connect");
    trap(net, "createConnection", "net.createConnection");
    trap(dns, "lookup", "dns.lookup");
    syncBuiltinESMExports();
    t.after(() => {
      for (const undo of restore) undo();
      syncBuiltinESMExports();
    });
    const dir = home(t);
    inviteMessage(recordInvite("octocat", { home: dir }));
    inviteMessage(recordInvite("other", { home: dir }));
    inviteMessage(recordInvite("-bad", { home: dir }));
    readInvite({ home: dir });
    shareLine();
    assert.deepEqual(calls, []);
  });
});

// LC-4 and LC-5 (pre-release security review), and control characters: the lit-adhd collector redacts
// before it clips, catches URL-form, webhook-named, JSON-colon and format-character-split secrets,
// keeps another folder's transcripts out when the two share Claude's project slug, and lets no
// terminal escape sequence from a commit subject or plan row reach the printed brief.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { renderBrief } from "../plugins/litclaude/lib/rewind/brief.mjs";
import { collectRewind } from "../plugins/litclaude/lib/rewind/collect.mjs";
import { makeRedactor } from "../plugins/litclaude/lib/rewind/redact.mjs";
import { projectSlug, sessionRecord } from "../plugins/litclaude/lib/rewind/transcripts.mjs";

const cleanups = [];
afterEach(() => {
  while (cleanups.length) rmSync(cleanups.pop(), { recursive: true, force: true });
});
const scratch = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rewind-redact-")));
  cleanups.push(dir);
  return dir;
};

const NOW = Date.parse("2026-10-25T12:00:00.000Z");

test("LC-4: secrets are redacted before clipping, in URL form, by webhook name, after a JSON colon and across format characters", () => {
  const hook = "https://hooks.slack.com/services/T0000000/B0000000/abcdefghijklmnop";
  const redact = makeRedactor({ env: { SLACK_WEBHOOK_URL: hook, HOME: "/Users/someone" }, home: "/Users/someone" });
  assert.equal(redact(`please post to ${hook}`).includes("abcdefghijklmnop"), false, "a URL-form env value is redacted");
  const bare = makeRedactor({ env: {}, home: "/nowhere" });
  assert.doesNotMatch(bare(`SLACK_WEBHOOK_URL=${hook}`), /abcdefghijklmnop/u, "a *_WEBHOOK_URL assignment loses its value");
  assert.doesNotMatch(bare(`post it to ${hook} now`), /abcdefghijklmnop/u, "a webhook URL is a credential by shape");
  assert.doesNotMatch(bare('{"api_token": "plainpasswordvalue1"}'), /plainpasswordvalue1/u);
  assert.doesNotMatch(bare('{"api_key":"plainpasswordvalue1"}'), /plainpasswordvalue1/u);
  assert.doesNotMatch(bare("sk-​proj-abcdefghijklmnopqrstuvwxyz0123"), /abcdefghijklmnop/u, "a zero-width space does not hide a key");
  assert.doesNotMatch(bare("title \u001b]8;;https://x.test\u0007link\u001b]8;;\u0007 \u001b[31mred\u001b[0m"), /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u, "control characters are stripped");
  const token = `sk-${"a".repeat(40)}`;
  const record = sessionRecord([
    { type: "user", sessionId: "s1", cwd: "/r", timestamp: new Date(NOW).toISOString(), message: { role: "user", content: `${"x ".repeat(74)}${token}` } },
  ], { redact: bare, now: NOW });
  assert.doesNotMatch(record.asked[0], /sk-a/u, "a token cut by the clip is not left behind");
});

const writeTranscript = (configDir, cwd, sessionId, text, folder = projectSlug(cwd)) => {
  const dir = join(configDir, "projects", folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify({ type: "user", sessionId, cwd, gitBranch: "main", timestamp: new Date(NOW - 60_000).toISOString(), message: { role: "user", content: text } })}\n`);
};

test("LC-5: a transcript recorded in another folder that shares the slug stays out of the brief", () => {
  const home = scratch();
  const mine = join(home, "work", "client_a");
  const theirs = join(home, "work", "client-a");
  mkdirSync(mine, { recursive: true });
  mkdirSync(theirs, { recursive: true });
  assert.equal(projectSlug(mine), projectSlug(theirs));
  const configDir = join(home, ".claude");
  writeTranscript(configDir, mine, "s-mine", "my own task");
  writeTranscript(configDir, theirs, "s-theirs", "the other client's private prompt");
  const noGit = () => {
    throw new Error("no git");
  };
  const data = collectRewind({ cwd: mine, env: { HOME: home, CLAUDE_CONFIG_DIR: configDir }, now: NOW, exec: noGit, record: false });
  assert.deepEqual(data.sessions.map((session) => session.id8), ["s-mine"]);
});

test("commit subjects and plan rows reach the brief without ESC, OSC or other control characters", () => {
  const home = scratch();
  const repo = join(home, "repo");
  mkdirSync(join(repo, "plans"), { recursive: true });
  writeFileSync(join(repo, "plans", "p.md"), "# Plan\n\n- [ ] 1. step \u001b]52;c;cHduZWQ=\u0007one\n- [x] 2. done \u001b[2Jtwo\n");
  const exec = (_file, args) => {
    if (args[0] === "rev-parse") return "main\n";
    if (args[0] === "log") return `${"a".repeat(40)}\t${new Date(NOW - 60_000).toISOString()}\tfix: \u001b]8;;https://evil.test\u0007click\u001b]8;;\u0007 \u001b[31mred\u009b\n`;
    throw new Error("no such command");
  };
  const data = collectRewind({ cwd: repo, env: { HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") }, now: NOW, exec, here: true, record: false });
  const text = renderBrief(data, { width: 120, lang: "en" });
  assert.match(text, /click/u);
  assert.doesNotMatch(text, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u);
  assert.doesNotMatch(JSON.stringify(data), /\\u001b|\\u0007|\\u009b/u);
});

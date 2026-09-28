import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { shouldRunUpdateNotifier } from "../bin/update-notifier.mjs";
import { shouldRunAutomaticUpdate } from "../plugins/litclaude/lib/automatic-update.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const documents = [
  "CONTRIBUTING.md", "SECURITY.md", "CODE_OF_CONDUCT.md", "SUPPORT.md", "docs/privacy.md",
  ".github/ISSUE_TEMPLATE/bug_report.md", ".github/ISSUE_TEMPLATE/feature_request.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
];
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("community documents and their relative links resolve in a standalone checkout", () => {
  for (const path of documents) {
    const content = read(path);
    for (const [, target] of content.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/gu)) {
      if (/^(?:https?:|#)/u.test(target)) continue;
      const localPath = decodeURIComponent(target.split("#")[0]);
      assert.ok(existsSync(resolve(root, dirname(path), localPath)), `${path}: broken link ${target}`);
    }
  }
});

test("privacy discloses network, transcript handling, local persistence and control boundaries", () => {
  const privacy = read("docs/privacy.md");
  for (const required of [
    "registry.npmjs.org", "LITCLAUDE_NO_UPDATE_CHECK", "LITCLAUDE_NO_AUTO_UPDATE",
    "LITCLAUDE_AUTO_INSTALL=0", "CLAUDE_CONFIG_DIR", "LITCLAUDE_HOME",
    "context-pressure", "256 KiB", "No skill\nreview reads transcript excerpts", "pending-review.json",
    "skill-loop-state.json", "No other state is affected.", "not an offline mode", "not a guarantee", "uninstall",
  ]) assert.ok(privacy.includes(required), `privacy omits ${required}`);
  assert.doesNotMatch(privacy, /skill-observer|skill-loop\/|observations\.jsonl|skill-ledger/iu);
  assert.doesNotMatch(privacy, /(?:never sends data|zero network|fully offline|no telemetry)/iu);
});

test("documented update opt-outs gate both management and SessionStart even when empty", () => {
  const options = {
    command: "doctor", rest: [], dryRun: false, env: {},
    stdin: { isTTY: true }, stdout: { isTTY: true }, stderr: { isTTY: true },
  };
  const session = { ...options, surface: "session-start", input: { session_id: "privacy-check" } };
  assert.equal(shouldRunUpdateNotifier(options), true);
  assert.equal(shouldRunAutomaticUpdate(session), true);
  for (const key of ["NO_UPDATE_NOTIFIER", "LITCLAUDE_NO_UPDATE_CHECK"]) {
    for (const value of ["", "1"]) {
      assert.equal(shouldRunUpdateNotifier({ ...options, env: { [key]: value } }), false);
      assert.equal(shouldRunAutomaticUpdate({ ...options, env: { [key]: value } }), false);
      assert.equal(shouldRunAutomaticUpdate({ ...session, env: { [key]: value } }), false);
    }
  }
  assert.equal(shouldRunAutomaticUpdate({ ...session, env: { LITCLAUDE_NO_AUTO_UPDATE: "" } }), false);
  assert.equal(shouldRunUpdateNotifier({ ...options, env: { LITCLAUDE_NO_AUTO_UPDATE: "" } }), true);
});

test("public intake warns against sensitive uploads and directs security reports separately", () => {
  for (const path of ["SUPPORT.md", ".github/ISSUE_TEMPLATE/bug_report.md", ".github/PULL_REQUEST_TEMPLATE.md"]) {
    const content = read(path);
    assert.match(content, /SECURITY\.md/u, `${path}: no security route`);
    assert.match(content, /redact|redacted/iu, `${path}: no redaction instruction`);
    assert.match(content, /transcript/iu, `${path}: no transcript warning`);
  }
  assert.match(read("SECURITY.md").replace(/\s+/gu, " "), /if.*(?:available|enabled)/iu);
  assert.match(read("SECURITY.md"), /no dedicated private contact/iu);
});

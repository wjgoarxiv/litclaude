import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");

const contextFor = (prompt) => {
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout === "" ? "" : JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
};
const bodyFor = (prompt) => /<litclaude-skill-body name="([a-z-]+)">/u.exec(contextFor(prompt))?.[1] ?? null;

describe("browser-drive route", () => {
  it("answers its own name and the dollar shorthand", () => {
    assert.equal(bodyFor("browser-drive open the pricing page and read the tiers"), "browser-drive");
    assert.equal(bodyFor("$browser-drive"), "browser-drive");
    assert.equal(bodyFor("browser-drive"), "browser-drive");
  });

  it("injects the verified command identity and typed identity blocker", () => {
    const context = contextFor("browser-drive");

    assert.match(context, /vercel-labs\/agent-browser/u);
    assert.match(context, /agent-browser --version/u);
    assert.match(context, /agent-browser 0\.34\.0/u);
    assert.match(context, /BLOCKED_BROWSER_IDENTITY_UNVERIFIED/u);
    assert.match(context, /BLOCKED_BROWSER_DRIVER_CLEANUP_FAILED/u);
    assert.doesNotMatch(context, /BLOCKED_BROWSER_DRIVER_IDENTITY_UNVERIFIED/u);
  });

  it("stays silent when a browser is only the subject matter, not the tool", () => {
    for (const prompt of [
      "explain how browser cookies work",
      "why does this CSS behave differently in Safari",
      "write a unit test for the URL parser",
      "our users say the web app feels slow",
    ]) {
      assert.notEqual(bodyFor(prompt), "browser-drive", `must not fire for: ${prompt}`);
    }
  });

  it("does not hijack the surface-verification route", () => {
    assert.notEqual(bodyFor("visual-qa check the dashboard screenshot"), "browser-drive");
  });

  it("is not an anywhere-token", () => {
    assert.notEqual(bodyFor("the browser-drive term appears inside this sentence about naming"), "browser-drive");
  });
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// The video-covers family (lit-typographic-motion and readme-studio) moved to the `video-covers` plugin of the
// wjgoarxiv-skills marketplace. LitClaude keeps a same-name stub for each id: the ids, the `$` routes, the slash
// route and the bare-lit film route still work, and they lead to the install line. The motion Stop gate, the motion
// doctor lines, `litclaude-ai motion-runtime` and the install-time pre-warm belonged to the engine, so they left with
// it; the lit-pptx stub's Pretendard trio, whose last reader was the film engine, left too.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(root, "plugins", "litclaude");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");
const IDS = ["lit-typographic-motion", "readme-studio"];
const stubRoot = (id) => join(pluginRoot, "skills", id);
const stub = (id) => readFileSync(join(stubRoot(id), "SKILL.md"), "utf8");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
const text = (path) => readFileSync(join(root, path), "utf8");

const hookRun = (event, input, cwd = root) => {
  const result = spawnSync(process.execPath, [hookPath, event], { cwd, encoding: "utf8", input: JSON.stringify({ cwd, ...input }) });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
};
const hook = (prompt) => hookRun("user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt }).hookSpecificOutput.additionalContext;

const ROUTES = [
  ["lit-typographic-motion", "lit-typographic-motion make a title film for the launch"],
  ["lit-typographic-motion", "$lit-typographic-motion render a lyric video for the chorus"],
  ["lit-typographic-motion", "이 시 구절로 키네틱 타이포 영상 만들어줘 lit"],
  ["lit-typographic-motion", "render a lyric video for the chorus lit"],
  ["readme-studio", "readme-studio build a README for this repository"],
  ["readme-studio", "$readme-studio review only; do not edit"],
];

describe("the video-covers skills are same-name stubs for the video-covers extras plugin", () => {
  for (const id of IDS) {
    it(`${id} says what it did, where it lives now and how to install it`, () => {
      const md = stub(id);
      assert.match(md, new RegExp(`^---\\nname: ${id}\\n`, "u"));
      assert.match(md, /wjgoarxiv-skills/u);
      assert.match(md, /^claude plugin marketplace add wjgoarxiv\/wjgoarxiv-skills$/mu, "installs from the public GitHub marketplace");
      assert.doesNotMatch(md, /not (?:been )?published yet/iu, "no longer calls the public marketplace unpublished");
      assert.match(md, /claude plugin install video-covers@wjgoarxiv-skills/u);
      assert.match(md, new RegExp(`video-covers:${id}`, "u"));
      assert.match(md, /Offline, the first line can point at a local clone instead: `claude plugin marketplace add <path to your wjgoarxiv-skills clone>`\./u, "keeps the local clone as the offline form");
      assert.match(md, /lit workflow/u, "says what happens when a lit workflow reaches it");
      assert.match(md, /fp:[0-9a-f]{12} -->\n$/u, "keeps the notice line with its fingerprint");
      assert.doesNotMatch(md, /\/Users\/[a-z]/u, "no private home path");
      assert.ok(Buffer.byteLength(md) < 9000, `${Buffer.byteLength(md)} bytes`);
    });

    it(`${id} is SKILL.md alone`, () => {
      assert.deepEqual(walk(stubRoot(id)).map((f) => relative(stubRoot(id), f)), ["SKILL.md"]);
    });
  }

  it("the lit-pptx stub no longer carries the Pretendard trio the film engine read", () => {
    assert.deepEqual(walk(stubRoot("lit-pptx")).map((f) => relative(stubRoot("lit-pptx"), f)), ["SKILL.md"]);
    assert.doesNotMatch(stub("lit-pptx"), /fonts\/pretendard/u);
  });

  it("the motion Stop gate left with the engine, and a film turn ends without a render", () => {
    assert.equal(existsSync(join(pluginRoot, "lib", "motion-render-gate.mjs")), false);
    assert.doesNotMatch(readFileSync(hookPath, "utf8"), /motion-render-gate|recordMotionTurn|observeMotionTool|evaluateMotionStop/u);
    const project = mkdtempSync(join(tmpdir(), "lit-video-covers-stop-"));
    try {
      writeFileSync(join(project, "package.json"), "{}");
      const session = "video-covers-stop-session";
      hookRun("user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt: "lit-typographic-motion make a title film for the launch", session_id: session }, project);
      assert.deepEqual(hookRun("stop", { hook_event_name: "Stop", session_id: session }, project), {}, "the stub's install-line reply ends the turn");
      assert.equal(existsSync(join(project, ".litclaude", "motion")), false, "no motion turn is recorded");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("the motion runtime command, pre-warm and doctor lines left with the engine", () => {
    for (const file of ["bin/litclaude-ai.js", "plugins/litclaude/bin/litclaude-ai", "scripts/postinstall.mjs", "scripts/doctor.mjs", ".github/workflows/ci.yml", ".github/workflows/ci-linux.yml", ".github/workflows/ci-heavy.yml"]) {
      assert.doesNotMatch(text(file), /motion-runtime|motion-doctor|MOTION_RUNTIME|LITCLAUDE_MOTION_PREWARM|lit-typographic-motion\/scripts/u, file);
    }
    const run = spawnSync(process.execPath, [join(root, "bin", "litclaude-ai.js"), "--help"], { encoding: "utf8" });
    assert.doesNotMatch(`${run.stdout}${run.stderr}`, /motion-runtime/u);
  });

  it("every video-covers route still reaches its stub and carries the install line", () => {
    for (const [id, prompt] of ROUTES) {
      const context = hook(prompt);
      assert.match(context, new RegExp(`Skill\\(${id}\\)`, "u"), prompt);
      assert.match(context, new RegExp(`name="${id}"`, "u"), prompt);
      assert.match(context, /video-covers@wjgoarxiv-skills/u, prompt);
      assert.match(context, new RegExp(`video-covers:${id}`, "u"), prompt);
      assert.match(context, /claude plugin marketplace add wjgoarxiv\/wjgoarxiv-skills/u, prompt);
      assert.doesNotMatch(context, /not published yet|<path to your wjgoarxiv-skills clone>/u, prompt);
      assert.ok(Buffer.byteLength(context, "utf8") <= 4096, `${prompt}: ${Buffer.byteLength(context, "utf8")} bytes`);
    }
  });

  it("a video-covers context carries no leftover procedure from the old bodies", () => {
    for (const [, prompt] of ROUTES) {
      const context = hook(prompt);
      for (const leftover of ["treatment.json", "motion.mjs", "AskUserQuestion", "references/cover.md", "board round", "type path", "IMAGE_GENERATION_UNAVAILABLE", "POST_PUBLICATION_UNVERIFIED", "LITWORK MODE", "type-led cue"]) {
        assert.ok(!context.includes(leftover), `${prompt}: ${leftover}`);
      }
    }
  });
});

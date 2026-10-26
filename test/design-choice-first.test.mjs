import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// A design skill asks the user to choose the design before it builds anything. The user has the
// right to choose among the skill's own presets, so each SKILL.md carries a "Choose the design
// first" step that calls AskUserQuestion with the choices that skill really ships, and that step
// sits before the step that builds, writes or renders the artifact.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(root, "plugins", "litclaude");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");

const MARKER = /choose the design first/iu;
// Everything from the marker to the end of the step; long enough for four questions, short
// enough that unrelated procedure text cannot satisfy a check by accident.
const BLOCK_CHARS = 4200;

// For each skill: `build` is a robust anchor for the step that builds, renders or writes the
// artifact, `choices` are tokens only that skill ships (a real preset, theme, template or path),
// and `prompt` is a natural activation prompt for the hook-context check.
const skills = {
  "lit-pptx": {
    build: /^5\. \*\*Write the Markdown source\*\*/mu,
    choices: [/`ledger`|Ledger/u, /AZURE-PRO/u, /BOILERPLATE-PRETENDARD/u, /4:3/u, /learn/iu],
    prompt: "lit-pptx make a deck about our Q3 results",
  },
  "lit-docx": {
    build: /^3\. \*\*Outline, then write the Markdown source\*\*/mu,
    choices: [/Report/u, /Brief/u, /Manual/u, /Proposal/u, /Memo/u, /Journal/u, /elsevier/iu, /korean-generic/u, /--template/u],
    prompt: "lit-docx write a report on the pilot",
  },
  "frontend-ui-ux": {
    build: /design-lock\.mjs" init/u,
    choices: [/field-notes/u, /graphite/u, /meadow/u, /computational-brutalism/u, /neo-brutalism/u, /landing/u, /workspace/u, /settings/u],
    prompt: "frontend-ui-ux build a settings page",
  },
  "lit-schematic": {
    build: /^5\. \*\*Build\.\*\*/mu,
    choices: [/P&ID/u, /PFD/u, /journal/iu, /isometric/iu, /A3/u, /85/u, /interactive/iu, /grey|monochrome/iu],
    prompt: "lit-schematic draw a P&ID for the dosing skid",
  },
  "lit-diagram-drawer": {
    build: /^6\. \*\*Draft HTML\/SVG\.\*\*/mu,
    choices: [/slide-16x9/u, /slide-4x3/u, /doc-inline/u, /doc-wide/u, /light/u, /dark/u, /type-catalog/u],
    prompt: "lit-diagram-drawer draw the service deployment boundary",
  },
  "readme-studio": {
    build: /^6\. Compose a distinctive cover/mu,
    choices: [/Remotion/u, /HyperFrames/u, /poster/iu, /plain-Markdown/iu],
    prompt: "readme-studio improve README",
  },
  "lit-typographic-motion": {
    build: /^1\. \*\*Treatment\.\*\*/mu,
    choices: [/swiss-signal/u, /tidal/u, /terminalcore/u, /paper/u, /9:16/u, /16:9/u, /stage/u, /type path/iu, /treatment\.request/u],
    prompt: "lit-typographic-motion make a title film for the launch",
  },
};

const read = (id) => readFileSync(join(pluginRoot, "skills", id, "SKILL.md"), "utf8");
const stepBlock = (text) => {
  const at = text.search(MARKER);
  return at === -1 ? "" : text.slice(at, at + BLOCK_CHARS);
};

describe("design skills ask the user to choose the design first", () => {
  for (const [id, spec] of Object.entries(skills)) {
    describe(id, () => {
      const text = read(id);
      const block = stepBlock(text);

      it("has a 'Choose the design first' step inside the procedure", () => {
        const at = text.search(MARKER);
        assert.notEqual(at, -1, `${id}: no "Choose the design first" step`);
        assert.ok(at > text.indexOf("## #contract.procedure"), `${id}: step sits before the procedure`);
        assert.ok(at < text.indexOf("## #contract.outputs"), `${id}: step sits after the procedure`);
      });

      it("calls AskUserQuestion with options, a Recommended first choice and ASCII previews", () => {
        assert.match(block, /AskUserQuestion/u);
        assert.match(block, /\(Recommended\)/u);
        assert.match(block, /\bpreview\b/u);
        assert.match(block, /ASCII/u);
        assert.match(block, /right to choose/iu);
      });

      it("offers this skill's real presets, not a generic list", () => {
        for (const token of spec.choices) assert.match(block, token, `${id}: missing ${token}`);
      });

      it("names the skip conditions: the prompt already names the choice, or the user delegates it", () => {
        assert.match(block, /already names|names the/iu);
        assert.match(block, /you choose/iu);
        assert.match(block, /알아서/u);
      });

      it("falls back to the recommended option in a non-interactive run and says so in one line", () => {
        assert.match(block, /non-interactive/iu);
        assert.match(block, /claude -p/u);
        assert.match(block, /Recommended option/u);
        assert.match(block, /one line/iu);
      });

      it("comes before the step that builds, writes or renders the artifact", () => {
        const stepAt = text.search(MARKER);
        const buildAt = text.search(spec.build);
        assert.notEqual(stepAt, -1, `${id}: no "Choose the design first" step`);
        assert.notEqual(buildAt, -1, `${id}: build anchor ${spec.build} not found`);
        assert.ok(stepAt < buildAt, `${id}: choice step (${stepAt}) must precede the build step (${buildAt})`);
      });

      it("activation context tells the model to ask for the design choice first", () => {
        const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
          cwd: root,
          encoding: "utf8",
          input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: spec.prompt, cwd: root }),
        });
        assert.equal(result.status, 0, result.stderr);
        const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
        assert.match(context, new RegExp(`name="${id}"`, "u"));
        assert.match(context, /AskUserQuestion/u, `${id}: the injected contract must name AskUserQuestion`);
        if (id !== "readme-studio") {
          assert.ok(Buffer.byteLength(context, "utf8") <= 4096, `${id}: ${Buffer.byteLength(context, "utf8")} bytes`);
        }
      });
    });
  }

  it("keeps the seven steps skill-specific: no two share the same body", () => {
    const blocks = Object.keys(skills).map((id) => stepBlock(read(id)).replace(/\s+/gu, " "));
    assert.equal(new Set(blocks).size, blocks.length);
    const sentences = blocks.map((block) => new Set(block.split(/(?<=[.:])\s/u).filter((s) => s.length > 60)));
    for (let i = 0; i < sentences.length; i += 1) {
      for (let j = i + 1; j < sentences.length; j += 1) {
        const shared = [...sentences[i]].filter((s) => sentences[j].has(s));
        assert.ok(shared.length <= 2, `blocks ${i} and ${j} share ${shared.length} long sentences`);
      }
    }
  });
});

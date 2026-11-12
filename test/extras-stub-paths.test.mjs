import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Every same-name stub names the folder its body moved to, after the line that installs the whole family plugin.
const stubs = {
  "frontend-ui-ux": "design",
  "visual-qa": "design",
  "lit-docx": "documents",
  "lit-pptx": "decks",
  "lit-diagram-drawer": "figures",
  "lit-schematic": "figures",
  "lit-scientific-visualization": "figures",
  "lit-typographic-motion": "video-covers",
  "readme-studio": "video-covers",
};

test("each extras stub names its folder in wjgoarxiv-skills", () => {
  for (const [id, family] of Object.entries(stubs)) {
    const text = readFileSync(new URL(`../plugins/litclaude/skills/${id}/SKILL.md`, import.meta.url), "utf8");
    assert.ok(text.includes(`claude plugin install ${family}@wjgoarxiv-skills`), `${id} installs ${family}`);
    assert.ok(
      text.includes(`In the wjgoarxiv-skills repository the skill sits in the \`plugins/${family}/skills/${id}\` folder; the install line installs the whole \`${family}\` plugin.`),
      `${id} names plugins/${family}/skills/${id}`,
    );
  }
});

test("each extras stub calls the moved skill a LitFamily extension, in its reply and in What moved", () => {
  const hook = readFileSync(new URL("../plugins/litclaude/bin/litclaude-hook.js", import.meta.url), "utf8");
  for (const id of Object.keys(stubs)) {
    const text = readFileSync(new URL(`../plugins/litclaude/skills/${id}/SKILL.md`, import.meta.url), "utf8");
    assert.match(text, /[Tt]hat it is now a LitFamily extension: it moved out of LitClaude into the `[a-z-]+` plugin/u, `${id} reply`);
    const moved = text.slice(text.indexOf("## What moved"));
    assert.ok(moved.includes("That makes it a LitFamily extension. LitClaude's core works on its own; install the extensions you use\nbeside it to get the full LitFamily experience."), `${id} What moved`);
    assert.match(hook, new RegExp(`"${id}": "Mode contract:[^\\n]*, that it is now a LitFamily extension, `, "u"), `${id} prompt-hook route`);
  }
});

test("each extras stub checks for a same-name skill of the user's own before the install lines", () => {
  for (const [id, family] of Object.entries(stubs)) {
    const text = readFileSync(new URL(`../plugins/litclaude/skills/${id}/SKILL.md`, import.meta.url), "utf8");
    const moved = text.slice(text.indexOf("## What moved"));
    const preflight = `ls -d ~/.claude/skills/${id} .claude/skills/${id} 2>/dev/null`;
    const personal = `d="$HOME/.claude/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$d" && mv ~/.claude/skills/${id} "$d"/`;
    const project = `d=".claude/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$d" && mv .claude/skills/${id} "$d"/`;
    for (const line of [preflight, personal, project]) assert.ok(moved.includes(`\n${line}\n`), `${id}: ${line}`);
    assert.ok(moved.indexOf(preflight) < moved.indexOf("claude plugin marketplace add wjgoarxiv/wjgoarxiv-skills"), `${id}: preflight first`);
    assert.ok(moved.includes(`would load beside \`${family}:${id}\` and compete with it`), `${id} says why`);
    const procedure = text.slice(text.indexOf("## #contract.procedure"), text.indexOf("## #contract.outputs"));
    assert.ok(procedure.includes(`check, reading only, whether \`~/.claude/skills/${id}\` or \`.claude/skills/${id}\` exists`), `${id} procedure checks`);
    assert.ok(procedure.includes("Never move it yourself."), `${id} never moves it`);
  }
});

test("each extras stub gives the update lines and says what the host really refreshes", () => {
  for (const [id, family] of Object.entries(stubs)) {
    const text = readFileSync(new URL(`../plugins/litclaude/skills/${id}/SKILL.md`, import.meta.url), "utf8");
    const moved = text.slice(text.indexOf("## What moved"));
    assert.ok(moved.includes(`\nclaude plugin marketplace update wjgoarxiv-skills\nclaude plugin update ${family}@wjgoarxiv-skills\n`), `${id} update lines`);
    assert.ok(moved.includes("Claude Code installs a new copy only when the plugin's version has changed"), `${id} version rule`);
    assert.ok(moved.indexOf("claude plugin install") < moved.indexOf("claude plugin marketplace update"), `${id}: update after install`);
  }
});

test("each prompt-hook stub reply names a same-name personal skill and never moves it", () => {
  const hook = readFileSync(new URL("../plugins/litclaude/bin/litclaude-hook.js", import.meta.url), "utf8");
  for (const [id, family] of Object.entries(stubs)) {
    const contract = hook.split("\n").find((line) => line.startsWith(`  "${id}": "Mode contract:`)) ?? "";
    assert.ok(contract.includes(`If ~/.claude/skills/${id} or .claude/skills/${id} exists, name it and say it competes with ${family}:${id} and should be moved out of the skills folder first (the stub has the line); never move it yourself.`), `${id} hook contract`);
  }
});

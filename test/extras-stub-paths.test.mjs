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

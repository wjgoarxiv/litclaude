import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const screensRoot = new URL("docs/assets/screens/", root);
const read = (path) => readFileSync(new URL(path, root), "utf8");

// Captures of LitClaude's own installer, doctor command, session hook, prompt hook and status line.
const screens = {
  "activation.webp": "65b9621b97ea3bbca401f235e67a654f91e2dd53f7424aa0fa841d4e4d8773a9",
  "doctor-dark.webp": "def7d693c41746accacd706cf6ec738da7ffc49dec4afd4cf201e3e83fc82eab",
  "doctor-light.webp": "074d23929df9cc8bbf40d0681946fc85dfe63a6dfc299750ed9fac3427b2eb1f",
  "install-done-dark.webp": "0443cc6577102cbad1867c3e55d8c1624314ff688f6ec1a57e8413a5905eae79",
  "install-done-light.webp": "90a533c78577a8908b96c87dfa9954241c79bae474318dc83f9c5a6ef0d34c5a",
  "install-plan.webp": "3f16e070509966453553be0ddebffe461ef9b9ba04254c566108f4fe60088156",
  "session-start-dark.webp": "90a2a7fc14b008148a5bb5560710b05ff54bab318ee6ffadce928d1bb1957756",
  "session-start-light.webp": "7b93d6721f9fbbf155b218872ca9506e901a08941d50aed5ad5e09394ed40bf8",
};
const MAX_SCREEN_BYTES = 61_440;

// What each picture must quote in its alt text, in the language of the page.
const quotes = {
  "install-plan": ["INSTALL PLAN", "05 · Verify confirm every installed surface", "Model selection: host-owned · unrelated Claude settings preserved"],
  "install-done": ["INSTALL RECEIPT", "Status Ready for Claude Code", "MOTION_RUNTIME: pre-warmed (engine deps and fonts ready)"],
  "session-start": ["litclaude vX.Y.Z"],
  activation: ["LIT IGNITED · lit-loop", "O5.5 │ ctx [▊░░] 23%/200k", "└─ lit"],
  doctor: ["PERMISSION_MODE: safe", "HUD_STATUSLINE_PASS", "DOCTOR_PASS"],
};
const themedNames = ["install-done", "session-start", "doctor"];
const singleNames = ["install-plan", "activation"];

test("screen captures are the approved small lossless WebP files", () => {
  assert.deepEqual(readdirSync(screensRoot).sort(), Object.keys(screens).sort());
  for (const [name, expected] of Object.entries(screens)) {
    const path = new URL(name, screensRoot);
    assert.ok(lstatSync(path).isFile(), `${name} must be a regular file`);
    const bytes = readFileSync(path);
    assert.ok(bytes.length <= MAX_SCREEN_BYTES, `${name} must stay under 60 KiB`);
    assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
    assert.ok(!bytes.includes(Buffer.from("ANIM")), `${name} is a still picture`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, name);
  }
});

test("both GitHub pages show every capture with alt text that quotes what it shows", () => {
  for (const [file, heading, label] of [["README.md", "### What you will see on screen", "Captured from"], ["README_ko-KR.md", "### 화면에 나오는 모습", "에서 캡처"]]) {
    const content = read(file);
    assert.equal(content.split("\n").filter((line) => line === heading).length, 1, `${file} has one screens subsection`);
    const start = content.indexOf(heading);
    const section = content.slice(start, content.indexOf("\n## ", start + 4));
    const shown = new Set([...section.matchAll(/docs\/assets\/screens\/([\w.-]+\.webp)/gu)].map((m) => m[1]));
    assert.deepEqual([...shown].sort(), Object.keys(screens).sort(), `${file} must use exactly the shipped captures`);
    const pictures = [...section.matchAll(/<p align="center">(<picture>[\s\S]*?<\/picture>|<img [^>]*>)<\/p>/gu)].map((m) => m[1]);
    assert.equal(pictures.length, themedNames.length + singleNames.length, `${file} shows five pictures`);
    for (const html of pictures) {
      const alt = /alt="([^"]+)"/u.exec(html)?.[1] ?? "";
      const name = /docs\/assets\/screens\/([\w-]+?)(?:-dark|-light)?\.webp/u.exec(html)?.[1];
      assert.ok(quotes[name], `${file}: unknown picture ${html.slice(0, 80)}`);
      assert.ok(alt.length > 60, `${file}: ${name} needs descriptive alt text`);
      for (const quote of quotes[name]) assert.ok(alt.includes(quote), `${file}: alt of ${name} must quote "${quote}"`);
      assert.match(html, /width="\d{3,4}"/u, `${file}: ${name} keeps its natural width`);
      if (themedNames.includes(name)) {
        assert.ok(html.includes("<picture>"), `${file}: ${name} follows the page theme`);
        assert.ok(html.includes(`srcset="./docs/assets/screens/${name}-dark.webp"`), `${file}: dark source for ${name}`);
        assert.ok(html.includes(`src="./docs/assets/screens/${name}-light.webp"`), `${file}: light fallback for ${name}`);
      } else {
        assert.ok(html.includes(`src="./docs/assets/screens/${name}.webp"`), `${file}: ${name} is a single picture`);
      }
    }
    assert.equal(section.split(label).length - 1, pictures.length, `${file}: every picture is labelled as a capture`);
    assert.ok(section.includes("#jev-") || section.includes("#jev-스킬"), `${file}: links to the Jev pictures instead of repeating them`);
    assert.ok(content.indexOf(heading) < content.indexOf(file === "README.md" ? "## Watch it in motion" : "## 움직이는 모습 보기"), `${file}: sits at the end of the quick start`);
    for (const [, target] of section.matchAll(/(?:src|srcset)="(\.\/[^"]+)"/gu)) {
      assert.ok(lstatSync(new URL(target, root)).isFile(), `screen target must exist: ${target}`);
    }
  }
});

test("screen captures stay out of the npm tarball and off the npm cards", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.files.some((entry) => /docs\/assets\/screens|docs\/assets$|^docs$/u.test(entry)), false);
  for (const card of ["README_npm.md", "README_npm_ko-KR.md"]) assert.doesNotMatch(read(card), /assets\/screens/u);
});

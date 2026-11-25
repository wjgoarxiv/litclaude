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
  "install-colour.webp": "b280dea5dce21a2ec8ea8d4f6946ad269d61b14aab600f33bcf5e7e19f37dc08",
  "install-done-dark.webp": "3889abc85da12735fe0769ba0208cff9591ec668208aa0bf3876ada28a53c726",
  "install-done-light.webp": "d40b08d4e211b9a8f55ef68f358a2424c6f1f23ac112b55329045bcdeab418f8",
  "install-yes-no.webp": "ff86e77bbc512e632896a74ec7e6f3384ebc7250e922abc975d62351c84e8da9",
  "session-start-dark.webp": "90a2a7fc14b008148a5bb5560710b05ff54bab318ee6ffadce928d1bb1957756",
  "session-start-light.webp": "7b93d6721f9fbbf155b218872ca9506e901a08941d50aed5ad5e09394ed40bf8",
};
const MAX_SCREEN_BYTES = 71_680;

// What each picture must quote in its alt text, in the language of the page.
const quotes = {
  "install-colour": ["LIT 1/5", "Status-line colour", "press Enter to keep cyan", "Ctrl+C stop"],
  "install-yes-no": ["LIT 3/5", "Icon font [y/N]", "No (default)", "Enter = No"],
  "install-done": ["LitClaude X.Y.Z is installed", "Install steps 5 of 5 checked", "LitClaude status line, cyan", "launch with: claude"],
  "session-start": ["litclaude vX.Y.Z"],
  activation: ["LIT IGNITED · lit-loop", "O5.5 │ ctx [▊░░] 23%/200k", "└─ lit"],
  doctor: ["PERMISSION_MODE: safe", "HUD_STATUSLINE_PASS", "DOCTOR_PASS"],
};
const themedNames = ["install-done", "session-start", "doctor"];
const singleNames = ["install-colour", "install-yes-no", "activation"];

test("screen captures are the approved small lossless WebP files", () => {
  assert.deepEqual(readdirSync(screensRoot).sort(), Object.keys(screens).sort());
  for (const [name, expected] of Object.entries(screens)) {
    const path = new URL(name, screensRoot);
    assert.ok(lstatSync(path).isFile(), `${name} must be a regular file`);
    const bytes = readFileSync(path);
    assert.ok(bytes.length <= MAX_SCREEN_BYTES, `${name} must stay under 70 KiB`);
    assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
    assert.ok(!bytes.includes(Buffer.from("ANIM")), `${name} is a still picture`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, name);
  }
});

// The guides carry the full set; each README plays the session film in its demo slot and links the captures.
test("both guides show every capture with alt text that quotes what it shows", () => {
  for (const [file, heading, label, readme] of [
    ["docs/guide.md", "## What you will see on screen", "Captured from", "README.md"],
    ["docs/guide_ko-KR.md", "## 화면에 나오는 모습", "에서 캡처", "README_ko-KR.md"],
  ]) {
    const landing = read(readme);
    const demo = landing.split("\n").find((line) => line.startsWith("<!-- demo-gif -->"));
    assert.ok(demo, `${readme} keeps the demo slot`);
    const loop = readme === "README.md" ? "demo.webp" : "demo-ko.webp";
    assert.ok(demo.includes(`<img src="./docs/assets/${loop}" width="960"`), `${readme} demo slot plays ${loop}`);
    assert.doesNotMatch(landing, /assets\/screens\//u, `${readme}: the captures live in the guide`);
    assert.ok(landing.includes(`](./${file}#`), `${readme} links ${file}`);
    const content = read(file);
    assert.equal(content.split("\n").filter((line) => line === heading).length, 1, `${file} has one screens subsection`);
    const start = content.indexOf(heading);
    const section = content.slice(start, content.indexOf("\n## ", start + 4));
    const shown = new Set([...section.matchAll(/\.\/assets\/screens\/([\w.-]+\.webp)/gu)].map((m) => m[1]));
    assert.deepEqual([...shown].sort(), Object.keys(screens).sort(), `${file} must use exactly the shipped captures`);
    const pictures = [...section.matchAll(/<p align="center">(<picture>[\s\S]*?<\/picture>|<img [^>]*>)<\/p>/gu)].map((m) => m[1]);
    assert.equal(pictures.length, themedNames.length + singleNames.length, `${file} shows every picture once`);
    for (const html of pictures) {
      const alt = /alt="([^"]+)"/u.exec(html)?.[1] ?? "";
      const name = /assets\/screens\/([\w-]+?)(?:-dark|-light)?\.webp/u.exec(html)?.[1];
      assert.ok(quotes[name], `${file}: unknown picture ${html.slice(0, 80)}`);
      assert.ok(alt.length > 60, `${file}: ${name} needs descriptive alt text`);
      for (const quote of quotes[name]) assert.ok(alt.includes(quote), `${file}: alt of ${name} must quote "${quote}"`);
      assert.doesNotMatch(alt, /MOTION_RUNTIME|pre-warm/u, `${file}: the installer no longer pre-warms the motion runtime`);
      assert.match(html, /width="\d{3,4}"/u, `${file}: ${name} keeps its natural width`);
      if (themedNames.includes(name)) {
        assert.ok(html.includes("<picture>"), `${file}: ${name} follows the page theme`);
        assert.ok(html.includes(`srcset="./assets/screens/${name}-dark.webp"`), `${file}: dark source for ${name}`);
        assert.ok(html.includes(`src="./assets/screens/${name}-light.webp"`), `${file}: light fallback for ${name}`);
      } else {
        assert.ok(html.includes(`src="./assets/screens/${name}.webp"`), `${file}: ${name} is a single picture`);
      }
    }
    assert.equal(section.split(label).length - 1, pictures.length, `${file}: every picture is labelled as a capture`);
    assert.ok(content.indexOf(heading) < content.indexOf(file === "docs/guide.md" ? "## Watch it in motion" : "## 움직이는 모습 보기"), `${file}: sits before the film`);
    for (const [, target] of section.matchAll(/(?:src|srcset)="(\.\/[^"]+)"/gu)) {
      assert.ok(lstatSync(new URL(target, new URL("docs/", root))).isFile(), `screen target must exist: ${target}`);
    }
  }
});

test("screen captures stay out of the npm tarball and off the npm cards", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.files.some((entry) => /docs\/assets\/screens|docs\/assets$|^docs$/u.test(entry)), false);
  for (const card of ["README_npm.md", "README_npm_ko-KR.md"]) assert.doesNotMatch(read(card), /assets\/screens/u);
});

test("the README demo loops are animated WebP files that stay out of the package and off the npm cards", () => {
  const files = JSON.parse(read("package.json")).files;
  for (const name of ["demo.webp", "demo-ko.webp"]) {
    const film = readFileSync(new URL(`docs/assets/${name}`, root));
    assert.equal(film.subarray(0, 4).toString(), "RIFF", `${name} is a RIFF container`);
    assert.equal(film.subarray(8, 12).toString(), "WEBP", `${name} is a WebP`);
    assert.ok(film.includes(Buffer.from("ANIM")), `${name} is animated`);
    assert.ok(film.length <= 8 * 1024 * 1024, `${name} stays within 8 MiB (${film.length} bytes)`);
    const path = `docs/assets/${name}`;
    assert.ok(!files.some((entry) => !entry.startsWith("!") && (path === entry || path.startsWith(`${entry.replace(/\/$/u, "")}/`))), `package.json files never ships ${name}`);
  }
  assert.ok(!read("tools/check-pack-payload.mjs").includes("demo.webp") && !read("tools/check-pack-payload.mjs").includes("demo-ko.webp"), "the pack guard never approves the demo files");
  for (const card of ["README_npm.md", "README_npm_ko-KR.md"]) assert.doesNotMatch(read(card), /demo(?:-ko)?\.(?:gif|webp)/u, `${card} does not embed the demo film`);
});


// The LIT card in its four states, drawn by the card's own renderer; both READMEs show them.
const cardShots = {
  "idle.webp": "af1b7d8379e6feba6d807f8972cff791c51e51f6b49c7527e83bb4cfa39a5856",
  "working.webp": "10ca5f46a371137ca2077551e98f25b4f285f5002502af9571f54e21ffa48afb",
  "threads.webp": "dc7421ec61b437ad3908e4f472af622c334758647409bbc7c9d1ac7ed0a2eac4",
  "after.webp": "b8d57e98572bff3b4445012daced1b4f8a61c54e56309f698c5601ed816c2495",
};
const cardQuotes = {
  idle: ["LIT · ready", "type lit &lt;task&gt; to start one", "1w"],
  working: ["LIT · start-work", "WORK ●", "work 1/2", "task 1/2", "thinking", "1w"],
  threads: ["lit-loop || > start-work", "2/5 paused", "└─ ● start-work", "┬ 3 lanes · 1 task in parallel", "+1 more", "lit continue"],
  after: ["idle", "review-work", "done", "complete", "1w"],
};

test("both READMEs show the LIT card in its idle, working, threads and after states", () => {
  const cardRoot = new URL("docs/assets/card/", root);
  assert.deepEqual(readdirSync(cardRoot).sort(), Object.keys(cardShots).sort());
  for (const [name, expected] of Object.entries(cardShots)) {
    const bytes = readFileSync(new URL(name, cardRoot));
    assert.ok(bytes.length <= MAX_SCREEN_BYTES, `card/${name} must stay under 70 KiB`);
    assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
    assert.ok(!bytes.includes(Buffer.from("ANIM")), `card/${name} is a still picture`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, `card/${name}`);
  }
  for (const [readme, heading] of [["README.md", "## The LIT card"], ["README_ko-KR.md", "## LIT 카드"]]) {
    const content = read(readme);
    assert.equal(content.split("\n").filter((line) => line === heading).length, 1, `${readme} has one card section`);
    const start = content.indexOf(heading);
    const section = content.slice(start, content.indexOf("\n## ", start + 4));
    const pictures = [...section.matchAll(/<img src="\.\/docs\/assets\/card\/([\w-]+)\.webp" width="960" alt="([^"]{60,})" \/>/gu)];
    assert.deepEqual(pictures.map((m) => m[1]), ["idle", "working", "threads", "after"], `${readme} shows the four pictures in order`);
    for (const [, name, alt] of pictures) {
      for (const quote of cardQuotes[name]) {
        assert.ok(alt.includes(quote), `${readme}: alt of ${name} must quote "${quote}"`);
      }
    }
    assert.ok(section.includes("2.1.287"), `${readme} names the Claude Code version the card needs`);
    assert.match(section, /`band`[\s\S]*`auto`[\s\S]*`off`/u, `${readme} names the band setting`);
    assert.ok(section.includes("(./docs/hooks.md#the-lit-band-claude-code-mod)"), `${readme} links the card reference`);
  }
  const files = JSON.parse(read("package.json")).files;
  assert.equal(files.some((entry) => /^docs\/assets\/card/u.test(entry)), false, "card pictures stay out of the npm tarball");
  for (const card of ["README_npm.md", "README_npm_ko-KR.md"]) assert.doesNotMatch(read(card), /assets\/card\//u);
});

// The automatic handoff previews: the three prompts, the reminder and /compact, and the shell route.
const handoffShots = {
  "compact-dark.webp": "7e308b05925756c651dd4b6d10b2198a9e706f34452743368bc300e9ec9ae5f8",
  "compact-light.webp": "213aacb61d0c97af157fe9d2cfda99a94aaf322ae7c3ced497239781636381e1",
  "env-dark.webp": "10ae2c9a60987973cbfcb00876ae20e96c91628590e6189d2834bdc9063c4ef1",
  "env-light.webp": "04e64cfc5d70b2e3978369b1908ec70621796978ed81ea8026f1a8965df9b339",
  "settings-dark.webp": "8c3dcdba7e75e2b6291564253aeca25241156d8629eb1b86b77ba85818cf1f53",
  "settings-light.webp": "c90fc70f9708428e0231a4d323b1757cb64c46671364c4ee2e3caa594edb67c7",
};
const handoffQuotes = {
  settings: ["lit-handoff auto on 65", "Automatic handoff is on at 65%.", "lit-handoff auto status", "lit-handoff auto off", "Automatic handoff is off."],
  compact: ["Handoff saved. Run /compact now.", "/compact", "handoff@65%"],
  env: ["LITCLAUDE_AUTO_HANDOFF=1", "LITCLAUDE_AUTO_HANDOFF_PERCENT=65", "npx @litfamily/litclaude@latest doctor", "Auto-handoff: on at 65%"],
};

test("both READMEs show automatic handoff with the strings LitClaude really prints", () => {
  const source = read("plugins/litclaude/lib/auto-handoff.mjs");
  for (const line of ["`Automatic handoff is on at ${resolved.percent}%.`", '"Automatic handoff is off."', '"Handoff saved. Run /compact now."', "`Auto-handoff: on at ${resolved.percent}%`"]) {
    assert.ok(source.includes(line), `auto-handoff.mjs still prints ${line}`);
  }
  assert.ok(read("plugins/litclaude/bin/litclaude-hud.js").includes("text(`handoff@${setting.percent}%`)"), "the status line still shows handoff@<percent>%");
  const handoffRoot = new URL("docs/assets/handoff/", root);
  assert.deepEqual(readdirSync(handoffRoot).sort(), Object.keys(handoffShots).sort());
  for (const [name, expected] of Object.entries(handoffShots)) {
    const bytes = readFileSync(new URL(name, handoffRoot));
    assert.ok(bytes.length <= MAX_SCREEN_BYTES, `handoff/${name} must stay under 70 KiB`);
    assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
    assert.ok(!bytes.includes(Buffer.from("ANIM")), `handoff/${name} is a still picture`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, `handoff/${name}`);
  }
  for (const [readme, heading, guide] of [["README.md", "## Automatic handoff", "(./docs/guide.md#automatic-handoff)"], ["README_ko-KR.md", "## 자동 핸드오프", "(./docs/guide_ko-KR.md#자동-핸드오프)"]]) {
    const content = read(readme);
    assert.equal(content.split("\n").filter((line) => line === heading).length, 1, `${readme} has one automatic handoff section`);
    const start = content.indexOf(heading);
    const section = content.slice(start, content.indexOf("\n## ", start + 4));
    const pictures = [...section.matchAll(/<picture><source media="\(prefers-color-scheme: dark\)" srcset="\.\/docs\/assets\/handoff\/(\w+)-dark\.webp" \/><img src="\.\/docs\/assets\/handoff\/(\w+)-light\.webp" width="686" alt="([^"]{60,})" \/><\/picture>/gu)];
    assert.deepEqual(pictures.map((m) => m[1]), ["settings", "compact", "env"], `${readme} shows the three previews in order`);
    for (const [, dark, light, alt] of pictures) {
      assert.equal(dark, light, `${readme}: ${dark} pairs its dark and light files`);
      for (const quote of handoffQuotes[dark]) assert.ok(alt.includes(quote), `${readme}: alt of ${dark} must quote "${quote}"`);
    }
    for (const needle of ["`lit-handoff auto on 65`", "`/compact`", "`handoff@65%`", guide]) {
      assert.ok(section.includes(needle), `${readme} automatic handoff section mentions ${needle}`);
    }
  }
  const files = JSON.parse(read("package.json")).files;
  assert.equal(files.some((entry) => /^docs\/assets\/handoff/u.test(entry)), false, "handoff previews stay out of the npm tarball");
  for (const card of ["README_npm.md", "README_npm_ko-KR.md"]) assert.doesNotMatch(read(card), /assets\/handoff\//u);
});

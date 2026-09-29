import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const jevRoot = new URL("docs/assets/jev/", root);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const snapshots = {
  "jev-first-prompt-notice.webp": "3a6aadd334c6007fad32f2185745c2ba781c0df827d52e24e7a984d9e572bf69",
  "jev-status-hint-dark.webp": "35359a468b445aae61d14ef013c496c22547b906af7d8af834fb876d7312a13d",
  "jev-status-hint-light.webp": "8ffb85810a137e85dd437d98c2ed431bc03ea439831bfbb83cfda9c2b55ff042",
  "jev-status-key-dark.webp": "29a419eaf3cacbb2cc68afab208d8ba5d4442713a854901f0785d30c6a82767a",
  "jev-status-key-light.webp": "17ef818d9437e03abdec7e41c0d41a76c3f7cb54db0a082cdb62fad70ba1e668",
  "jev-status-off-dark.webp": "677c2c0e5432b9ba15af3941cd01fb922462c6e6bd33f3a74783e95cc9c8057d",
  "jev-status-off-light.webp": "3aec7d399da06f9b6230aed9556ba920f04bb47182eae4acd5603f3c7873c5fd",
  "jev-status-quiet-dark.webp": "68527f82f581fd6754111c5da717a5830fa7bacb3e378fa63f7f4c6a6c28cc2c",
  "jev-status-quiet-light.webp": "6c60bacecc58bb0cbf23468ea5668bdf26ac3a1c7e87f52849a3e3028f96313c",
};
const MAX_SNAPSHOT_BYTES = 98_304;

const pictures = (content) => [...content.matchAll(/<picture>[\s\S]*?<\/picture>|<img [^>]*docs\/assets\/jev\/[^>]*>/gu)]
  .map((m) => m[0]).filter((html) => html.includes("docs/assets/jev/"));

test("Jev snapshot files are the approved small WebP captures", () => {
  assert.deepEqual(readdirSync(jevRoot).sort(), Object.keys(snapshots).sort());
  for (const [name, expected] of Object.entries(snapshots)) {
    const path = new URL(name, jevRoot);
    assert.ok(lstatSync(path).isFile(), `${name} must be a regular file`);
    const bytes = readFileSync(path);
    assert.ok(bytes.length <= MAX_SNAPSHOT_BYTES, `${name} must stay under 96 KiB`);
    assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, name);
  }
});

test("both GitHub pages show every snapshot with alt text that states the text shown", () => {
  for (const [file, statusWord, alsoRainbow] of [["README.md", "Status line", "rainbow"], ["README_ko-KR.md", "상태 줄", "무지개"]]) {
    const content = read(file);
    const shown = new Set([...content.matchAll(/docs\/assets\/jev\/([\w.-]+\.webp)/gu)].map((m) => m[1]));
    assert.deepEqual([...shown].sort(), Object.keys(snapshots).sort(), `${file} must use exactly the shipped snapshots`);
    const blocks = pictures(content);
    assert.equal(blocks.length, 5, `${file} shows five snapshots`);
    for (const html of blocks) {
      const alt = /alt="([^"]+)"/u.exec(html)?.[1] ?? "";
      assert.ok(alt.length > 40, `${file}: every snapshot needs descriptive alt text`);
      assert.ok(alt.includes(statusWord) || alt.includes(alsoRainbow), `${file}: alt text must name what the image shows`);
    }
    const themed = blocks.filter((html) => html.includes("<picture>"));
    assert.equal(themed.length, 4, `${file}: the four status-line snapshots follow the page theme`);
    for (const html of themed) {
      const dark = /srcset="\.\/docs\/assets\/jev\/(jev-[\w-]+)-dark\.webp"/u.exec(html)?.[1];
      assert.ok(dark, `${file}: the dark source must come from the -dark file`);
      assert.ok(html.includes(`src="./docs/assets/jev/${dark}-light.webp"`), `${file}: the fallback image must be the -light twin`);
    }
    assert.match(content, /Sample output|예시 출력/u, `${file} labels the images as sample output`);
  }
});

test("Jev snapshots stay out of the npm tarball and off the npm cards", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.files.some((entry) => /docs\/assets\/jev|docs\/assets$|^docs$/u.test(entry)), false);
  for (const card of ["README_npm.md", "README_npm_ko-KR.md"]) assert.doesNotMatch(read(card), /assets\/jev/u);
});

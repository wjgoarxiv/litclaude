import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { banner, lockup } from "../bin/litfamily-banner.mjs";

const root = new URL("../", import.meta.url);
const assetRoot = new URL("docs/assets/readme/", root);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const version = JSON.parse(read("package.json")).version;
const npmCdn = `https://cdn.jsdelivr.net/npm/@litfamily/litclaude@${version}`;
const coverSrc = `${npmCdn}/docs/assets/cover-motion.webp`;
const staticCoverSrc = `${npmCdn}/docs/assets/cover-motion-still.webp`;
const coverAlts = {
  install: "LitFamily motion cover: five armored robots power on one by one, the LitClaude robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up.",
  설치: "LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitClaude 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상",
};
const ascii = lockup("claude", banner).map((row) => row.trimEnd()).join("\n");
const assets = {
  "JetBrainsMono-OFL.txt": "a76abf002c49097d146e86740a3105a5d00450b1592e820a1109a8c5680cd697",
  "ascii-readme.svg": "e09a45272027c4a08acd6fcfd5b8e7931f7baf881891749578a4e32dc9ba6ad3",
  "badge-license.svg": "decba749e28b4b87635e62eae766899fdc3e91a8e312208ff152831f620b18d7",
  "ignition-poster.png": "0fac2d0fc78d311710d1658968a45f8d9ff07ff73c6ca6f3ebc60bcb698d318f",
  "ignition-film.mp4": "b1579c89a677ab453765f77ae6361bd9730fabc4291a85071de7f373fc5ebfad",
  "ignition-readme.gif": "0be7badaee33df26a5a200c4f664273a21e9f2513fc066571f579f235220ca81",
  "lucide-book-open.svg": "3ae327cc4bbff19933a3ed535978ff558985b1bcca950e5484f61aa78764ebd2",
  "lucide-play.svg": "ab6e5f5c9e61ec2d8ddd6b93b5476b976c8a0086f5529142a7981284d85f8b83",
  "lucide-shield-check.svg": "aefbe606a9d7cf919208bbd64dfd453b83364f020585be43f32ba162fda4115c",
  "Lucide-LICENSE.txt": "b495047bd93a9b06913511076f504daba17d5bbeb3e0650f3bb53a4220329c57",
};

function assertPresentation(content, installAnchor, docsAnchor, npmReadme = false) {
  const assetRef = (path) => npmReadme ? `${npmCdn}/${path}` : `./${path}`;
  const motionStillSrc = staticCoverSrc;
  const coverAlt = coverAlts[installAnchor];
  const hero = /^<p align="center"><picture>[\s\S]*?<\/picture><\/p>\n\n<h1 align="center">LitClaude<\/h1>\n([\s\S]*?)\n<p align="center"><img src="[^"]+" width="480" alt="[^"]+" \/><\/p>/u.exec(content);
  assert.ok(hero, "title must precede the centered ASCII mark");
  assert.ok(content.includes(`<p align="center"><img src="${assetRef("docs/assets/readme/ascii-readme.svg")}" width="480" alt="LIT ASCII B mark" /></p>`), "ASCII mark path must match its README surface");
  assert.ok(content.includes(coverSrc), "README must use the repository cover path");
  assert.ok(content.includes('<source media="(prefers-reduced-motion: reduce)" srcset="' + motionStillSrc + '" />'), "reduced motion must select the existing still cover");
  assert.ok(content.includes('<img src="' + coverSrc + '" width="100%" alt="' + coverAlt + '" />'), "animated cover needs product-specific alt text");
  assert.ok(
    content.includes('<picture><source media="(prefers-reduced-motion: reduce)" srcset="' + motionStillSrc
      + '" /><img src="' + coverSrc + '" width="100%" alt="' + coverAlt
      + '" /></picture></p>\n\n<h1 align="center">LitClaude</h1>'),
    "the motion cover must be the only picture above the title",
  );
  assert.doesNotMatch(content, /View the static cover|정지 표지 보기/u, "no keyboard-only static-cover link should remain");
  assert.match(hero[1], /^<p align="center"><strong>[^<\n]+<\/strong><\/p>$/mu, "hero needs a text headline");
  assert.match(hero[1], /^<p align="center">[^<\n]*Claude Code[^<\n]*<\/p>$/mu, "hero must explain the host-specific value before the mark");
  assert.ok(hero[1].includes(`href="#${installAnchor}"`), "install action must precede the mark");
  assert.doesNotMatch(hero[1], /^#{1,6} |<details>|<img\b/mu, "hero must precede body sections and other artwork");
  assert.ok(content.split("\n").some((line) => line.toLowerCase() === `## ${installAnchor}`), "install action must resolve to its section");
  const copyable = /^<details>\n<summary>[^\n]+<\/summary>\n\n```text\n([\s\S]*?)\n```\n\n<\/details>$/mu.exec(content);
  assert.ok(copyable, "copyable ASCII details are required");
  assert.equal(copyable[1], ascii, "all canonical ASCII cells and rows must remain copyable");
  assert.ok(content.includes(`href="#${installAnchor}"`));
  assert.ok(content.includes(`href="#${docsAnchor}"><img src="${assetRef("docs/assets/readme/lucide-book-open.svg")}"`));
  assert.ok(content.includes(`href="${assetRef("docs/assets/readme/ignition-film.mp4")}"><img src="${assetRef("docs/assets/readme/lucide-play.svg")}"`));
  assert.ok(content.includes(`href="${assetRef("LICENSE")}"><img src="${assetRef("docs/assets/readme/lucide-shield-check.svg")}"`));
  assert.ok(content.includes(`src="${npmCdn}/docs/assets/readme/badge-version.svg" alt="${version}"`));
  assert.ok(content.includes(`](${assetRef("docs/assets/readme/ignition-poster.png")})](${assetRef("docs/assets/readme/ignition-film.mp4")})`));
  for (const name of [...Object.keys(assets), "badge-version.svg"]) {
    const relative = `./docs/assets/readme/${name}`;
    const cdn = `${npmCdn}/docs/assets/readme/${name}`;
    assert.ok(content.includes(relative) || content.includes(cdn), `${name} must have a reader-facing use`);
  }
  assert.doesNotMatch(content, /https?:\/\/img\.shields\.io|<!-- README visual draft|(?:src|href)="assets\/readme\//u);
}

test("bilingual README motion links preserve centered and copyable native ASCII", () => {
  assertPresentation(read("README.md"), "install", "deeper-docs", true);
  assertPresentation(read("README_ko-KR.md"), "설치", "추가-문서");
});

test("README presentation rejects missing, shifted, or disconnected visual resources", () => {
  const content = read("README.md");
  assertPresentation(content, "install", "deeper-docs", true);
  const mark = `<p align="center"><img src="${npmCdn}/docs/assets/readme/ascii-readme.svg" width="480" alt="LIT ASCII B mark" /></p>`;
  const hostValue = content.match(/^<p align="center">[^<\n]*Claude Code[^<\n]*<\/p>$/mu)?.[0];
  assert.ok(hostValue);
  for (const mutation of [
    content.replace('align="center"', 'align="left"'),
    content.replace('<h1 align="center">LitClaude</h1>', ""),
    content.replace(/^<p align="center"><strong>[^<\n]+<\/strong><\/p>$/mu, ""),
    content.replace(mark, mark.replace('align="center"', 'align="left"')),
    content.replace(mark, ""),
    `${mark}\n${content.replace(mark, "")}`,
    content.replace(mark, "").replace("## Install", `## Install\n${mark}`),
    content.replace(hostValue, ""),
    content.replace('href="#install"', 'href="#missing-install"'),
    content.replace("## Install", "## Removed installation section"),
    content.replace("<details>", "<section>"),
    content.replace(ascii, ascii.replace("▄▄▄▄", "▄▄▄")),
    content.replaceAll(`${npmCdn}/docs/assets/readme/ignition-film.mp4`, "missing.mp4"),
    content.replaceAll(`${npmCdn}/docs/assets/readme/Lucide-LICENSE.txt`, "missing-license.txt"),
  ]) assert.throws(() => assertPresentation(mutation, "install", "deeper-docs", true));
});

test("README assets retain the approved outlined mark, motion bytes, and used icon licenses", () => {
  const cover = readFileSync(new URL("docs/assets/cover.webp", root));
  assert.equal(createHash("sha256").update(cover).digest("hex"), "90c14b40d8c7ae774763ce4c3689edad6abf6697e7236cafec7987269cc5e5f4", "cover.webp must match the accepted LitClaude emphasis export");
  const motionCover = readFileSync(new URL("docs/assets/cover-motion.webp", root));
  assert.ok(motionCover.length <= 2_621_440, "motion cover must stay under 2.5 MiB");
  assert.equal(createHash("sha256").update(motionCover).digest("hex"), "fea93c4dbe8e0485284538532c0a35fe4206091f546ce3b2440f294d367b8205");
  const motionStill = readFileSync(new URL("docs/assets/cover-motion-still.webp", root));
  assert.equal(createHash("sha256").update(motionStill).digest("hex"), "24a867d39c6ca78098907460978bd327199f8afcbd1b33169bd0a63c568d4ad9");
  assert.equal(motionStill.subarray(0, 4).toString(), "RIFF");
  assert.equal(motionStill.subarray(8, 12).toString(), "WEBP");
  assert.deepEqual(readdirSync(assetRoot).sort(), [...Object.keys(assets), "badge-version.svg"].sort());
  for (const [name, expected] of Object.entries(assets)) {
    const path = new URL(name, assetRoot);
    assert.ok(lstatSync(path).isFile(), `${name} must be a regular file`);
    assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), expected, name);
  }
  const svg = read("docs/assets/readme/ascii-readme.svg");
  assert.doesNotMatch(svg, /<(?:text|image|script|foreignObject|style)\b|\b(?:href|on\w+)\s*=|url\s*\(|data:/iu);
  assert.deepEqual([...svg.matchAll(/<g aria-label="([^"]*)">/gu)].map((match) => match[1]), ascii.split("\n").filter((row) => row.length > 0));
});

test("version badge identifies the current scoped release and stays in lockstep", () => {
  const path = new URL("badge-version.svg", assetRoot);
  assert.ok(lstatSync(path).isFile());
  const svg = readFileSync(path, "utf8");
  assert.ok(svg.includes(`aria-label="release: ${version}"`));
  assert.ok(svg.includes(`<title>release: ${version}</title>`));
  assert.ok(svg.includes(`>${version}</text>`));
  assert.doesNotMatch(svg, /<(?:image|script|foreignObject)\b|\b(?:href|on\w+)\s*=|url\s*\(|data:/iu);
  const registry = JSON.parse(read("tools/version-manifests.json"));
  const entry = registry.manifests.find(({ path: name }) => name === "docs/assets/readme/badge-version.svg");
  assert.equal(entry?.kind, "pinned");
  assert.equal(entry?.occurrences, 3);
});

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

// The GitHub README: every asset loads from the repository by a relative path that exists.
function assertPresentation(content, installAnchor, docsAnchor) {
  const assetRef = (path) => `./${path}`;
  const coverSrc = assetRef("docs/assets/cover-motion.webp");
  const motionStillSrc = assetRef("docs/assets/cover-motion-still.webp");
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
  assert.ok(content.includes(`src="${assetRef("docs/assets/readme/badge-version.svg")}" alt="${version}"`));
  assert.ok(content.includes(`](${assetRef("docs/assets/readme/ignition-poster.png")})](${assetRef("docs/assets/readme/ignition-film.mp4")})`));
  for (const name of [...Object.keys(assets), "badge-version.svg"]) {
    assert.ok(content.includes(`./docs/assets/readme/${name}`), `${name} must have a reader-facing use`);
  }
  for (const [, target] of content.matchAll(/\b(?:src|srcset|href)="(\.\/[^"#]+)"|\]\((\.\/[^)\s#]+)/gu)) {
    if (target) assert.ok(lstatSync(new URL(target, root)).isFile(), `GitHub README target must exist on disk: ${target}`);
  }
  assert.doesNotMatch(content, /cdn\.jsdelivr\.net/u, "the GitHub README must not wait for an npm publish to show its images");
  assert.doesNotMatch(content, /https?:\/\/img\.shields\.io|<!-- README visual draft|(?:src|href)="assets\/readme\//u);
}

// The npm README: a short card whose cover and badge load from jsDelivr at the package version.
function assertNpmCard(content, coverAlt, guide) {
  assert.ok(
    content.startsWith('<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="' + staticCoverSrc
      + '" /><img src="' + coverSrc + '" width="100%" alt="' + coverAlt + '" /></picture></p>\n\n<h1 align="center">LitClaude</h1>'),
    "the pinned motion cover must be the only picture above the title",
  );
  assert.match(content, /^<p align="center"><strong>Keep the work lit\.<\/strong><\/p>$/mu, "same tagline as the GitHub README");
  assert.match(content, /^<p align="center">[^<\n]*Claude Code[^<\n]*<\/p>$/mu, "the card names its host");
  assert.ok(content.includes(`src="${npmCdn}/docs/assets/readme/badge-version.svg" alt="${version}"`));
  assert.ok(content.includes(`href="${guide}"`), "the card links the full GitHub guide");
  assert.doesNotMatch(content, /(?:src|srcset|href)="\.{0,2}\/|\]\(\.{0,2}\//u, "no relative targets on the npm page");
}

test("bilingual README motion links preserve centered and copyable native ASCII", () => {
  assertPresentation(read("README.md"), "install", "deeper-docs");
  assertPresentation(read("README_ko-KR.md"), "설치", "추가-문서");
});

test("bilingual npm READMEs open with the pinned cover, the same name and tagline, and the GitHub guide", () => {
  assertNpmCard(read("README_npm.md"), coverAlts.install, "https://github.com/wjgoarxiv/litclaude#readme");
  assertNpmCard(read("README_npm_ko-KR.md"), coverAlts.설치, "https://github.com/wjgoarxiv/litclaude/blob/main/README_ko-KR.md");
  const card = read("README_npm.md");
  for (const mutation of [
    card.replace(coverSrc, "./docs/assets/cover-motion.webp"),
    card.replaceAll(`${npmCdn}/docs/assets/readme/badge-version.svg`, `https://cdn.jsdelivr.net/npm/@litfamily/litclaude@0.0.0/docs/assets/readme/badge-version.svg`),
    card.replace("https://github.com/wjgoarxiv/litclaude#readme", "#install"),
    card.replace("Keep the work lit.", "Keep it lit."),
  ]) {
    assert.notEqual(mutation, card);
    assert.throws(() => assertNpmCard(mutation, coverAlts.install, "https://github.com/wjgoarxiv/litclaude#readme"));
  }
});

test("README presentation rejects missing, shifted, or disconnected visual resources", () => {
  const content = read("README.md");
  assertPresentation(content, "install", "deeper-docs");
  const mark = `<p align="center"><img src="./docs/assets/readme/ascii-readme.svg" width="480" alt="LIT ASCII B mark" /></p>`;
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
    content.replaceAll("./docs/assets/readme/ignition-film.mp4", "missing.mp4"),
    content.replaceAll("./docs/assets/readme/Lucide-LICENSE.txt", "missing-license.txt"),
    content.replace('src="./docs/assets/readme/lucide-play.svg"', 'src="./docs/assets/readme/lucide-missing.svg"'),
    content.replace("./docs/assets/cover-motion.webp", `${npmCdn}/docs/assets/cover-motion.webp`),
  ]) assert.throws(() => assertPresentation(mutation, "install", "deeper-docs"));
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

// The promo film sits beside the cover, not inside the packed README asset folder, and follows the same 2.5 MiB rule.
// The Korean page shows the same film with Korean lines (the -ko files).
const promoRoot = new URL("docs/assets/promo/", root);
const promoFiles = {
  "litclaude-promo-ko-preview.webp": "e5c02a26695e60428b0c2341036387b9078bbda0e3a97028a330080ec8132b2c",
  "litclaude-promo-ko-still.webp": "553a99622c2f6793545dae2f8b4dcc42c4bea0c39a5f8fd011e4027758023af9",
  "litclaude-promo-ko.mp4": "4f405aa21bee55a94d755feafb10a92efd53253f5282cc748a11266bb33a0194",
  "litclaude-promo-preview.webp": "7d9598e61beb7307649c3e94e52f472726ce7ba3a4a92f4240a934c745e72918",
  "litclaude-promo-still.webp": "b90cadf7926ba85514c37c69b019918f1b1c3f6abb8c2d1ef7904df77c166ba7",
  "litclaude-promo.mp4": "708f25342ea6f8934e675faad24f5c77ac4ac5707d91ec15d6e2521131205550",
};
const promoSource = {
  "Pretendard-OFL.txt": "b04538c9abec39a3db75108cf0af0fd9c77032fe8aa2cf38345b4d250e98e38e",
  "index.html": "5e13254e85823dbcfabd5b61aed8aac57ad1298f8bccf24dc9355180fe553b48",
  "treatment-ko.json": "aa7e79dbbfdcbcfdd33a8f4e8ab85bbcd725eb277f0dfd751aaa9df9c92b0f4f",
  "treatment.json": "fed094af5a158ffc48cc03202874cde9ddbc29f6f21b7e620b26247f4842ec18",
};
const promoVariants = [
  { page: "README.md", heading: "## Watch it in motion", suffix: "" },
  { page: "README_ko-KR.md", heading: "## 움직이는 모습 보기", suffix: "-ko" },
];

test("promo film files keep their formats, sizes and approved bytes", () => {
  assert.deepEqual(readdirSync(promoRoot).sort(), [...Object.keys(promoFiles), "source"].sort());
  for (const [name, expected] of Object.entries(promoFiles)) {
    const bytes = readFileSync(new URL(name, promoRoot));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, name);
  }
  for (const { suffix } of promoVariants) {
    const preview = readFileSync(new URL(`litclaude-promo${suffix}-preview.webp`, promoRoot));
    assert.ok(preview.length <= 2_621_440, "the inline preview must stay under 2.5 MiB");
    assert.equal(preview.subarray(0, 4).toString(), "RIFF");
    assert.equal(preview.subarray(8, 12).toString(), "WEBP");
    assert.ok(preview.includes(Buffer.from("ANIM")), "the preview must be an animated WebP");
    const still = readFileSync(new URL(`litclaude-promo${suffix}-still.webp`, promoRoot));
    assert.ok(still.length <= 262_144, "the reduced-motion still stays small");
    assert.equal(still.subarray(8, 12).toString(), "WEBP");
    assert.ok(!still.includes(Buffer.from("ANIM")), "the reduced-motion still is not animated");
    const film = readFileSync(new URL(`litclaude-promo${suffix}.mp4`, promoRoot));
    assert.ok(film.length <= 8 * 1_048_576, "the master stays under 8 MiB");
    assert.equal(film.subarray(4, 8).toString(), "ftyp");
  }
  assert.deepEqual(readdirSync(new URL("source/", promoRoot)).sort(), Object.keys(promoSource).sort());
  for (const [name, expected] of Object.entries(promoSource)) {
    const bytes = readFileSync(new URL(`source/${name}`, promoRoot));
    assert.ok(bytes.length < 65_536, `${name} stays small`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, `source/${name}`);
  }
});

test("the film source sets its copy in Pretendard at weights 400 and 700 and keeps the font license beside it", () => {
  const page = readFileSync(new URL("source/index.html", promoRoot), "utf8");
  assert.doesNotMatch(page, /Archivo|Silkscreen|VT323|Galmuri/u, "the copy uses no other display face");
  const shorthands = [...page.matchAll(/font:\s*(\d{3})\s+[\d.]+px(?:\/[\d.]+(?:px)?)?\s+"([^"]+)"/gu)];
  assert.ok(shorthands.length > 10, "the page declares its faces with font shorthands");
  for (const [, weight, family] of shorthands) {
    assert.ok(["Pretendard", "MesloLGS NF"].includes(family), `only Pretendard and the terminal face are used, saw ${family}`);
    assert.ok(weight === "400" || weight === "700", `Pretendard and the terminal face are requested at 400 or 700 only, saw ${weight}`);
  }
  for (const treatment of ["treatment.json", "treatment-ko.json"]) {
    const faces = JSON.parse(readFileSync(new URL(`source/${treatment}`, promoRoot), "utf8")).typePlan.faces;
    assert.deepEqual(faces, ["Pretendard", "MesloLGS NF"], `${treatment} plans Pretendard and the terminal face only`);
  }
  const license = readFileSync(new URL("source/Pretendard-OFL.txt", promoRoot), "utf8");
  assert.match(license, /SIL Open Font License, Version 1\.1/u);
  assert.match(license, /Pretendard/u);
});

test("both GitHub pages embed their promo like the cover and the npm cards leave it out", () => {
  for (const { page: file, heading, suffix } of promoVariants) {
    const content = read(file);
    assert.equal(content.split("\n").filter((line) => line === heading).length, 1, `${file} has one motion section`);
    const section = content.slice(content.indexOf(heading), content.indexOf("\n## ", content.indexOf(heading) + 4));
    const picture = new RegExp(`<picture><source media="\\(prefers-reduced-motion: reduce\\)" srcset="\\./docs/assets/promo/litclaude-promo${suffix}-still\\.webp" /><img src="\\./docs/assets/promo/litclaude-promo${suffix}-preview\\.webp" width="100%" alt="([^"]{80,})" /></picture>`, "u").exec(section);
    assert.ok(picture, `${file} uses the cover's picture pattern with the still first and the preview as the image`);
    assert.ok(section.includes(`](./docs/assets/promo/litclaude-promo${suffix}.mp4)`), `${file} links its MP4 separately`);
    assert.ok(content.indexOf(heading) > content.indexOf("\n## "), `${file} places the section after the opening sections`);
    const cover = content.indexOf("cover-motion.webp");
    assert.ok(cover >= 0 && cover < content.indexOf(heading), `${file} keeps the cover first`);
    for (const [, target] of section.matchAll(/(?:src|srcset)="(\.\/[^"]+)"|\]\((\.\/[^)\s]+)\)/gu)) {
      if (target) assert.ok(lstatSync(new URL(target, root)).isFile(), `promo target must exist: ${target}`);
    }
  }
  for (const card of ["README_npm.md", "README_npm_ko-KR.md"]) assert.doesNotMatch(read(card), /assets\/promo|promo/u, `${card} does not embed the film`);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.files.some((entry) => /docs\/assets\/promo|^docs$|^docs\/assets$/u.test(entry)), false, "the promo film stays out of the tarball");
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MAX_BOUNDED_AGGREGATE_BYTES,
  MAX_BOUNDED_FILE_BYTES,
  readRegularStable,
} from "../plugins/litclaude/lib/secure-path-read.mjs";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function text(path) {
  return readFile(new URL(path, root), "utf8");
}

// The GitHub README loads its cover from the repository; the npm README from jsDelivr at the release.
const githubAssetBase = "./";
const npmAssetBase = "https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.18/";

function assertCoverPresentation(readme, coverAlt, assetBase = githubAssetBase) {
  const motionStill = `${assetBase}docs/assets/cover-motion-still.webp`;
  const motionCover = `${assetBase}docs/assets/cover-motion.webp`;
  assert.ok(readme.includes(`<source media="(prefers-reduced-motion: reduce)" srcset="${motionStill}" />`));
  assert.ok(readme.includes(`<img src="${motionCover}" width="100%" alt="${coverAlt}" />`));
  const hero = new RegExp(
    "^<p align=\"center\"><picture><source [^>]*/><img src=\"" + escapeRegExp(motionCover) +
      "\"[^>]*/></picture></p>\\n\\n<h1 align=\"center\">LitClaude</h1>",
    "u",
  );
  assert.match(readme, hero, "the motion cover must be the only picture above the title");
  assert.doesNotMatch(readme, /View the static cover|정지 표지 보기/u, "no keyboard-only static-cover link should remain");
}

// A literal home must start at a text boundary, not inside an HTTPS URL or another
// path segment. Account names are deliberately conservative so portable variables
// and placeholders do not become false positives.
const posixPrivateHome = /(?<![A-Za-z0-9._~/%-])\/(?:Users|home)\/[A-Za-z0-9._-]+(?=$|\/)/iu;
const windowsPrivateHome = /(?<![A-Za-z0-9._~/%\\-])[A-Za-z]:\\{1,2}Users\\{1,2}[A-Za-z0-9._-]+(?=$|\\{1,2})/iu;
const gitBashPrivateHome = /(?<![A-Za-z0-9._~/%-])\/[A-Za-z]\/Users\/[A-Za-z0-9._-]+(?=$|\/)/iu;
const wslPrivateHome = /(?<![A-Za-z0-9._~/%-])\/mnt\/[A-Za-z]\/Users\/[A-Za-z0-9._-]+(?=$|\/)/iu;
const fileUrlPrivateHome = /(?<![A-Za-z0-9._~/%-])file:\/\/(?:localhost)?\/(?:Users|home)\/[A-Za-z0-9._-]+(?=$|\/)/iu;

function hasPrivateHomePath(value) {
  return posixPrivateHome.test(value)
    || windowsPrivateHome.test(value)
    || gitBashPrivateHome.test(value)
    || wslPrivateHome.test(value)
    || fileUrlPrivateHome.test(value);
}

function capturePrivateHomeDocs(paths, options = {}) {
  const captureRoot = options.rootPath ?? rootPath;
  const maxFileBytes = options.maxFileBytes ?? MAX_BOUNDED_FILE_BYTES;
  const maxAggregateBytes = options.maxAggregateBytes ?? MAX_BOUNDED_AGGREGATE_BYTES;
  const expectedSnapshots = options.expectedSnapshots ?? new Map();
  const captured = new Map();
  let capturedBytes = 0;

  for (const path of paths) {
    const remainingBytes = maxAggregateBytes - capturedBytes;
    if (remainingBytes < 0) throw new Error(`${path}: AGGREGATE_TOO_LARGE`);
    const result = readRegularStable(
      captureRoot,
      join(captureRoot, path),
      expectedSnapshots.get(path),
      { maxBytes: Math.min(maxFileBytes, remainingBytes) },
    );
    if (result.failure) {
      const failure = result.failure === "FILE_TOO_LARGE" && remainingBytes < maxFileBytes
        ? "AGGREGATE_TOO_LARGE"
        : result.failure;
      throw new Error(`${path}: ${failure}`);
    }
    capturedBytes += result.bytes.length;
    captured.set(path, { text: result.bytes.toString("utf8"), snapshot: result.snapshot });
  }
  return captured;
}

async function assertNoPrivateHomePaths(paths, readDoc = text) {
  for (const path of paths) {
    assert.equal(hasPrivateHomePath(await readDoc(path)), false, `${path} contains a private home path`);
  }
}

function assertCandidateAvailabilityStructure(content, candidateVersion, language) {
  const lines = content.split(/\r?\n/u);
  const candidatePattern = escapeRegExp(candidateVersion);
  const candidate = new RegExp(candidatePattern, "u");
  const lookup = new RegExp(`npm view @litfamily/litclaude@${candidatePattern} version`, "u");
  const exactInstall = new RegExp(`npm exec --yes --package @litfamily/litclaude@${candidatePattern} -- litclaude install`, "u");
  const rules = language === "en"
    ? {
        claim: /\b(?:available|unavailable|installable)\b|\b(?:can|cannot|can't) be installed\b/iu,
        conditional: /\b(?:if|when|unless|provided that|otherwise)\b/iu,
        otherwiseWait: /\bOtherwise\b.*\bwait\b/iu,
      }
    : {
        claim: /설치할 수 (?:있|없)|설치 (?:가능|불가)(?:합니다|입니다)|exact install.*사용할 수 (?:있|없)/u,
        conditional: /(?:이면|라면|반환하면|확인되면|경우|때만|그렇지 않으면)/u,
        otherwiseWait: /그렇지 않으면.*기다/u,
      };

  for (const line of lines) {
    if (candidate.test(line) && rules.claim.test(line)) {
      assert.match(line, rules.conditional, `${language} candidate availability claim must be conditional: ${line}`);
    }
  }

  const lookupIndex = lines.findIndex((line) => lookup.test(line));
  const successIndex = lines.findIndex((line) => candidate.test(line) && rules.claim.test(line) && rules.conditional.test(line));
  const exactInstallIndex = lines.findIndex((line) => exactInstall.test(line));
  const otherwiseWaitIndex = lines.findIndex((line) => rules.otherwiseWait.test(line));

  assert.ok(lookupIndex >= 0, `${language} candidate registry lookup is required`);
  assert.ok(successIndex >= 0, `${language} conditional candidate success branch is required`);
  assert.ok(exactInstallIndex >= 0, `${language} exact candidate install is required`);
  assert.ok(otherwiseWaitIndex >= 0, `${language} conditional otherwise/wait branch is required`);
  assert.ok(lookupIndex < successIndex, `${language} registry lookup must precede conditional success`);
  assert.ok(successIndex < exactInstallIndex, `${language} conditional success must precede exact install`);
  assert.ok(lookupIndex < otherwiseWaitIndex, `${language} registry lookup must precede conditional otherwise/wait`);
  assert.ok(exactInstallIndex < otherwiseWaitIndex, `${language} exact install must precede conditional otherwise/wait`);
}

test("private home path detection distinguishes literal homes from portable notation", () => {
  const positiveCases = [
    ["bare macOS home", "/Users/alice"],
    ["nested macOS home", "artifact: /Users/alice/project/file.md"],
    ["bare Linux home", "/home/alice"],
    ["nested Linux home", "artifact=/home/alice/project/file.md"],
    ["bare Windows home", String.raw`C:\Users\alice`],
    ["case-insensitive nested Windows home", String.raw`d:\users\Alice\project\file.md`],
    ["JSON-escaped Windows home", String.raw`{"path":"C:\\Users\\alice\\project"}`],
    ["bare Git Bash home", "/c/Users/alice"],
    ["nested Git Bash home", "/c/Users/alice/project/file.md"],
    ["bare WSL-mounted Windows home", "/mnt/c/Users/alice"],
    ["nested WSL-mounted Windows home", "/mnt/c/Users/alice/project/file.md"],
    ["bare macOS file URL", "file:///Users/alice"],
    ["nested macOS file URL", "file:///Users/alice/project/file.md"],
    ["bare Linux file URL", "file:///home/alice"],
    ["nested Linux file URL", "file:///home/alice/project/file.md"],
    ["localhost macOS file URL", "file://localhost/Users/alice/project"],
    ["localhost Linux file URL", "file://localhost/home/alice/project"],
  ];
  const negativeCases = [
    ["HTTPS macOS-shaped path", "https://example.test/Users/alice"],
    ["HTTPS Linux-shaped path", "https://example.test/home/alice"],
    ["HTTPS Git Bash-shaped path", "https://example.test/c/Users/alice"],
    ["HTTPS WSL-shaped path", "https://example.test/mnt/c/Users/alice"],
    ["angle-bracket username", "/Users/<username>/project"],
    ["shell username", "/Users/$USER/project"],
    ["braced shell username", "/Users/${USER}/project"],
    ["Windows username variable", String.raw`C:\Users\%USERNAME%\project`],
    ["Windows profile variable", String.raw`%USERPROFILE%\project`],
    ["PowerShell profile variable", String.raw`$env:USERPROFILE\project`],
    ["shell home", "$HOME/project"],
    ["tilde home", "~/project"],
    ["Git Bash shell username", "/c/Users/$USER/project"],
    ["WSL angle-bracket username", "/mnt/c/Users/<username>/project"],
    ["macOS file URL shell username", "file:///Users/${USER}/project"],
    ["Linux file URL angle-bracket username", "file:///home/<username>/project"],
    ["file URL embedded in HTTPS URL", "https://example.test/file:///Users/alice"],
  ];

  for (const [label, value] of positiveCases) assert.equal(hasPrivateHomePath(value), true, label);
  for (const [label, value] of negativeCases) assert.equal(hasPrivateHomePath(value), false, label);
});

test("privacy guard capture fails closed on replacement, symlinks, and byte bounds", () => {
  const fixture = mkdtempSync(join(tmpdir(), "litclaude-private-home-guard-"));
  try {
    mkdirSync(join(fixture, "docs"));
    writeFileSync(join(fixture, "docs", "stable.md"), "safe\n");
    const first = capturePrivateHomeDocs(["docs/stable.md"], {
      rootPath: fixture,
      maxFileBytes: 64,
      maxAggregateBytes: 128,
    });
    assert.equal(first.get("docs/stable.md").text, "safe\n");

    writeFileSync(join(fixture, "docs", "replacement.md"), "replacement\n");
    renameSync(join(fixture, "docs", "replacement.md"), join(fixture, "docs", "stable.md"));
    assert.throws(
      () => capturePrivateHomeDocs(["docs/stable.md"], {
        rootPath: fixture,
        maxFileBytes: 64,
        maxAggregateBytes: 128,
        expectedSnapshots: new Map([["docs/stable.md", first.get("docs/stable.md").snapshot]]),
      }),
      /(?:FILE_IDENTITY|ANCESTOR)_CHANGED/u,
    );

    writeFileSync(join(fixture, "docs", "target.md"), "safe\n");
    symlinkSync(join(fixture, "docs", "target.md"), join(fixture, "docs", "file-link.md"));
    assert.throws(
      () => capturePrivateHomeDocs(["docs/file-link.md"], { rootPath: fixture }),
      /NON_REGULAR/u,
    );

    mkdirSync(join(fixture, "outside"));
    writeFileSync(join(fixture, "outside", "linked.md"), "safe\n");
    symlinkSync(join(fixture, "outside"), join(fixture, "linked"), "dir");
    assert.throws(
      () => capturePrivateHomeDocs(["linked/linked.md"], { rootPath: fixture }),
      /ANCESTOR_INVALID/u,
    );

    writeFileSync(join(fixture, "docs", "oversize.md"), "12345");
    assert.throws(
      () => capturePrivateHomeDocs(["docs/oversize.md"], {
        rootPath: fixture,
        maxFileBytes: 4,
        maxAggregateBytes: 16,
      }),
      /FILE_TOO_LARGE/u,
    );

    writeFileSync(join(fixture, "docs", "aggregate-a.md"), "12345");
    writeFileSync(join(fixture, "docs", "aggregate-b.md"), "67890");
    assert.throws(
      () => capturePrivateHomeDocs(["docs/aggregate-a.md", "docs/aggregate-b.md"], {
        rootPath: fixture,
        maxFileBytes: 8,
        maxAggregateBytes: 8,
      }),
      /AGGREGATE_TOO_LARGE/u,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("README documents local Claude plugin usage and safety boundaries", async () => {
  const readme = await text("README.md");

  assertCoverPresentation(readme, "LitFamily motion cover: five armored robots power on one by one, the LitClaude robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up.");
  assert.match(readme, /<h1 align="center">LitClaude<\/h1>/u);
  assert.match(readme, /src="\.\/docs\/assets\/readme\/badge-version\.svg"/u);
  assert.match(await text("README_npm.md"), /src="https:\/\/cdn\.jsdelivr\.net\/npm\/@litfamily\/litclaude@1\.0\.18\/docs\/assets\/readme\/badge-version\.svg"/u);
  assert.match(readme, /README_ko-KR\.md/u);
  assert.match(readme, /lit-burnoff-file/u);
  assert.match(readme, /lit-code\/references/u);
  assert.match(readme, /CHANGELOG\.md/u);
  assert.match(readme, /LitClaude HUD/u);
  assert.match(readme, /\[🔥LITCLAUDE vX\.Y\.Z\]/u);
  assert.match(readme, /ctx \[▎░░\]/u);
  assert.match(readme, /5h \[▏░\] 4% ↻/u);
  assert.match(readme, /claude --plugin-dir \.\/plugins\/litclaude/);
  assert.match(readme, /\/reload-plugins/);
  assert.match(readme, /uninstall/i);
  assert.match(readme, /LitClaude adds evidence-first execution, planning, research and review to Claude Code\./u);
  assert.match(readme, /resilient public-source research/i);
  assert.doesNotMatch(readme, /next `0\.1\.2` patch/i);
  assert.match(readme, /explicit user approval/i);
});

test("both READMEs state the install-time network pre-warm and the switches the code reads", async () => {
  const postinstall = await text("scripts/postinstall.mjs");
  const cli = await text("bin/litclaude-ai.js");
  const switches = ["LITCLAUDE_MOTION_PREWARM=0", "LITCLAUDE_AUTO_INSTALL=0", "LITCLAUDE_POSTINSTALL_SKIP=1"];
  for (const name of switches) {
    const [key, value] = name.split("=");
    assert.ok(`${postinstall}\n${cli}`.includes(`process.env.${key} === "${value}"`), `code still reads ${name}`);
  }
  for (const [path, heading] of [["README.md", "\n## Install\n"], ["README_ko-KR.md", "\n## 설치\n"]]) {
    const readme = await text(path);
    const start = readme.indexOf(heading);
    assert.notEqual(start, -1, `${path} has an install section`);
    const install = readme.slice(start, readme.indexOf("\n## ", start + 1));
    for (const phrase of [...switches, "npm ci", "npm install -g", "scripts/postinstall.mjs", "--ignore-scripts", "litclaude-ai motion-runtime install"]) {
      assert.ok(install.includes(phrase), `${path} install section names ${phrase}`);
    }
  }
});

test("English and Korean route tables retain browser-drive and omit removed skill learning", async () => {
  for (const [label, path, heading, inventory] of [
    ["English README", "README.md", "## What to type", /package's 35 skills/u],
    ["Korean README", "README_ko-KR.md", "## 무엇을 입력하나요", /35개 skill/u],
  ]) {
    const readme = await text(path);
    const routeTable = readme.match(new RegExp(`${escapeRegExp(heading)}[\\s\\S]*?(?=\\n## |$)`, "u"))?.[0] ?? "";
    assert.notEqual(routeTable, "", `${label} must contain its route table`);
    assert.match(routeTable, /`browser-drive`/u, `${label} route table must retain browser-drive`);
    assert.match(readme, inventory, `${label} inventory count must include README Studio and exclude removed skills`);
    assert.match(readme, /`readme-studio`/u, `${label} must expose README Studio`);
    assert.doesNotMatch(readme, /skill-observer|skill learning loop|skill-loop|pending-review/iu);
  }
});

test("release notes explain removal and the inert legacy files", async () => {
  const changelog = await text("CHANGELOG.md");
  const release = changelog.match(/^## 1\.0\.7\n([\s\S]*?)(?=^## )/mu)?.[1] ?? "";
  assert.match(release, /Remove automatic skill review\. It never completed a review in practice/u);
  assert.match(release, /\.litclaude\/pending-review\.json and \.litclaude\/skill-loop-state\.json files are inert and may be deleted/u);
  assert.match(release, /No other state is affected/u);
});

test("methodology provenance limits clean-room claims without removing attribution", async () => {
  const provenance = await text("plugins/litclaude/vendor/provenance/methodology-sources.md");

  assert.match(provenance, /No upstream implementation bytes are included/u);
  assert.match(provenance, /source identifiers[\s\S]{0,120}pinned commits[\s\S]{0,120}attribution/iu);
  assert.doesNotMatch(
    provenance,
    /No file, fragment, identifier, route name, command name, or\s+verbatim sentence[^\n]*present in any LitFamily tracked surface/u,
  );
  assert.match(provenance, /vercel-labs\/agent-browser/u);
  assert.match(provenance, /548b159b30eef119ccf6846c8bc807d0eaa3f6f8/u);
});

test("public skill inventories document the auxiliary packs and their chat routes", async () => {
  const readme = await text("README.md");
  const readmeKo = await text("README_ko-KR.md");
  const audit = await text("docs/workflow-compatibility-audit.md");
  const combined = `${readme}\n${readmeKo}\n${audit}`;

  for (const [label, content] of [
    ["README", readme],
    ["Korean README", readmeKo],
    ["workflow audit", audit],
  ]) {
    for (const skillId of ["frontend-ui-ux", "lit-commit", "lsp-setup", "visual-qa"]) {
      assert.match(content, new RegExp(escapeRegExp(skillId), "u"), `${label} missing auxiliary skill ${skillId}`);
    }
    assert.match(content, /Skill-discovery/u, `${label} should document auxiliary skills as Skill-discovery surfaces`);
  }

  // INVERTED on user approval. These four previously carried no chat route at all, and the
  // absence was a documented product decision this assertion enforced. The consumer probe
  // showed the capability was reachable only AFTER an edit had started, which for a design
  // skill is backwards, so the routes were opened and the docs must now describe them.
  for (const [label, content] of [["README", readme], ["Korean README", readmeKo]]) {
    assert.match(content, /\$(frontend-ui-ux|lit-commit|lsp-setup|visual-qa)\b/u, `${label} must show the dollar route`);
    assert.match(content, /bare token/iu, `${label} must describe the bare-token route`);
    assert.match(content, /anywhere-token/u, `${label} must say these are NOT anywhere-tokens`);
  }
  // Still no slash command for any of them: no commands/*.md exists, and inventing a route
  // Claude Code cannot serve would be a dead surface.
  assert.doesNotMatch(combined, /\/litclaude:(frontend-ui-ux|lit-commit|lsp-setup|visual-qa)\b/u);
});

test("agent and migration docs route the retired Korean names to lit-humanizer", async () => {
  const agents = await text("docs/agents.md");
  const migration = await text("docs/migration.md");
  for (const alias of ["lit-korean", "korean-ai-slop-remover", "text-naturalization"]) {
    assert.ok(agents.includes(alias), `agents.md must list ${alias}`);
    assert.ok(migration.includes(alias), `migration.md must list ${alias}`);
  }
  assert.match(agents, /\/litclaude:lit-humanizer.*Skill\(lit-humanizer\)/su);
  assert.match(migration, /\| `lit-korean` \| `lit-humanizer` \|/u);
  assert.match(migration, /\/litclaude:lit-korean/u);
});

test("README documents fresh-PC npm-compatible install commands", async () => {
  const readme = await text("README.md");
  const candidateVersion = JSON.parse(await text("package.json")).version;
  const candidatePattern = escapeRegExp(candidateVersion);

  assert.match(readme, /npm exec --yes --package @litfamily\/litclaude@latest -- litclaude install/u);
  assert.match(readme, /LITCLAUDE_HUD_ACCENT/u);
  assert.match(readme, /rate-limit reset/u);
  assert.match(readme, /\/deep-interview/u);
  assert.match(readme, /claude$/mu);
  assert.match(readme, /npm install -g @litfamily\/litclaude/u);
  assert.match(readme, /npm view @litfamily\/litclaude@/u);
  assert.match(readme, new RegExp(`npm view @litfamily/litclaude@${candidatePattern} version`, "u"));
  assert.match(readme, new RegExp(`If that lookup returns[^\\n]*${candidatePattern}[^\\n]*exact install is available:[\\s\\S]{0,200}npm exec --yes --package @litfamily/litclaude@${candidatePattern} -- litclaude install`, "u"));
  assert.match(readme, /Otherwise, wait for explicit human publication/u);
  assertCandidateAvailabilityStructure(readme, candidateVersion, "en");
  for (const claim of [`${candidateVersion} is unavailable.`, `${candidateVersion} is available.`]) {
    assert.throws(
      () => assertCandidateAvailabilityStructure(`${readme}\n${claim}\n`, candidateVersion, "en"),
      /candidate availability claim must be conditional/u,
    );
  }
  const lookupCommand = `npm view @litfamily/litclaude@${candidateVersion} version`;
  assert.throws(
    () => assertCandidateAvailabilityStructure(`${readme.replace(lookupCommand, "")}\n${lookupCommand}\n`, candidateVersion, "en"),
    /registry lookup must precede/u,
  );
  assert.doesNotMatch(readme, new RegExp(`normal install command works:[\\s\\S]{0,100}@litfamily/litclaude@${candidatePattern} -- litclaude install`, "u"));
  assert.match(readme, /npm exec --yes --package @litfamily\/litclaude@latest -- litclaude doctor/u);
  assert.match(readme, /uninstall/u);
  assert.doesNotMatch(readme, /claude --plugin-dir "\$\(npx --yes litclaude-ai path\)"/u);
  assert.doesNotMatch(readme, /npx litclaude-ai litclaude install/u);
  assert.doesNotMatch(readme, /\.omc\//u);
});

test("Korean README mirrors install, usage, and release-boundary guidance", async () => {
  const readmeKo = await text("README_ko-KR.md");
  const candidateVersion = JSON.parse(await text("package.json")).version;
  const candidatePattern = escapeRegExp(candidateVersion);

  assertCoverPresentation(readmeKo, "LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitClaude 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상");
  assert.match(readmeKo, /<h1 align="center">LitClaude<\/h1>/u);
  assert.match(readmeKo, /src="\.\/docs\/assets\/readme\/badge-version\.svg"/u);
  assert.match(await text("README_npm_ko-KR.md"), /src="https:\/\/cdn\.jsdelivr\.net\/npm\/@litfamily\/litclaude@1\.0\.18\/docs\/assets\/readme\/badge-version\.svg"/u);
  assert.match(readmeKo, /README\.md/u);
  assert.match(readmeKo, /lit-burnoff-file/u);
  assert.match(readmeKo, /debugging\/references/u);
  assert.match(readmeKo, /CHANGELOG\.md/u);
  assert.match(readmeKo, /LitClaude HUD/u);
  assert.match(readmeKo, /\[🔥LITCLAUDE vX\.Y\.Z\]/u);
  assert.match(readmeKo, /ctx \[▎░░\]/u);
  assert.match(readmeKo, /5h \[▏░\] 4% ↻/u);
  assert.match(readmeKo, /LitClaude/u);
  assert.match(readmeKo, /public-source research|공개 소스 조사/u);
  assert.match(readmeKo, /litresearch/u);
  assert.match(readmeKo, /\$litresearch/u);
  assert.match(readmeKo, /read-only/u);
  assert.match(readmeKo, /npm exec --yes --package @litfamily\/litclaude@latest -- litclaude install/u);
  assert.match(readmeKo, /LITCLAUDE_HUD_ACCENT/u);
  assert.match(readmeKo, /↻/u);
  assert.match(readmeKo, /rate-limit reset|reset countdown|리셋/u);
  assert.match(readmeKo, /\/deep-interview/u);
  assert.match(readmeKo, /claude/iu);
  assert.match(readmeKo, /claude$/mu);
  assert.match(readmeKo, /registry|마켓플레이스/iu);
  assert.match(readmeKo, new RegExp(`npm view @litfamily/litclaude@${candidatePattern} version`, "u"));
  assert.match(readmeKo, new RegExp(`조회 결과가[^\\n]*${candidatePattern}[^\\n]*exact install을 사용할 수 있습니다[\\s\\S]{0,200}npm exec --yes --package @litfamily/litclaude@${candidatePattern} -- litclaude install`, "u"));
  assert.match(readmeKo, /그렇지 않으면 명시적인 human publication을 기다립니다/u);
  assertCandidateAvailabilityStructure(readmeKo, candidateVersion, "ko");
  for (const claim of [`${candidateVersion}은 설치할 수 없습니다.`, `${candidateVersion}은 설치할 수 있습니다.`]) {
    assert.throws(
      () => assertCandidateAvailabilityStructure(`${readmeKo}\n${claim}\n`, candidateVersion, "ko"),
      /candidate availability claim must be conditional/u,
    );
  }
  const lookupCommand = `npm view @litfamily/litclaude@${candidateVersion} version`;
  assert.throws(
    () => assertCandidateAvailabilityStructure(`${readmeKo.replace(lookupCommand, "")}\n${lookupCommand}\n`, candidateVersion, "ko"),
    /registry lookup must precede/u,
  );
  assert.doesNotMatch(readmeKo, new RegExp(`새 폴더에서는 일반 설치 명령이 정상 동작합니다[\\s\\S]{0,100}@litfamily/litclaude@${candidatePattern} -- litclaude install`, "u"));
  assert.match(readmeKo, new RegExp("/litclaude:lit-loop", "u"));
  assert.doesNotMatch(readmeKo, /claude --plugin-dir "\$\(npx --yes litclaude-ai path\)"/u);
  assert.doesNotMatch(readmeKo, /npx litclaude-ai litclaude install/u);
  assert.doesNotMatch(readmeKo, /\.omc\//u);
});

test("documentation set covers hooks, agents, LSP, and migration", async () => {
  const files = [
    "docs/hooks.md",
    "docs/agents.md",
    "docs/lsp.md",
    "docs/migration.md",
    "docs/workflow-compatibility-audit.md",
  ];

  for (const file of files) {
    const content = await text(file);
    assert.ok(content.includes("LitClaude"), `${file} should name LitClaude`);
  }

  const migration = await text("docs/migration.md");
  assert.match(migration, /\| Reference surface \| Claude Code surface \|/);
  assert.match(migration, /hooks/i);
  assert.match(migration, /LSP/i);
  assert.match(migration, /Launch Claude Code normally/u);
  assert.match(migration, /known_marketplaces\.json/u);
  assert.doesNotMatch(migration, new RegExp(`\\b${["lazy", "claude"].join("")} run\\b`, "u"));
  assert.doesNotMatch(migration, /claude --plugin-dir "\$\(npx --yes litclaude-ai path\)"/u);
});

test("tracked product documentation contains no private home paths", async () => {
  const tracked = spawnSync("git", ["ls-files", "-z", "--", "*.md"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(tracked.status, 0, tracked.stderr);

  const pluginRoot = fileURLToPath(new URL("plugins/litclaude/", root));
  const [{ verifyCanonicalFrontendCorpus }, { verifyCanonicalRuntimeClosures }] = await Promise.all([
    import("../plugins/litclaude/lib/canonical-frontend-corpus.mjs"),
    import("../plugins/litclaude/lib/canonical-runtime-closures.mjs"),
  ]);
  const frontend = verifyCanonicalFrontendCorpus(pluginRoot);
  const runtime = verifyCanonicalRuntimeClosures(pluginRoot);
  assert.equal(frontend.status, "PASS", JSON.stringify(frontend.failures));
  assert.equal(runtime.status, "PASS", JSON.stringify(runtime.failures));

  const trackedDocs = tracked.stdout.split("\0").filter(Boolean);
  const protectedDocs = new Set([
    ...frontend.protectedPaths,
    ...runtime.expectedPackageFiles.keys(),
  ]);
  const localStatePrefixes = [".litclaude/", ".omc/", "evidence/", "plans/", "test/evidence/"];
  const productDocs = trackedDocs
    .filter((path) => path !== "HANDOFF.md" && path !== "HANDOFF_litclaude.md")
    .filter((path) => !localStatePrefixes.some((prefix) => path.startsWith(prefix)))
    .filter((path) => !protectedDocs.has(path));
  const mutableVendorNotice = "plugins/litclaude/vendor/NOTICE.md";

  assert.equal(protectedDocs.has(mutableVendorNotice), false, `${mutableVendorNotice} must not be byte-protected`);
  assert.ok(productDocs.includes(mutableVendorNotice), `${mutableVendorNotice} must be scanned`);
  await assert.rejects(
    assertNoPrivateHomePaths([mutableVendorNotice], async () => "private path: /Users/example/project/"),
    new RegExp(escapeRegExp(mutableVendorNotice), "u"),
  );
  const capturedDocs = capturePrivateHomeDocs(productDocs);
  await assertNoPrivateHomePaths(productDocs, async (path) => capturedDocs.get(path).text);
});

test("native goal matrix distinguishes supported session owners without claiming a plugin bridge", async () => {
  const goalDoc = await text("docs/native-goal-surface.md");
  const readme = await text("README.md");
  const readmeKo = await text("README_ko-KR.md");
  const changelog = await text("CHANGELOG.md");

  for (const phrase of [
    "User / Remote Control",
    "SDK-owned session",
    "Separate `claude -p` session",
    "arbitrary already-open TUI",
    ".litclaude/litgoal",
  ]) assert.match(goalDoc, new RegExp(escapeRegExp(phrase), "u"));
  assert.match(goalDoc, /ready to paste/iu);
  assert.match(goalDoc, /READY_TO_PASTE/u);
  assert.match(goalDoc, /nextAction: "ready-to-paste"/u);
  assert.match(goalDoc, /copy, paste, and\s+send/iu);
  assert.match(goalDoc, /no runtime bridge/iu);
  assert.match(goalDoc, /does not add a fake command, MCP method, or hook dispatch/iu);
  assert.match(goalDoc, /Claude Code >=2\.1\.139/u);
  assert.match(goalDoc, /workspace trust/iu);
  assert.match(goalDoc, /hooks.*managed policy/isu);
  assert.match(goalDoc, /system\/init `slash_commands`/u);
  assert.match(readme, /docs\/native-goal-surface\.md/u);
  assert.match(readmeKo, /docs\/native-goal-surface\.md/u);
  assert.match(changelog, /native `\/goal` capability matrix/u);
});

test("documentation explains exact LitClaude LIT trigger phrases", async () => {
  const readme = await text("README.md");
  const hooks = await text("docs/hooks.md");
  const combined = `${readme}\n${hooks}`;

  for (const trigger of [
    "lit",
    "litwork",
    "lit plan",
    "lit review",
    "lit research",
    "litresearch",
    "lit search",
    "lit query",
    "lit goal",
    "lit workflow",
    "lit dynamic workflow",
    "lit ultracode",
    "lit team",
    "lit team mode",
    "lit teammates",
    "lit start work",
    "$lit-plan",
    "/lit-plan",
    "$lit-loop",
    "/lit-loop",
    "$litresearch",
    "/litclaude:litresearch",
    "$start-work",
    "/start-work",
    "$deep-interview",
    "/deep-interview",
  ]) {
    assert.match(combined, new RegExp(trigger.replace("$", "\\$"), "i"));
  }

  assert.match(combined, new RegExp("LITWORK MODE ENABLED", "i"));
  assert.match(combined, /🔥 LIT IGNITED · <discipline> 🔥/u);
  assert.match(combined, new RegExp("Skill\\(lit-loop\\)", "i"));
  assert.match(combined, /hook context/i);
  assert.match(combined, new RegExp("/litclaude:lit-loop", "i"));
  assert.match(combined, /Slash commands[\s\S]*native command surface/i);
  assert.match(combined, /transcript-only/i);
  assert.match(combined, /read-only/i);
  assert.match(combined, /host-dependent/i);
  assert.match(combined, /guaranteed runtime surface/i);
  assert.match(combined, /Natural `lit start work`[\s\S]*BLOCKED:/i);
  assert.match(combined, /does not echo prompt text/i);
  assert.doesNotMatch(combined, /sanitiz/i);
});

test("hook documentation exposes the LLM contract vocabulary and schema", async () => {
  const hooks = await text("docs/hooks.md");

  for (const heading of [
    "## #contract.activation",
    "## #contract.inputs",
    "## #contract.mode_matrix",
    "## #contract.procedure",
    "## #contract.outputs",
    "## #contract.evidence",
    "## #contract.hard_stops",
    "## #contract.anti_patterns",
  ]) {
    assert.match(hooks, new RegExp(escapeRegExp(heading), "u"), `hooks docs missing ${heading}`);
  }

  assert.match(hooks, /contract_schema_version:\s*litclaude\.llm-contract\.v1/u);
  assert.match(hooks, /UserPromptSubmit/u);
  assert.match(hooks, /Claude Code plugin/u);
  assert.match(hooks, /^\|[^\n]+\|\n\|[-:| ]+\|/mu);
});

test("hooks docs describe the changed-text humanizer guard without skill-genre gating", async () => {
  const hooks = await text("docs/hooks.md");
  const start = hooks.indexOf("### Changed-text humanizer guard");
  assert.notEqual(start, -1, "hooks docs should explain the current humanizer guard");
  const end = hooks.indexOf("\n### ", start + 4);
  const guard = hooks.slice(start, end === -1 ? undefined : end);

  assert.match(guard, /PreToolUse[\s\S]*block-tier[\s\S]*deny/iu);
  assert.match(guard, /`Write`, `Edit`,\s*and `MultiEdit`/u);
  assert.match(guard, /reader-facing text write/u);
  assert.match(guard, /added or changed lines/u);
  assert.match(guard, /does not depend on a loaded skill or declared artifact genre/iu);
  assert.match(guard, /PostToolUse[\s\S]*DOCX[\s\S]*PPTX[\s\S]*PDF[\s\S]*Bash/u);
  assert.match(guard, /stdout[\s\S]*stderr/u);
  assert.match(guard, /cannot deny[\s\S]*or roll back/iu);
  assert.match(guard, /internal paths/u);
  assert.match(guard, /one-line[\s\S]*note/u);
  assert.doesNotMatch(guard, /client_deliverable|artifact_genre|limitations_channel/iu);
  assert.doesNotMatch(hooks, /only for `client_deliverable` \/ `reply`/u);
  assert.doesNotMatch(hooks, /DELIVERABLE_HEDGE_VIOLATION|client.deliverable write|file has already been written/iu);
});

test("hook, rules, and frontend docs describe the shipped activation and mutation surfaces", async () => {
  const hooks = await text("docs/hooks.md");
  const rules = await text("docs/rules.md");
  const frontend = await text("plugins/litclaude/skills/frontend-ui-ux/SKILL.md");

  assert.match(hooks, /plugins\/litclaude\/hooks\/hooks\.json/u);
  assert.match(hooks, /settings\.json.*enabledPlugins/isu);
  assert.match(hooks, /SessionStart[\s\S]*source:\s*compact[\s\S]*2-per-session/isu);
  assert.match(hooks, /budget reservation.*durably persisted/isu);
  assert.match(hooks, /do(?:es)? not re-inject/iu);
  assert.match(hooks, /missing.*initialize.*count 0/isu);
  assert.match(hooks, /malformed|corrupt/iu);
  assert.match(hooks, /exclusive.*lock/isu);
  assert.match(hooks, /closed backtick and tilde code fences/iu);
  assert.match(hooks, /intentionally unclosed.*eligible/isu);

  assert.match(rules, /UserPromptSubmit.*whether or not.*workflow.*activat/isu);
  assert.match(rules, /compact-sourced[\s\S]*SessionStart[\s\S]*2-per-session/isu);
  assert.match(rules, /\.litclaude\/rules\/session-<id>\.json/u);
  assert.match(rules, /mutat/iu);
  assert.match(rules, /basename.*`\*\.md`.*`docs\/README\.md`.*match/isu);

  assert.match(frontend, /automatic_hook_injection:\s*true/u);
  assert.match(frontend, /UserPromptSubmit/u);
  assert.match(frontend, /\$frontend-ui-ux/u);
  assert.match(frontend, /natural-language.*interface/isu);
  assert.match(frontend, /PostToolUse/u);
  assert.match(frontend, /command_route:\s*none/u);
});

test("public inventory names shipped skills and permission-mode mutations", async () => {
  const readme = await text("README.md");
  for (const skillId of ["litwork", "structural-search", "lit-team", "autoresearch", "autoconference", "wikify"]) {
    assert.match(readme, new RegExp(`\\b${skillId}\\b`, "u"), `README inventory must name ${skillId}`);
  }
  assert.match(readme, /permissions\.allow/u);
  assert.match(readme, /permissions\.deny/u);
  assert.match(readme, /preserv/iu);
  assert.match(readme, /insert/iu);
  assert.match(readme, /remov/iu);

  const skillInventory = /\*\*Claude skills\*\*[\s\S]*?\n- \*\*/u.exec(readme)?.[0] ?? "";
  for (const skillId of ["litwork", "structural-search", "lit-team"]) {
    assert.match(skillInventory, new RegExp(`\\b${skillId}\\b`, "u"), `README skill inventory must name ${skillId}`);
  }
});

test("documentation explains native goal and Dynamic workflow behavior", async () => {
  const readme = await text("README.md");
  const readmeKo = await text("README_ko-KR.md");
  const hooks = await text("docs/hooks.md");
  const migration = await text("docs/migration.md");
	const dynamicWorkflow = await text("plugins/litclaude/commands/lit-loop.md");
	const combined = `${readme}\n${readmeKo}\n${hooks}\n${migration}\n${dynamicWorkflow}`;

  assert.match(combined, /\/goal/u);
  assert.match(combined, /get_goal/u);
  assert.match(combined, /create_goal/u);
  assert.match(combined, /update_goal/u);
  assert.match(combined, /Dynamic workflow/u);
  assert.match(combined, /Dynamic worktree/u);
  assert.match(combined, /call the `Workflow` tool|call `Workflow`/u);
  assert.match(combined, /EnterWorktree/u);
  assert.match(combined, /does not auto-type `\/goal`/i);
  assert.match(combined, /attempts native goal binding/i);
  assert.match(combined, /BLOCKED:/u);
  assert.match(combined, /degraded-mode|degraded mode/i);
  assert.match(combined, /durable `litgoal` ledger/u);
  assert.match(combined, /claude -p "\/goal/u);
  assert.match(combined, /native-worker/u);
  assert.match(combined, /separate worker session|separate native `\/goal` worker/iu);
  assert.match(combined, /not current-TUI auto-arm|does not arm the already-open TUI/iu);
  assert.match(combined, /native goal surface/i);
  assert.match(combined, /goal tools are unavailable|goal tools are not exposed|not expose model-facing goal tools/iu);
  assert.match(combined, /claude --worktree/u);
  assert.match(combined, /--tmux/u);
  assert.match(combined, new RegExp("/litclaude:lit-loop", "u"));
  assert.match(combined, /\/litclaude:lit-loop/u);
  assert.match(combined, /workflow-check/u);
  assert.match(combined, /subagent delegation/i);
  assert.match(combined, /ultracode/u);
  assert.match(combined, /CLAUDE_CODE_DISABLE_WORKFLOWS=1/u);
	assert.match(combined, /CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1/u);
	assert.match(combined, /CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=1/u);
	assert.match(combined, /16 concurrent agents/u);
	assert.match(combined, /1000\s+total agents/u);
	assert.match(combined, /acceptEdits/u);
	assert.match(combined, /one native team/u);
	assert.match(combined, /graceful shutdown/u);
	assert.match(combined, /orphan.*tmux|tmux.*orphan/iu);
  assert.match(combined, /CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1/u);
  assert.match(combined, /claude --teammate-mode auto/u);
  assert.match(combined, /"teammateMode": "auto"/u);
  assert.doesNotMatch(combined, /TeamCreate|TeamDelete|team_create|team_delete/u);
  assert.doesNotMatch(combined, /\.claude\/teams\/teams\.json/u);
});

test("documentation describes the v0.2.2 dynamic workflow hardening release", async () => {
  const readme = await text("README.md");
  const readmeKo = await text("README_ko-KR.md");
  const hooks = await text("docs/hooks.md");
  const agents = await text("docs/agents.md");
  const migration = await text("docs/migration.md");
  const changelog = await text("CHANGELOG.md");
  const checklist = await text("RELEASE_CHECKLIST.md");
  const combined = `${readme}\n${readmeKo}\n${hooks}\n${agents}\n${migration}\n${changelog}\n${checklist}`;

  assert.match(combined, /@litfamily\/litclaude@1\.0\.18/u);
  assert.match(combined, /resilient public-source research/i);
  assert.match(combined, /Dynamic workflow hardening/i);
  assert.match(combined, /\/litclaude:lit-loop/u);
  assert.match(combined, /workflow-check --json/u);
  assert.match(combined, /subagent delegation/i);
  assert.match(combined, /TASK:/u);
  assert.match(combined, /DELIVERABLE/u);
  assert.match(combined, /SCOPE/u);
  assert.match(combined, /VERIFY/u);
  assert.match(combined, /start-work-next/u);
  assert.match(combined, /context-pressure/i);
  assert.match(combined, /mutated-file/i);
  assert.match(combined, /lit-planner/u);
  assert.match(combined, /lit-executor/u);
  assert.match(combined, /qa-runner/u);
});

test("documentation describes the v0.2.0 deep workflow parity release", async () => {
  const readme = await text("README.md");
  const readmeKo = await text("README_ko-KR.md");
  const hooks = await text("docs/hooks.md");
  const migration = await text("docs/migration.md");
  const audit = await text("docs/workflow-compatibility-audit.md");
  const combined = `${readme}\n${readmeKo}\n${hooks}\n${migration}\n${audit}`;

  assert.match(combined, /@litfamily\/litclaude@1\.0\.18/u);
  assert.match(combined, /5-lane review/i);
  assert.match(combined, /scope\/diff verification/i);
  assert.match(combined, /tests\/evidence execution/i);
  assert.match(combined, /package\/payload and code quality/i);
  assert.match(combined, /security\/provenance/i);
  assert.match(combined, /real-surface\/docs readiness/i);
  assert.match(combined, new RegExp("litgoal (runtime|CLI)", "i"));
  assert.match(combined, new RegExp("plugins/litclaude/lib/litgoal/", "u"));
  assert.match(combined, /create-goals/u);
  assert.match(combined, /record-evidence/u);
  assert.match(combined, /record-review-blockers/u);
});

test("documentation explains v0.2.0 review-work and litgoal operator contracts", async () => {
  const readme = await text("README.md");
  const readmeKo = await text("README_ko-KR.md");
  const hooks = await text("docs/hooks.md");
  const agents = await text("docs/agents.md");
  const migration = await text("docs/migration.md");
  const audit = await text("docs/workflow-compatibility-audit.md");
  const reviewWork = await text("plugins/litclaude/commands/review-work.md");
  const litgoal = await text("plugins/litclaude/commands/litgoal.md");
  const combined = `${readme}\n${readmeKo}\n${hooks}\n${agents}\n${migration}\n${audit}\n${reviewWork}\n${litgoal}`;

  for (const term of [
    "v0.2.0 workflow parity",
    "5-lane review",
    "scope/diff verification",
    "tests/evidence execution",
    "package/payload and code quality",
    "security/provenance",
    "real-surface/docs readiness",
    "Manual-QA channels",
    "cleanup receipt",
    "publish boundary",
    "uninstall",
  ]) {
    assert.match(combined, new RegExp(escapeRegExp(term), "iu"), `missing ${term}`);
  }

  for (const command of [
    "litclaude litgoal create-goals",
    "litclaude litgoal record-evidence",
    "litclaude litgoal checkpoint",
    "litclaude litgoal steer",
  ]) {
    assert.match(combined, new RegExp(escapeRegExp(command), "u"), `missing ${command}`);
  }

  assert.match(combined, /prompt text is not executed or echoed/iu);
  assert.match(combined, /malformed.*controlled error/iu);
  assert.match(combined, /current docs\/test reads/iu);
});

test("autoloop design documents automatic durable completion and its two-file limit", async () => {
  const design = await text("docs/design/litclaude-goal-autoloop-design.md");

  assert.match(design, /non-empty.*criteria.*all.*pass/isu);
  assert.match(design, /lock-backed/iu);
  assert.match(design, /idempotent/iu);
  assert.match(design, /status.*complete/isu);
  assert.match(design, /autoloop.*false/isu);
  assert.match(design, /generated completion checkpoint/iu);
  assert.match(design, /goal\.completed/u);
  assert.match(design, /cannot be\s+transactionally atomic/iu);
  assert.match(design, /state is authoritative/iu);
  assert.doesNotMatch(design, /all criteria.*allows stop → session ends normally/iu);
});

test("documentation lists review-work and litgoal trigger phrases", async () => {
  const readme = await text("README.md");
  const hooks = await text("docs/hooks.md");
  const combined = `${readme}\n${hooks}`;

  for (const trigger of [
    "$review-work",
    "lit review",
    "/review-work",
    "$litgoal",
    "lit goal",
    "/litgoal",
    "/litclaude:review-work",
    "/litclaude:litgoal",
  ]) {
    assert.match(combined, new RegExp(trigger.replace("$", "\\$"), "i"));
  }

  assert.match(combined, /does not echo prompt text/i);
  assert.match(combined, /malformed.*controlled error/i);
});

test("documentation explains the lit-recap read-only recap trigger", async () => {
  const readme = await text("README.md");
  const readmeKo = await text("README_ko-KR.md");
  const hooks = await text("docs/hooks.md");
  const combined = `${readme}\n${hooks}`;

  for (const trigger of ["lit recap", "litrecap", "recap", "리캡", "$lit-recap"]) {
    assert.match(combined, new RegExp(escapeRegExp(trigger), "iu"), `missing ${trigger}`);
  }

  assert.match(hooks, new RegExp(escapeRegExp("/litclaude:lit-recap"), "u"));
  assert.match(hooks, /Skill\(lit-recap\)/u);
  assert.match(hooks, /read-only session recap/iu);
  assert.match(hooks, /side-effect-free/iu);
  assert.match(hooks, /never writes[\s\S]*ledgers or files/iu);
  assert.match(hooks, /recapture/u);
  assert.match(hooks, /리캡처/u);
  assert.match(hooks, /`\/lit-recap`, `\/litrecap`,\s*`\/lit recap`\) do not activate/u);
  assert.match(hooks, /Korean with fixed[\s\S]*headers by default/iu);
  assert.match(hooks, /--en/u);
  assert.match(hooks, /## ⚡ 요약/u);
  assert.match(hooks, /--brief|짧게/u);

  assert.match(readme, /`lit-plan`, `lit-recap`, `lit-loop`/u, "README skills list must include lit-recap");
  assert.match(readmeKo, /`lit-plan`, `lit-recap`, `lit-loop`/u, "Korean README skills list must include lit-recap");
});

test("README cover matches the accepted Ignition vector master and raster fallback", async () => {
  const svg = await text("docs/assets/cover.svg");
  assert.equal(createHash("sha256").update(svg).digest("hex"), "0238d3e21d87836e7439c22cc82ce136cb8979d0389f848543d4876b95c7f448");
  assert.match(svg, /<svg[^>]+width="1920" height="960" viewBox="0 0 1920 960"/u);
  assert.match(svg, /<title id="title">LITCLAUDE — Ignition vector cover<\/title>/u);
  assert.doesNotMatch(svg, /<(?:image|text|script|foreignObject|style)\b|\b(?:href|on\w+)\s*=|url\s*\(|data:/iu);
  for (const color of ["#080D14", "#FF6337", "#D7F75B", "#F2EFDF"]) assert.ok(svg.includes(color));
  const cover = await readFile(new URL("docs/assets/cover.webp", root));
  assert.equal(createHash("sha256").update(cover).digest("hex"), "90c14b40d8c7ae774763ce4c3689edad6abf6697e7236cafec7987269cc5e5f4");
  assert.equal(cover.subarray(0, 4).toString(), "RIFF");
  assert.equal(cover.subarray(8, 12).toString(), "WEBP");
  assert.ok(cover.length > 0, "cover.webp must contain the accepted raster bytes");
  const englishAlt = "LitFamily motion cover: five armored robots power on one by one, the LitClaude robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up.";
  const koreanAlt = "LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitClaude 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상";
  for (const [name, alt, base] of [
    ["README.md", englishAlt, githubAssetBase],
    ["README_ko-KR.md", koreanAlt, githubAssetBase],
    ["README_npm.md", englishAlt, npmAssetBase],
    ["README_npm_ko-KR.md", koreanAlt, npmAssetBase],
  ]) {
    const readme = await text(name);
    assertCoverPresentation(readme, alt, base);
    assert.doesNotMatch(readme, /cdn\.jsdelivr\.net\/npm\/[^"\n]+\/cover\.png|\/cover\.png"/u);
  }
  for (const path of ["docs/assets/cover-motion.webp", "docs/assets/cover-motion-still.webp"]) {
    assert.ok((await lstat(new URL(path, root))).isFile(), `${path} backs the GitHub README cover`);
  }
});

test("obsolete cover sources are absent from the product root", async () => {
  for (const name of ["cover.png", "generate_cover.py"]) {
    await assert.rejects(lstat(new URL(name, root)), { code: "ENOENT" }, `${name} must stay outside the product root`);
  }
});

test("release materials summarize the v0.2.2 dynamic workflow hardening release and v0.2.0 history", async () => {
  const changelog = await text("CHANGELOG.md");
  const releaseChecklist = await text("RELEASE_CHECKLIST.md");

  assert.match(changelog, /## 0\.2\.0 - 2026-06-03/u);
  assert.match(changelog, /litclaude-ai@0\.2\.0/u);
  assert.match(changelog, /review-work/u);
  assert.match(changelog, /5-lane review/u);
  assert.match(changelog, /durable goal CLI\/runtime/u);
  assert.match(changelog, /no npm publish or marketplace publication is claimed/u);
  assert.match(changelog, /## 0\.2\.2 - 2026-06-07/u);
  assert.match(changelog, /start-work-next/u);
  assert.match(changelog, /context-pressure/u);
  assert.match(changelog, /subagent reliability/u);
  assert.match(releaseChecklist, /@litfamily\/litclaude@1\.0\.18/u);
  assert.match(releaseChecklist, /Dynamic workflow hardening/u);
  assert.match(releaseChecklist, /package\.json.*1\.0\.18/is);
  assert.match(releaseChecklist, /plugin\.json.*1\.0\.18/is);
  assert.match(releaseChecklist, /review-work/u);
  assert.match(releaseChecklist, new RegExp("litgoal\\s+runtime", "u"));
  assert.match(changelog, /## 0\.1\.18 - 2026-06-02/u);
  assert.match(changelog, /compact HUD bars/u);
  assert.match(changelog, /vivid HUD color choices/u);
  assert.match(changelog, /broader brand accent/u);
  assert.match(releaseChecklist, /0\.1\.18/u);
  assert.match(changelog, /## 0\.1\.17 - 2026-06-02/u);
  assert.match(changelog, /dense bracketed context/u);
  assert.match(changelog, /low non-zero rate-limit/u);
  assert.match(changelog, /installer color/i);
  assert.match(releaseChecklist, /0\.1\.16/u);
  assert.match(changelog, /## 0\.1\.16 - 2026-06-02/u);
  assert.match(changelog, /rate-limit reset countdown/u);
  assert.match(changelog, /deep-interview/u);
  assert.match(changelog, /## 0\.1\.15 - 2026-06-01/u);
  assert.match(changelog, /HUD brand color picker/u);
  assert.match(changelog, /LITCLAUDE_HUD_ACCENT/u);
  assert.match(releaseChecklist, /0\.1\.15/u);
  assert.match(releaseChecklist, /0\.1\.14/u);
  assert.match(releaseChecklist, /next publishable target/u);
  assert.match(changelog, /## 0\.1\.14 - 2026-06-01/u);
  assert.match(changelog, /<command-name>/u);
  assert.match(changelog, /LitClaude/u);
  assert.match(releaseChecklist, /0\.1\.13/u);
  assert.match(changelog, /short slash route handling/u);
  assert.match(changelog, /hyphenated\s+near-misses/u);
  assert.match(changelog, /HUD context\/rate-limit percentages/u);
  assert.match(changelog, /<local-command-stdout>/u);
  assert.match(releaseChecklist, /0\.1\.12/u);
  assert.match(changelog, /workflow compatibility audit/i);
  assert.match(changelog, /trigger-specific hook routing/i);
  assert.match(changelog, /cover image/i);
  assert.match(releaseChecklist, /neutral release wording/i);
  assert.doesNotMatch(releaseChecklist, /accurate attribution/i);
  assert.doesNotMatch(releaseChecklist, /private-reference|source-origin/i);
});

const outputChannelByGenre = new Map([
  ["client_deliverable", "reply"],
  ["internal_analysis", "designated_section"],
  ["audit_report", "methodology_paragraph"],
  ["working_note", "inline"],
  ["no_artifact", "reply"]
]);
const lazyOutputChannelSkillIds = new Set(["frontend-ui-ux", "visual-qa"]);

const readOutputChannelDeclaration = async (skillsRoot, skillId) => {
  const skillPath = join(skillsRoot, skillId, "SKILL.md");
  const skillText = await readFile(skillPath, "utf8").catch(() => "");
  assert.notEqual(skillText, "", `${skillPath} must exist`);
  if (skillText.includes("#contract.output_channels")) return { declaring: skillPath, body: skillText };
  assert.ok(
    lazyOutputChannelSkillIds.has(skillId),
    `${skillPath} must declare #contract.output_channels directly; lazy references are allowed only for frontend-ui-ux and visual-qa`,
  );
  const declaring = join(skillsRoot, skillId, "references", "complete-contract.md");
  const body = await readFile(declaring, "utf8").catch(() => {
    assert.fail(`${skillPath} declares no #contract.output_channels and has no ${declaring}`);
  });
  return { declaring, body };
};

test("every bundled skill declares where its limitations are written", async () => {
  const skillsRoot = join(rootPath, "plugins", "litclaude", "skills");
  const skillIds = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.ok(skillIds.length > 0, "expected a bundled skill corpus to enumerate");

  for (const skillId of skillIds) {
    const { declaring, body } = await readOutputChannelDeclaration(skillsRoot, skillId);

    const genre = body.match(/^artifact_genre:\s*(\S+)\s*$/mu)?.[1];
    assert.ok(genre !== undefined, `${declaring} must declare artifact_genre`);
    assert.ok(outputChannelByGenre.has(genre), `${declaring} declares unknown artifact_genre "${genre}"`);

    const channel = body.match(/^limitations_channel:\s*(\S+)\s*$/mu)?.[1];
    assert.equal(channel, outputChannelByGenre.get(genre), `${declaring} routes ${genre} limitations to "${channel}"`);
  }
});

test("ordinary skills cannot move output-channel declarations into lazy references", async () => {
  const temp = mkdtempSync(join(tmpdir(), "litclaude-output-channel-location-"));
  const skillRoot = join(temp, "ordinary-skill");
  try {
    mkdirSync(join(skillRoot, "references"), { recursive: true });
    writeFileSync(join(skillRoot, "SKILL.md"), "---\nname: ordinary-skill\n---\n\n# Ordinary\n");
    writeFileSync(join(skillRoot, "references", "complete-contract.md"), [
      "## #contract.output_channels",
      "```yaml",
      "artifact_genre: working_note",
      "limitations_channel: inline",
      "```",
      "",
    ].join("\n"));
    await assert.rejects(
      readOutputChannelDeclaration(temp, "ordinary-skill"),
      /must declare #contract\.output_channels directly/u,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

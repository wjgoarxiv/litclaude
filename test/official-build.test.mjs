import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { OFFICIAL_BUILD, officialBuildLines } from "../plugins/litclaude/lib/official-build.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("doctor names the official build", () => {
  it("the shipped package is the official build: one OFFICIAL_BUILD line, no warning", () => {
    assert.deepEqual(officialBuildLines(pkg), [
      `OFFICIAL_BUILD: ${OFFICIAL_BUILD.packageName} from github.com/${OFFICIAL_BUILD.repo} (this copy: ${pkg.name} ${pkg.version})`,
    ]);
  });

  it("a renamed package or a repository elsewhere gets a warning naming both", () => {
    const renamed = officialBuildLines({ ...pkg, name: "litclaude-pro" });
    assert.equal(renamed.length, 2);
    assert.match(renamed[1], /^OFFICIAL_BUILD_WARNING: this copy is litclaude-pro from github\.com\/wjgoarxiv\/litclaude; the official build is @litfamily\/litclaude from github\.com\/wjgoarxiv\/litclaude/u);
    const moved = officialBuildLines({ ...pkg, repository: { type: "git", url: "git+https://github.com/someone/claude-kit.git" } });
    assert.match(moved[1], /this copy is @litfamily\/litclaude from github\.com\/someone\/claude-kit;/u);
    const missing = officialBuildLines({ ...pkg, repository: undefined });
    assert.match(missing[1], /from an unnamed repository;/u);
  });

  it("npm run doctor and litclaude-ai doctor --dry-run both print it, with no network call", () => {
    const dev = spawnSync(process.execPath, [join(root, "scripts", "doctor.mjs")], { encoding: "utf8", env: { ...process.env, LITCLAUDE_NO_AUTO_UPDATE: "1" }, timeout: 300_000 });
    assert.match(dev.stdout, /^OFFICIAL_BUILD: @litfamily\/litclaude from github\.com\/wjgoarxiv\/litclaude /mu);
    const cli = spawnSync(process.execPath, [join(root, "bin", "litclaude-ai.js"), "--dry-run", "doctor"], { encoding: "utf8", env: { ...process.env, LITCLAUDE_NO_AUTO_UPDATE: "1" } });
    assert.match(cli.stdout, /^OFFICIAL_BUILD: @litfamily\/litclaude from github\.com\/wjgoarxiv\/litclaude /mu);
    const source = readFileSync(join(root, "plugins", "litclaude", "lib", "official-build.mjs"), "utf8");
    assert.doesNotMatch(source, /node:(?:http|https|net|dgram|tls)\b|\bfetch\s*\(/u);
  });
});

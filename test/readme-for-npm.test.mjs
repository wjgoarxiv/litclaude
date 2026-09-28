import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PAIRS, STATE_DIR, apply, check, restore } from "../tools/readme-for-npm.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

// A throwaway copy of the files the swap and the check touch.
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-readme-for-npm-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pkg = JSON.parse(read("package.json"));
  const paths = new Set(["package.json", ...PAIRS.flatMap(({ npm, target }) => [npm, target])]);
  for (const { npm } of PAIRS) {
    for (const [, url] of read(npm).matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/@litfamily\/litclaude@[^/]+\/([^"\s)]+)/gu)) paths.add(url);
  }
  for (const path of paths) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    copyFileSync(join(root, path), join(dir, path));
  }
  return { dir, pkg };
}

test("the repository npm README pair passes its own check", () => {
  assert.deepEqual(check(root), []);
  const result = spawnSync(process.execPath, [join(root, "tools", "readme-for-npm.mjs"), "check"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("apply puts the npm README in place and restore brings back the GitHub README byte for byte", (t) => {
  const { dir } = fixture(t);
  const originals = PAIRS.map(({ target }) => readFileSync(join(dir, target)));
  assert.equal(apply(dir).action, "applied");
  for (const { npm, target } of PAIRS) {
    assert.ok(readFileSync(join(dir, target)).equals(readFileSync(join(dir, npm))), `${target} is the npm README`);
  }
  assert.ok(existsSync(join(dir, STATE_DIR, "state.json")), "the backup lives outside the tracked files");
  assert.deepEqual(check(dir), [], "check compares against the backed-up GitHub README while applied");
  assert.equal(restore(dir).action, "restored");
  PAIRS.forEach(({ target }, index) => assert.ok(readFileSync(join(dir, target)).equals(originals[index]), `${target} restored`));
  assert.equal(existsSync(join(dir, "tmp")), false, "restore leaves no swap directory behind");
  assert.equal(restore(dir).action, "none", "a second restore is a no-op");
});

test("a nested apply keeps the npm README until the outermost restore", (t) => {
  const { dir } = fixture(t);
  const original = readFileSync(join(dir, "README.md"));
  apply(dir);
  assert.equal(apply(dir).action, "nested");
  assert.equal(restore(dir).action, "nested");
  assert.ok(readFileSync(join(dir, "README.md")).equals(readFileSync(join(dir, "README_npm.md"))), "publish still reads the npm README");
  assert.equal(restore(dir).action, "restored");
  assert.ok(readFileSync(join(dir, "README.md")).equals(original));
});

test("apply refuses a stale swap state and restore refuses a changed backup", (t) => {
  const { dir } = fixture(t);
  apply(dir);
  writeFileSync(join(dir, "README.md"), "edited while applied\n");
  assert.throws(() => apply(dir), /README_SWAP_STATE_STALE/u);
  writeFileSync(join(dir, STATE_DIR, "README.md"), "tampered backup\n");
  assert.throws(() => restore(dir), /README_SWAP_BACKUP_CHANGED/u);
});

test("check rejects relative targets, unpinned or wrong-version URLs, a missing guide link and a lost tagline", (t) => {
  const { dir, pkg } = fixture(t);
  const card = readFileSync(join(dir, "README_npm.md"), "utf8");
  const pinned = `https://cdn.jsdelivr.net/npm/@litfamily/litclaude@${pkg.version}/`;
  for (const [mutation, problem] of [
    [card.replace(`${pinned}docs/assets/cover-motion.webp`, "./docs/assets/cover-motion.webp"), /relative or non-https/u],
    [card.replace(`${pinned}LICENSE`, "https://cdn.jsdelivr.net/npm/@litfamily/litclaude@0.0.0/LICENSE"), /not pinned/u],
    [card.replaceAll("https://github.com/wjgoarxiv/litclaude#readme", "#install"), /full-guide link/u],
    [card.replace("<strong>Keep the work lit.</strong>", "<strong>Keep it lit.</strong>"), /name and tagline/u],
    [card.replace(`${pinned}docs/privacy.md`, `${pinned}docs/missing.md`), /missing on disk/u],
    [`${card}\n${"padding ".repeat(9000)}\n`, /exceeds|not visibly shorter/u],
  ]) {
    assert.notEqual(mutation, card);
    writeFileSync(join(dir, "README_npm.md"), mutation);
    assert.ok(check(dir).some((line) => problem.test(line)), `expected ${problem}`);
  }
  writeFileSync(join(dir, "README_npm.md"), card);
  assert.deepEqual(check(dir), []);
});

test("package scripts swap the README around every pack and the sources never ship", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts.prepack, "node tools/readme-for-npm.mjs apply");
  assert.equal(pkg.scripts.postpack, "node tools/readme-for-npm.mjs restore");
  assert.equal(pkg.scripts["check:npm-readme"], "node tools/readme-for-npm.mjs check");
  assert.equal(pkg.files.some((entry) => /README_npm|^tools\/?$|readme-for-npm/u.test(entry)), false);
  assert.match(read(".gitignore"), /^tmp\/$/mu, "the swap backup directory stays out of git");
  const checklist = read("RELEASE_CHECKLIST.md");
  assert.match(checklist, /node tools\/readme-for-npm\.mjs apply[\s\S]{0,400}npm publish[\s\S]{0,400}node tools\/readme-for-npm\.mjs restore/u);
  assert.match(checklist, /--ignore-scripts/u);
});

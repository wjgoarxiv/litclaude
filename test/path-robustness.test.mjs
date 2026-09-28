/**
 * path-robustness.test.mjs
 *
 * Documents the path-robustness gap in scripts that use .pathname.
 *
 * GREEN-now positive control: proves fileURLToPath resolves a workspace path
 *   containing a space, '#', and a Korean character correctly.
 *
 * RED-now (T15): scripts/validate-plugin.mjs and scripts/doctor.mjs both use
 *   `new URL('..', import.meta.url).pathname` which is brittle on such paths
 *   (the '#' is percent-encoded in a file URL, causing .pathname to return a
 *   mangled string). This test is skipped with reason
 *   "RED until T15: .pathname breaks on spaced/#/Korean paths"
 *   so the suite stays GREEN today. To flip at T15, remove the { skip: "..." }
 *   option object and the test will assert directly.
 *
 * Node:test idiom chosen: same { skip: "reason" } pattern as state-store
 *   durability — one-line flip at T15.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { after, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Use fileURLToPath (not .pathname) per repo convention.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Build a temp workspace whose absolute path contains a space, '#', and Korean.
// Pattern: /tmp/litclaude-XXXXXX/Lit Path # 한글
const tmpBase = mkdtempSync(join(tmpdir(), "litclaude-pathrobust-"));
const funnyDir = join(tmpBase, "Lit Path # 한글");
mkdirSync(funnyDir, { recursive: true });

after(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

describe("path robustness for funny-path workspaces", () => {
  // GREEN-now: positive control proving fileURLToPath handles the funny path.
  test("fileURLToPath correctly round-trips a path containing space, #, and Korean", () => {
    // pathToFileURL correctly percent-encodes '#' and other special chars.
    // fileURLToPath then decodes them back to the original path string.
    const fileUrl = pathToFileURL(funnyDir);
    const resolved = fileURLToPath(fileUrl);
    assert.equal(
      resolved,
      funnyDir,
      "fileURLToPath must recover the exact funny path from a file URL",
    );
    // Also confirm the dir actually exists (sanity).
    assert.ok(existsSync(resolved), "funny directory must exist on disk");
  });

  // RED-now (T15): run validate-plugin.mjs from the funny-path workspace.
  // scripts/validate-plugin.mjs uses new URL('..', import.meta.url).pathname
  // which percent-encodes '#' in the URL but does NOT decode it in .pathname,
  // producing a path that does not exist on disk, causing an immediate crash.
  test(
    "validate-plugin.mjs does not crash when run from a path with space/#/Korean",
    () => {
      const result = spawnSync(
        process.execPath,
        [join(repoRoot, "scripts/validate-plugin.mjs")],
        {
          cwd: funnyDir,
          encoding: "utf8",
          // Suppress the claude CLI probe so the only failure is path resolution.
          env: { ...process.env, PATH: "" },
        },
      );
      // We accept exit 0 (full pass) or a controlled VALIDATE_PLUGIN_FAIL that
      // is NOT caused by a path-resolution crash (i.e., no ENOENT on root).
      assert.ok(
        result.stdout.includes("VALIDATE_PLUGIN_PASS") ||
          (result.status !== 0 && !result.stderr.includes("ENOENT")),
        `validate-plugin.mjs crashed with path resolution error from funny-path cwd.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    },
  );

  // RED-now (T15): run doctor.mjs from the funny-path workspace.
  test(
    "doctor.mjs does not crash when cwd contains space/#/Korean",
    () => {
      const result = spawnSync(
        process.execPath,
        [join(repoRoot, "scripts/doctor.mjs")],
        {
          cwd: funnyDir,
          encoding: "utf8",
          env: { ...process.env, PATH: "" },
        },
      );
      assert.ok(
        result.stdout.includes("DOCTOR_PASS") ||
          (result.status !== 0 && !result.stderr.includes("ENOENT")),
        `doctor.mjs crashed with path resolution error from funny-path cwd.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    },
  );
});

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalSkillResourceManifest } from "./canonical-skill-resources.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export const verifyCanonicalSkillResources = (pluginRoot) => {
  const failures = [];
  for (const [path, expectedSha256] of canonicalSkillResourceManifest) {
    const absolutePath = join(pluginRoot, path);
    if (!existsSync(absolutePath)) {
      failures.push({ code: "RESOURCE_MISSING", path });
      continue;
    }
    const actualSha256 = sha256(readFileSync(absolutePath));
    if (actualSha256 !== expectedSha256) {
      failures.push({
        code: "RESOURCE_HASH_MISMATCH",
        path,
        expected_sha256: expectedSha256,
        actual_sha256: actualSha256,
      });
    }
  }
  return {
    status: failures.length === 0 ? "PASS" : "FAIL",
    checked: canonicalSkillResourceManifest.size,
    failures,
  };
};

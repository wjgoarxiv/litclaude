#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const skip = (reason) => {
  process.stdout.write(`LitClaude postinstall skipped: ${reason}\n`);
  process.stdout.write("Run `litclaude install` to register the Claude Code plugin and HUD.\n");
  process.stdout.write("MOTION_RUNTIME: not pre-warmed (postinstall skipped); run: litclaude-ai motion-runtime install\n");
  process.exit(0);
};

if (process.env.LITCLAUDE_AUTO_INSTALL === "0" || process.env.LITCLAUDE_POSTINSTALL_SKIP === "1") {
  skip("disabled by environment");
}

const forced = process.env.LITCLAUDE_AUTO_INSTALL === "1";
if (process.env.CI && !forced) {
  skip("CI environment");
}

if (existsSync(join(root, ".git")) && !forced) {
  skip("source checkout");
}

if (process.env.npm_config_global !== "true" && process.env.npm_config_location !== "global" && !forced) {
  skip("non-global package install");
}

const result = spawnSync(process.execPath, [join(root, "bin", "litclaude-ai.js"), "install"], {
  cwd: root,
  encoding: "utf8",
  env: {
    ...process.env,
    LITCLAUDE_POSTINSTALL: "1",
  },
});

if (result.status === 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  process.exit(0);
}

process.stdout.write("LitClaude postinstall warning: automatic Claude Code plugin/HUD setup did not complete.\n");
if (result.stderr) process.stdout.write(result.stderr);
process.stdout.write("Run `litclaude install` manually after npm finishes.\n");
process.exit(0);

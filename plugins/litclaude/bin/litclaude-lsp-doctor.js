#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const result = spawnSync("typescript-language-server", ["--version"], {
  encoding: "utf8",
});

if (result.error) {
  console.log("typescript-language-server is not available.");
  console.log("Install with: npm install -g typescript-language-server typescript");
  process.exit(0);
}

console.log(`typescript-language-server available: ${(result.stdout || result.stderr).trim()}`);

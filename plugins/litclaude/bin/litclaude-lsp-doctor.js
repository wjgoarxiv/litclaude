#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { shellFreeCommand } from "../lib/npm-invocation.mjs";

const run = (name, args) => {
  try {
    const invocation = shellFreeCommand(name, args);
    return spawnSync(invocation.command, invocation.args, { encoding: "utf8" });
  } catch (error) {
    return { error };
  }
};
const result = run("typescript-language-server", ["--version"]);

if (result.error) {
  console.log("typescript-language-server is not available.");
  console.log("Install with: npm install -g typescript-language-server typescript");
  process.exit(0);
}

console.log(`typescript-language-server available: ${(result.stdout || result.stderr).trim()}`);

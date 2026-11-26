#!/usr/bin/env node

// The PreToolUse entry. bin/litclaude-hook.js answers every other event and loads all of their code;
// this one runs before each file read and edit and loads only what that call needs.
import { readFileSync } from "node:fs";
import { runPreToolUse } from "../lib/pre-tool-use.mjs";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  console.error("invalid hook JSON");
  process.exit(1);
}
await runPreToolUse(process.argv[2] ?? "", input);

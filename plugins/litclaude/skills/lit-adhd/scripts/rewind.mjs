#!/usr/bin/env node
// rewind.mjs: the lit-adhd collector for a shell where the plugin's `litclaude-ai` is not on PATH.
// It runs the same code as `litclaude-ai rewind` from the plugin's own lib/, with the same flags:
//
//   node <skill-root>/scripts/rewind.mjs [--json] [--here] [--since 7d] [--max 12] [--session <id>] [--width N]
//
// Read-only apart from the collector's one next-step record under .litclaude/adhd/.

import { runRewindCli } from "../../../lib/rewind/collect.mjs";

process.exitCode = runRewindCli(process.argv.slice(2), process.cwd());

#!/usr/bin/env node

import { readFileSync } from "node:fs";

const path = process.argv[2];

if (!path) {
  console.error("Usage: inspect-agent-tools.mjs <agent-file>");
  process.exit(64);
}

const text = readFileSync(path, "utf8");
const match = /^---\n([\s\S]*?)\n---/u.exec(text);

if (!match) {
  console.error("agent frontmatter not found");
  process.exit(65);
}

const toolsLine = match[1].split("\n").find((line) => line.startsWith("tools:")) ?? "tools:";
const tools = toolsLine
  .replace("tools:", "")
  .split(",")
  .map((tool) => tool.trim())
  .filter(Boolean);

console.log(JSON.stringify({ path, tools }, null, 2));

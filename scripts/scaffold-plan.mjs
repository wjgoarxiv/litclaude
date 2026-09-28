#!/usr/bin/env node
// Checkout-compatible entrypoint. The shipped implementation lives under the plugin root so
// installed Skill guidance can resolve it without depending on this repository layout.
export * from "../plugins/litclaude/scripts/scaffold-plan.mjs";

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runScaffoldPlanCli } from "../plugins/litclaude/scripts/scaffold-plan.mjs";

const isMainEntrypoint = () => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isMainEntrypoint()) {
  try {
    process.exitCode = await runScaffoldPlanCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

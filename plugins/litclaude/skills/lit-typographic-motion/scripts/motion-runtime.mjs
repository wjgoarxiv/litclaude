#!/usr/bin/env node
// `litclaude-ai motion-runtime install|status` lands here. install is the only step that writes the
// motion cache: pinned engine deps (npm ci), pinned and hash-verified fonts with their licences,
// and, when asked, the librosa venv (--audio) or the word-timing plan (--word-timing). status only
// reads. A render never installs anything; an unwarmed cache is BLOCKED 14.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const USAGE = `lit-typographic-motion runtime (LitClaude)

usage:
  litclaude-ai motion-runtime install [--audio] [--word-timing]
  litclaude-ai motion-runtime status [--json]

install  pre-warms the pinned engine dependencies and fonts into the LitClaude motion cache
         (outside any sandboxed session). --audio adds the librosa beat-grid venv (Tier 2);
         --word-timing prints the Tier-3 model size and pins, then stops: its aligner runtime is
         not part of this release.
status   reports what is ready and names the command that fixes anything missing.
`;

export async function main(argv, { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const [command, ...rest] = argv;
  if (!command || ["--help", "-h", "help"].includes(command)) {
    stdout.write(USAGE);
    return command ? 0 : 2;
  }
  const runtime = await import("../engine/node/runtime.mjs");
  if (command === "status") {
    const status = runtime.runtimeStatus({ env });
    if (rest.includes("--json")) stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    else stdout.write(`${runtime.formatStatus(status).join("\n")}\n`);
    return 0;
  }
  if (command === "install") {
    const audio = rest.includes("--audio");
    // Tier 3 states its download size and every pin before anything else runs; with no aligner
    // runtime in this release it stops there, having downloaded nothing.
    if (rest.includes("--word-timing")) {
      stdout.write(`${runtime.wordTimingPlan().lines.join("\n")}\n`);
      return 14;
    }
    try {
      await runtime.installRuntime({ env, audio, log: (line) => stderr.write(`motion-runtime: ${line}\n`) });
      stdout.write(`${runtime.formatStatus(runtime.runtimeStatus({ env })).join("\n")}\n`);
      stdout.write("MOTION_RUNTIME_INSTALL_PASS\n");
      return 0;
    } catch (error) {
      stderr.write(`MOTION_RUNTIME_INSTALL_FAIL: ${error.message}\n`);
      stdout.write(`Motion runtime not pre-warmed (${error.message.split("\n")[0].slice(0, 160)}); run: ${runtime.INSTALL_COMMAND}\n`);
      return 1;
    }
  }
  stderr.write(`unknown command: ${command}\n${USAGE}`);
  return 2;
}

// Real-path compare: a symlinked install path must still run main().
const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) process.exitCode = await main(process.argv.slice(2));

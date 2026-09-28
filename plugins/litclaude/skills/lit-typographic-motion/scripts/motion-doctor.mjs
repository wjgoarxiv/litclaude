#!/usr/bin/env node
// The five MO-A-44 doctor probes for lit-typographic-motion, printed on every doctor run:
// Chrome, ffmpeg with the preview rung, the WebGL2 renderer string from a real headless probe, the
// software-GL / unknown-renderer warning, and the pre-warm state naming what is missing and the
// command that fixes it. Read-only: it never installs, and the probe's Chrome profile is a unique
// temporary directory removed on exit.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const USAGE = "usage: motion-doctor.mjs [--json]\nlit-typographic-motion doctor (LitClaude): five readiness probes, read-only\n";

export async function probes({ env = process.env } = {}) {
  const { findChrome, chromeVersion, launchWithLadder } = await import("../engine/node/chrome.mjs");
  const { findFfmpeg, ffmpegVersion, previewRungs } = await import("../engine/node/encode.mjs");
  const { runtimeStatus, formatStatus, INSTALL_COMMAND } = await import("../engine/node/runtime.mjs");
  const { isSoftware } = await import("../engine/core/gate-rules.mjs");
  const { UNKNOWN_RENDERER } = await import("../engine/core/constants.mjs");
  const out = {};
  const chrome = findChrome(env);
  out.chrome = chrome ? { ok: true, line: `${chrome} — ${chromeVersion(chrome)}` } : { ok: false, line: "not found on PATH / not installed (set CHROME_PATH)" };
  const ffmpeg = findFfmpeg(env);
  const rungs = previewRungs(ffmpeg, env);
  out.ffmpeg = ffmpeg ? { ok: true, line: `${ffmpeg} — ${ffmpegVersion(ffmpeg)}; preview encoder rung: ${rungs[0] ?? "none"} (available: ${rungs.join(", ") || "none"})` } : { ok: false, line: `not found on PATH (video export blocked; stills and sheet still work)${rungs.length ? `; preview rung: ${rungs[0]}` : ""}` };
  if (!chrome) out.webgl2 = { ok: false, line: "no WebGL2 context obtainable (Chrome not found)" };
  else {
    const dir = mkdtempSync(path.join(tmpdir(), "lit-motion-doctor-"));
    try {
      const { session, flags, renderer } = await launchWithLadder({ chrome, profileRoot: dir, routes: () => null });
      await session.close();
      out.webgl2 = { ok: true, line: `${renderer} (flags: ${flags.join(" ")})`, renderer };
    } catch (error) {
      out.webgl2 = { ok: false, line: `no WebGL2 context obtainable (${error.message.split("\n")[0]})` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const renderer = out.webgl2.renderer;
  out.software = !renderer ? { ok: false, line: "renderer unknown: no WebGL2 probe result" }
    : renderer === UNKNOWN_RENDERER ? { ok: true, line: "renderer type unknown — debug-info extension unavailable" }
      : isSoftware(renderer) ? { ok: true, line: `software GL detected (${renderer}); renders will be slower, --samples lowered automatically` }
        : { ok: true, line: "none (real GPU)" };
  const status = runtimeStatus({ env });
  out.prewarm = { ok: status.ready, line: status.ready ? `ready — ${formatStatus(status).slice(1, 3).join("; ")}` : `NOT READY — missing: ${status.missing.join("; ")}; run ${INSTALL_COMMAND}`, detail: formatStatus(status) };
  return out;
}

export function formatProbes(p) {
  return [
    `MOTION_CHROME: ${p.chrome.line}`,
    `MOTION_FFMPEG: ${p.ffmpeg.line}`,
    `MOTION_WEBGL2: ${p.webgl2.line}`,
    `MOTION_SOFTWARE_GL: ${p.software.line}`,
    `MOTION_PREWARM: ${p.prewarm.line}`,
  ];
}

export async function main(argv, { env = process.env, stdout = process.stdout } = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    stdout.write(USAGE);
    return 0;
  }
  const p = await probes({ env });
  if (argv.includes("--json")) stdout.write(`${JSON.stringify(p, null, 2)}\n`);
  else stdout.write(`${formatProbes(p).join("\n")}\n`);
  return 0;
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) process.exitCode = await main(process.argv.slice(2));

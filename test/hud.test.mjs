import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hudPath = join(root, "plugins", "litclaude", "bin", "litclaude-hud.js");
const packageJson = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../package.json", import.meta.url), "utf8")));
const stripAnsi = (value) => value.replace(/\x1b\[[0-9;]*m/gu, "");
const colorEnv = { ...process.env };
for (const key of ["NO_COLOR", "CI", "COLORTERM", "WT_SESSION", "TERM_PROGRAM", "WSL_DISTRO_NAME", "WSL_INTEROP", "LITCLAUDE_HUD_APPEARANCE", "LITCLAUDE_HUD_COLOR_DEPTH"]) delete colorEnv[key];
colorEnv.TERM = "xterm-256color";
colorEnv.LITCLAUDE_HUD_STATE_ROOT = mkdtempSync(join(tmpdir(), "litclaude-hud-state-"));

test("LitClaude HUD renders a branded pretty status line from Claude status input", () => {
  const tmp = mkdtempSync(join(tmpdir(), "litclaude-hud-test-"));

  try {
    const transcript = join(tmp, "transcript.jsonl");
    writeFileSync(
      transcript,
      [
        JSON.stringify({ type: "user", message: { content: "Make the HUD prettier." } }),
        JSON.stringify({
          type: "assistant",
          message: {
            usage: {
              input_tokens: 90000,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
              output_tokens: 1200,
            },
          },
        }),
      ].join("\n"),
    );

    const status = {
      model: { display_name: "Opus 4.8 (1M context)" },
      cwd: root,
      transcript_path: transcript,
      context_window: { context_window_size: 1000000 },
    };
    const result = spawnSync(process.execPath, [hudPath], {
      cwd: root,
      encoding: "utf8",
      input: `${JSON.stringify(status)}\n`,
      env: {
        ...colorEnv,
        LITCLAUDE_HUD_TEST_USAGE: "5h=4,1w=35,reset1=2026-06-06T07:00:00Z",
        LITCLAUDE_HUD_NO_COLOR: "1",
        LITCLAUDE_VERSION: packageJson.version,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`^\\[🔥LITCLAUDE v${packageJson.version.replaceAll(".", "\\.")}\\] \\| O4\\.8 │ ctx `, "u"));
    assert.match(result.stdout, /9%\/1000k/u);
    assert.match(result.stdout, /5h \[[▏▎▍▌▋▊▉█░]+\] 4%/u);
    assert.match(result.stdout, /1w \[[▏▎▍▌▋▊▉█░]+\] 35%/u);
    assert.match(result.stdout, /git /u);
    assert.match(result.stdout, /└─ Make the HUD prettier\./u);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("LitClaude HUD renders the neon brand prefix (256-color fallback) when color is enabled", () => {
  const result = spawnSync(process.execPath, [hudPath], {
    cwd: root,
    encoding: "utf8",
    input: `${JSON.stringify({ model: { display_name: "Opus 4.8" }, cwd: root })}\n`,
    env: {
      ...colorEnv,
      LITCLAUDE_HUD_NO_COLOR: "",
      COLORTERM: "",
      WT_SESSION: "",
      TERM_PROGRAM: "",
      TERM: "",
      LITCLAUDE_HUD_APPEARANCE: "dark",
      LITCLAUDE_HUD_COLOR_DEPTH: "256",
      LITCLAUDE_VERSION: packageJson.version,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`^\\x1b\\[0m\\x1b\\[1m\\x1b\\[38;5;201m\\[🔥LITCLAUDE v${packageJson.version.replaceAll(".", "\\.")}\\]\\x1b\\[0m`, "u"));
});

test("LitClaude HUD renders a truecolor neon gradient brand when COLORTERM=truecolor", () => {
  const result = spawnSync(process.execPath, [hudPath], {
    cwd: root,
    encoding: "utf8",
    input: `${JSON.stringify({ model: { display_name: "Opus 4.8" }, cwd: root })}\n`,
    env: {
      ...colorEnv,
      LITCLAUDE_HUD_NO_COLOR: "",
      COLORTERM: "truecolor",
      LITCLAUDE_HUD_APPEARANCE: "dark",
      LITCLAUDE_VERSION: packageJson.version,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  // bold + 🔥 + first letter at hot-pink #ff2d95 ... last letter at electric-cyan #00e5ff
  assert.match(result.stdout, /^\x1b\[0m\x1b\[1m\[🔥\x1b\[38;2;255;45;149mL/u);
  assert.match(result.stdout, /\x1b\[38;2;0;229;255mE/u);
});

test("LitClaude HUD renders the truecolor gradient in Windows Terminal/WSL2 (WT_SESSION, no COLORTERM)", () => {
  const result = spawnSync(process.execPath, [hudPath], {
    cwd: root,
    encoding: "utf8",
    input: `${JSON.stringify({ model: { display_name: "Opus 4.8" }, cwd: root })}\n`,
    env: {
      ...colorEnv,
      LITCLAUDE_HUD_NO_COLOR: "",
      // Windows Terminal does not export COLORTERM into the WSL2 shell; it
      // advertises 24-bit support via WT_SESSION. The gradient must still render.
      COLORTERM: "",
      WT_SESSION: "1d3f7c0a-0000-0000-0000-000000000000",
      LITCLAUDE_HUD_APPEARANCE: "dark",
      LITCLAUDE_VERSION: packageJson.version,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\x1b\[0m\x1b\[1m\[🔥\x1b\[38;2;255;45;149mL/u);
  assert.match(result.stdout, /\x1b\[38;2;0;229;255mE/u);
});

test("LitClaude HUD renders the truecolor gradient in WSL2 even when Claude drops WT_SESSION", () => {
  const result = spawnSync(process.execPath, [hudPath], {
    cwd: root,
    encoding: "utf8",
    input: `${JSON.stringify({ model: { display_name: "Opus 4.8" }, cwd: root })}\n`,
    env: {
      ...colorEnv,
      LITCLAUDE_HUD_NO_COLOR: "",
      COLORTERM: "",
      WT_SESSION: "",
      TERM_PROGRAM: "",
      TERM: "xterm-256color",
      WSL_DISTRO_NAME: "Ubuntu",
      WSL_INTEROP: "/run/WSL/123_interop",
      LITCLAUDE_HUD_APPEARANCE: "dark",
      LITCLAUDE_VERSION: packageJson.version,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\x1b\[0m\x1b\[1m\[🔥\x1b\[38;2;255;45;149mL/u);
  assert.match(result.stdout, /\x1b\[38;2;0;229;255mE/u);
  assert.doesNotMatch(result.stdout, /^\x1b\[0m\x1b\[1m\x1b\[38;5;201m/u);
});

test("LitClaude HUD keeps the neon brand accent-independent while accent themes the body", () => {
  const result = spawnSync(process.execPath, [hudPath], {
    cwd: root,
    encoding: "utf8",
    input: `${JSON.stringify({ model: { display_name: "Opus 4.8" }, cwd: root })}\n`,
    env: {
      ...colorEnv,
      LITCLAUDE_HUD_NO_COLOR: "",
      COLORTERM: "",
      WT_SESSION: "",
      TERM_PROGRAM: "",
      TERM: "",
      LITCLAUDE_HUD_ACCENT: "rose",
      LITCLAUDE_HUD_APPEARANCE: "dark",
      LITCLAUDE_HUD_COLOR_DEPTH: "256",
      LITCLAUDE_VERSION: packageJson.version,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  // brand prefix is the fixed neon (201), NOT the rose accent...
  assert.match(result.stdout, new RegExp(`^\\x1b\\[0m\\x1b\\[1m\\x1b\\[38;5;201m\\[🔥LITCLAUDE v${packageJson.version.replaceAll(".", "\\.")}\\]\\x1b\\[0m`, "u"));
  // ...but the configured rose accent (198) still themes the HUD body.
  assert.match(result.stdout, /\x1b\[38;5;198m/u);
});

test("LitClaude HUD applies the configured accent to optional separators and gauges", () => {
  const result = spawnSync(process.execPath, [hudPath], {
    cwd: root,
    encoding: "utf8",
    input: `${JSON.stringify({
      model: { display_name: "Opus 4.8" },
      cwd: root,
      context_window: { context_window_size: 1000000, used_percentage: 0 },
    })}\n`,
    env: {
      ...colorEnv,
      LITCLAUDE_HUD_NO_COLOR: "",
      LITCLAUDE_HUD_ACCENT: "rose",
      LITCLAUDE_HUD_TEST_USAGE: "",
      CLAUDE_HUD_TEST_USAGE: "",
      COLORTERM: "",
      LITCLAUDE_HUD_APPEARANCE: "dark",
      LITCLAUDE_HUD_COLOR_DEPTH: "256",
      LITCLAUDE_VERSION: packageJson.version,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal((result.stdout.match(/\x1b\[38;5;198m/gu) ?? []).length >= 5, true);
  assert.match(stripAnsi(result.stdout), /ctx \[[▏▎▍▌▋▊▉█░]{3}\] 0%\/1000k/u);
  assert.match(stripAnsi(result.stdout), /5h \[░░\] --%/u);
  assert.match(stripAnsi(result.stdout), /1w \[░░\] --%/u);
});

test("LitClaude HUD falls back to cyan for malformed accent input", () => {
  const result = spawnSync(process.execPath, [hudPath], {
    cwd: root,
    encoding: "utf8",
    input: `${JSON.stringify({ model: { display_name: "Opus 4.8" }, cwd: root })}\n`,
    env: {
      ...colorEnv,
      LITCLAUDE_HUD_NO_COLOR: "",
      COLORTERM: "",
      WT_SESSION: "",
      TERM_PROGRAM: "",
      TERM: "",
      LITCLAUDE_HUD_ACCENT: "not-a-theme",
      LITCLAUDE_HUD_APPEARANCE: "dark",
      LITCLAUDE_HUD_COLOR_DEPTH: "256",
      LITCLAUDE_VERSION: packageJson.version,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  // brand prefix stays the fixed neon (201); malformed accent falls the body back to cyan (81).
  assert.match(result.stdout, new RegExp(`^\\x1b\\[0m\\x1b\\[1m\\x1b\\[38;5;201m\\[🔥LITCLAUDE v${packageJson.version.replaceAll(".", "\\.")}\\]\\x1b\\[0m`, "u"));
  assert.match(result.stdout, /\x1b\[38;5;81m/u);
});

test("LitClaude HUD keeps the neon brand prefix on fallback output", () => {
  const result = spawnSync(process.execPath, [hudPath], {
    cwd: root,
    encoding: "utf8",
    input: "{not-json}\n",
    env: {
      ...colorEnv,
      LITCLAUDE_HUD_NO_COLOR: "1",
      LITCLAUDE_VERSION: packageJson.version,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`^\\[🔥LITCLAUDE v${packageJson.version.replaceAll(".", "\\.")}\\] \\| HUD unavailable:`, "u"));
});

test("LitClaude HUD reads Claude Code rate_limits from status stdin", () => {
  const result = spawnSync(process.execPath, [hudPath], {
    cwd: root,
    encoding: "utf8",
    input: `${JSON.stringify({
      model: { display_name: "Opus 4.8" },
      cwd: root,
      context_window: { context_window_size: 1000000, used_percentage: 9 },
      rate_limits: {
        five_hour: { used_percentage: 23.5 },
        seven_day: { used_percentage: 67.4, resets_at: "2026-06-06T07:00:00Z" },
      },
    })}\n`,
    env: {
      ...colorEnv,
      LITCLAUDE_HUD_NO_COLOR: "1",
      LITCLAUDE_HUD_TEST_USAGE: "",
      CLAUDE_HUD_TEST_USAGE: "",
      LITCLAUDE_VERSION: packageJson.version,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ctx \[[▏▎▍▌▋▊▉█░]{3}\] 9%\/1000k/u);
  assert.match(result.stdout, /5h \[[▏▎▍▌▋▊▉█░]+\] 24%/u);
  assert.match(result.stdout, /1w \[[▏▎▍▌▋▊▉█░]+\] 67% ↻/u);
  assert.doesNotMatch(result.stdout, /23\.5%|67\.4%/u);
});

test("LitClaude HUD shows low non-zero usage as visible partial bars with separated reset text", () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const result = spawnSync(process.execPath, [hudPath], {
    cwd: root,
    encoding: "utf8",
    input: `${JSON.stringify({
      model: { display_name: "Opus 4.8" },
      cwd: root,
      context_window: { context_window_size: 1000000, used_percentage: 4 },
      rate_limits: {
        five_hour: { used_percentage: 1, resets_at: nowSeconds + 4 * 60 * 60 + 37 * 60 },
        seven_day: { used_percentage: 7, resets_at: nowSeconds + 4 * 24 * 60 * 60 + 4 * 60 * 60 },
      },
    })}\n`,
    env: {
      ...colorEnv,
      LITCLAUDE_HUD_NO_COLOR: "1",
      LITCLAUDE_HUD_TEST_USAGE: "",
      CLAUDE_HUD_TEST_USAGE: "",
      LITCLAUDE_VERSION: packageJson.version,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /5h \[[▏▎▍▌▋▊▉█][░]+\] 1% ↻4h3[56]m/u);
  assert.match(result.stdout, /1w \[[▏▎▍▌▋▊▉█][░]+\] 7% ↻4d3?h/u);
});

test("LitClaude HUD renders compact bracketed bars for constrained status width", () => {
  const result = spawnSync(process.execPath, [hudPath], {
    cwd: root,
    encoding: "utf8",
    input: `${JSON.stringify({
      model: { display_name: "Opus 4.8" },
      cwd: root,
      context_window: { context_window_size: 1000000, used_percentage: 4 },
    })}\n`,
    env: {
      ...colorEnv,
      LITCLAUDE_HUD_NO_COLOR: "1",
      LITCLAUDE_HUD_TEST_USAGE: "",
      CLAUDE_HUD_TEST_USAGE: "",
      LITCLAUDE_VERSION: packageJson.version,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ctx \[[▏▎▍▌▋▊▉█░]{3}\] 4%\/1000k/u);
  assert.match(result.stdout, /5h \[░░\] --%/u);
  assert.match(result.stdout, /1w \[░░\] --%/u);
  assert.doesNotMatch(result.stdout, /ctx [▏▎▍▌▋▊▉█░]{6} 4%\/1000k/u);
});

test("LitClaude HUD renders reset countdowns from Claude Code epoch seconds", () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const result = spawnSync(process.execPath, [hudPath], {
    cwd: root,
    encoding: "utf8",
    input: `${JSON.stringify({
      model: { display_name: "Opus 4.8" },
      cwd: root,
      context_window: { context_window_size: 1000000, used_percentage: 9 },
      rate_limits: {
        five_hour: { used_percentage: 7, resets_at: nowSeconds + 2 * 60 * 60 + 15 * 60 },
        seven_day: { used_percentage: 44, resets_at: nowSeconds + 3 * 24 * 60 * 60 + 6 * 60 * 60 },
      },
    })}\n`,
    env: {
      ...colorEnv,
      LITCLAUDE_HUD_NO_COLOR: "1",
      LITCLAUDE_HUD_TEST_USAGE: "",
      CLAUDE_HUD_TEST_USAGE: "",
      LITCLAUDE_VERSION: packageJson.version,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /5h \[[▏▎▍▌▋▊▉█░]+\] 7% ↻2h1[34]m/u);
  assert.match(result.stdout, /1w \[[▏▎▍▌▋▊▉█░]+\] 44% ↻3d5?h/u);
});

test("LitClaude HUD rounds noisy percentage values before display", () => {
  const result = spawnSync(process.execPath, [hudPath], {
    cwd: root,
    encoding: "utf8",
    input: `${JSON.stringify({
      model: { display_name: "Opus 4.8 (1M context)" },
      cwd: root,
      context_window: { context_window_size: 1000000, used_percentage: 42.8000000001 },
      rate_limits: {
        five_hour: { used_percentage: 7.000000000000001 },
        seven_day: { used_percentage: 24.4 },
      },
    })}\n`,
    env: {
      ...colorEnv,
      LITCLAUDE_HUD_NO_COLOR: "1",
      LITCLAUDE_HUD_TEST_USAGE: "",
      CLAUDE_HUD_TEST_USAGE: "",
      LITCLAUDE_VERSION: packageJson.version,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ctx \[[▏▎▍▌▋▊▉█░]{3}\] 43%\/1000k/u);
  assert.match(result.stdout, /5h \[[▏▎▍▌▋▊▉█░]+\] 7%/u);
  assert.match(result.stdout, /1w \[[▏▎▍▌▋▊▉█░]+\] 24%/u);
  assert.doesNotMatch(result.stdout, /42\.8000000001%|7\.000000000000001%|24\.4%/u);
});

test("LitClaude HUD ignores local command stdout transcript entries", () => {
  const tmp = mkdtempSync(join(tmpdir(), "litclaude-hud-test-"));

  try {
    const transcript = join(tmp, "transcript.jsonl");
    writeFileSync(
      transcript,
      [
        JSON.stringify({ type: "user", message: { content: "Use the routing fix." } }),
        JSON.stringify({
          type: "user",
          message: {
            content: "<local-command-stdout>Set model to Opus 4.8 (1M context) (default) and saved as your default for new session...",
          },
        }),
      ].join("\n"),
    );

    const result = spawnSync(process.execPath, [hudPath], {
      cwd: root,
      encoding: "utf8",
      input: `${JSON.stringify({
        model: { display_name: "Opus 4.8" },
        cwd: root,
        transcript_path: transcript,
      })}\n`,
      env: {
        ...colorEnv,
        LITCLAUDE_HUD_NO_COLOR: "1",
        LITCLAUDE_HUD_TEST_USAGE: "",
        CLAUDE_HUD_TEST_USAGE: "",
        LITCLAUDE_VERSION: packageJson.version,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /└─ Use the routing fix\./u);
    assert.doesNotMatch(result.stdout, /<local-command-stdout>|Set model to Opus/u);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("LitClaude HUD ignores Claude command XML transcript entries", () => {
  const tmp = mkdtempSync(join(tmpdir(), "litclaude-hud-test-"));

  try {
    const transcript = join(tmp, "transcript.jsonl");
    writeFileSync(
      transcript,
      [
        JSON.stringify({ type: "user", message: { content: "Continue with the release checklist." } }),
        JSON.stringify({
          type: "user",
          message: {
            content: "<command-name>/exit</command-name> <command-message>exit</command-message> <command-args></command-args>",
          },
        }),
      ].join("\n"),
    );

    const result = spawnSync(process.execPath, [hudPath], {
      cwd: root,
      encoding: "utf8",
      input: `${JSON.stringify({
        model: { display_name: "Opus 4.8" },
        cwd: root,
        transcript_path: transcript,
      })}\n`,
      env: {
        ...colorEnv,
        LITCLAUDE_HUD_NO_COLOR: "1",
        LITCLAUDE_HUD_TEST_USAGE: "",
        CLAUDE_HUD_TEST_USAGE: "",
        LITCLAUDE_VERSION: packageJson.version,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /└─ Continue with the release checklist\./u);
    assert.doesNotMatch(result.stdout, /<command-name>|<command-message>|<command-args>|\/exit/u);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("LitClaude HUD keeps 5h and 1w placeholders visible when rate limits are absent", () => {
  const result = spawnSync(process.execPath, [hudPath], {
    cwd: root,
    encoding: "utf8",
    input: `${JSON.stringify({ model: { display_name: "Opus 4.8" }, cwd: root })}\n`,
    env: {
      ...colorEnv,
      LITCLAUDE_HUD_NO_COLOR: "1",
      LITCLAUDE_HUD_TEST_USAGE: "",
      CLAUDE_HUD_TEST_USAGE: "",
      LITCLAUDE_VERSION: packageJson.version,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /5h \[░░\] --%/u);
  assert.match(result.stdout, /1w \[░░\] --%/u);
});

test("LitClaude HUD keeps compact no-color line within constrained status width", () => {
  const result = spawnSync(process.execPath, [hudPath], {
    cwd: root,
    encoding: "utf8",
    input: `${JSON.stringify({
      model: { display_name: "Opus 4.8" },
      context_window: { context_window_size: 1000000, used_percentage: 0 },
    })}\n`,
    env: {
      ...colorEnv,
      LITCLAUDE_HUD_NO_COLOR: "1",
      LITCLAUDE_HUD_TEST_USAGE: "",
      CLAUDE_HUD_TEST_USAGE: "",
      LITCLAUDE_VERSION: packageJson.version,
    },
  });

  const firstLine = result.stdout.trim().split(/\n/u)[0];
  assert.equal(result.status, 0, result.stderr);
  assert.match(firstLine, /ctx \[░░░\] 0%\/1000k/u);
  assert.match(firstLine, /5h \[░░\] --%/u);
  assert.match(firstLine, /1w \[░░\] --%/u);
  assert.equal([...firstLine].length <= 85, true, firstLine);
});

const runReadabilityFixture = (overrides = {}) => {
  const env = { ...colorEnv };
  for (const key of [
    "NO_COLOR",
    "LITCLAUDE_HUD_NO_COLOR",
    "COLORTERM",
    "WT_SESSION",
    "TERM_PROGRAM",
    "TERM",
    "WSL_DISTRO_NAME",
    "WSL_INTEROP",
    "LITCLAUDE_HUD_APPEARANCE",
    "LITCLAUDE_HUD_COLOR_DEPTH",
  ]) delete env[key];
  Object.assign(env, {
    LITCLAUDE_HUD_TEST_USAGE: "",
    CLAUDE_HUD_TEST_USAGE: "",
    LITCLAUDE_VERSION: packageJson.version,
    ...overrides,
  });
  return spawnSync(process.execPath, [hudPath], {
    cwd: root,
    encoding: "utf8",
    input: `${JSON.stringify({
      model: { display_name: "Opus 4.8" },
      cwd: root,
      context_window: { context_window_size: 1000000, used_percentage: 18 },
      rate_limits: {
        five_hour: { used_percentage: 4 },
        seven_day: { used_percentage: 35 },
      },
    })}\n`,
    env,
  });
};

const essentialHudTokens = ["O4.8", "ctx", "18%/1000k", "5h", "4%", "1w", "35%", "git"];
const sgrStateBefore = (value, offset) => {
  let foreground = "default";
  let dim = false;
  for (const match of value.slice(0, offset).matchAll(/\x1b\[([0-9;]*)m/gu)) {
    const params = match[1] ? match[1].split(";").map(Number) : [0];
    for (let index = 0; index < params.length; index += 1) {
      const code = params[index];
      if (code === 0) {
        foreground = "default";
        dim = false;
      } else if (code === 39) {
        foreground = "default";
      } else if (code === 2) {
        dim = true;
      } else if (code === 22) {
        dim = false;
      } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
        foreground = "colored";
      } else if (code === 38) {
        const mode = params[index + 1];
        if (mode === 5) {
          foreground = "colored";
          index += 2;
        } else if (mode === 2) {
          foreground = "colored";
          index += 4;
        }
      }
    }
  }
  return { foreground, dim };
};

const assertDefaultForeground = (value, tokens = essentialHudTokens) => {
  const plain = stripAnsi(value);
  for (const token of tokens) {
    assert.equal(plain.includes(token), true, `missing HUD token: ${token}`);
    const offset = value.indexOf(token);
    const state = sgrStateBefore(value, offset);
    assert.deepEqual(state, { foreground: "default", dim: false }, `colored HUD token: ${token}`);
  }
};

test("LitClaude HUD foreground oracle distinguishes active color from reset/default state", () => {
  assert.throws(() => assertDefaultForeground("\x1b[38;5;81mO4.8", ["O4.8"]), /colored HUD token/u);
  assert.throws(() => assertDefaultForeground("\x1b[2mO4.8", ["O4.8"]), /colored HUD token/u);
  assert.doesNotThrow(() => assertDefaultForeground("\x1b[38;5;81maccent\x1b[0mO4.8", ["O4.8"]));
  assert.doesNotThrow(() => assertDefaultForeground("\x1b[38;5;81maccent\x1b[39mO4.8", ["O4.8"]));
  assert.doesNotThrow(() => assertDefaultForeground("\x1b[38;5;81m\x1b[2maccent\x1b[0mO4.8", ["O4.8"]));
});

test("LitClaude HUD keeps essential text on the terminal default foreground for light appearances", () => {
  const result = runReadabilityFixture({
    COLORTERM: "truecolor",
    LITCLAUDE_HUD_APPEARANCE: "light",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /O4\.8.*ctx.*18%\/1000k.*5h.*4%.*1w.*35%/u);
  assertDefaultForeground(result.stdout);
});

const assertColoredTokens = (value, tokens = essentialHudTokens) => {
  for (const token of tokens) {
    const offset = value.indexOf(token);
    assert.equal(offset >= 0, true, `missing HUD token: ${token}`);
    assert.equal(sgrStateBefore(value, offset).foreground, "colored", `uncolored HUD token: ${token}`);
  }
};

for (const [label, overrides] of [["dark appearances", { LITCLAUDE_HUD_APPEARANCE: "dark" }], ["an unset appearance", {}]]) {
  test(`LitClaude HUD keeps the colored status text and neon brand for ${label}`, () => {
    const result = runReadabilityFixture({ COLORTERM: "truecolor", ...overrides });

    assert.equal(result.status, 0, result.stderr);
    assert.match(stripAnsi(result.stdout), /O4\.8.*ctx.*18%\/1000k.*5h.*4%.*1w.*35%/u);
    assertColoredTokens(result.stdout);
    assert.match(result.stdout, /\x1b\[38;2;/u);
  });
}

test("LitClaude HUD defaults essential text to the terminal foreground for unknown appearances", () => {
  const result = runReadabilityFixture({
    COLORTERM: "truecolor",
    LITCLAUDE_HUD_APPEARANCE: "unknown",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /O4\.8.*ctx.*18%\/1000k.*5h.*4%.*1w.*35%/u);
  assertDefaultForeground(result.stdout);
  const brand = `[🔥LITCLAUDE v${packageJson.version}]`;
  const brandOffset = result.stdout.indexOf(brand);
  assert.equal(brandOffset >= 0, true, "missing HUD brand");
  assert.deepEqual(sgrStateBefore(result.stdout, brandOffset), { foreground: "default", dim: false });
});

test("LitClaude HUD explicit 16-color depth takes precedence over truecolor capability", () => {
  const result = runReadabilityFixture({
    COLORTERM: "truecolor",
    LITCLAUDE_HUD_APPEARANCE: "dark",
    LITCLAUDE_HUD_COLOR_DEPTH: "16",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /\x1b\[38;2;/u);
  assert.doesNotMatch(result.stdout, /\x1b\[38;5;/u);
  assert.match(stripAnsi(result.stdout), /O4\.8.*ctx.*18%\/1000k.*5h.*4%.*1w.*35%/u);
});

test("LitClaude HUD explicit 256-color depth suppresses truecolor escapes", () => {
  const result = runReadabilityFixture({
    COLORTERM: "truecolor",
    LITCLAUDE_HUD_APPEARANCE: "dark",
    LITCLAUDE_HUD_COLOR_DEPTH: "256",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /\x1b\[38;2;/u);
  assert.match(result.stdout, /\x1b\[38;5;/u);
});

test("LitClaude HUD treats TERM=dumb as plain even when COLORTERM advertises truecolor", () => {
  const result = runReadabilityFixture({
    COLORTERM: "truecolor",
    TERM: "dumb",
    LITCLAUDE_HUD_APPEARANCE: "dark",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes("\x1b"), false, result.stdout);
  assert.match(result.stdout, /O4\.8.*ctx.*18%\/1000k.*5h.*4%.*1w.*35%/u);
});

test("LitClaude HUD treats an empty NO_COLOR presence as a no-color request", () => {
  const result = runReadabilityFixture({
    NO_COLOR: "",
    COLORTERM: "truecolor",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes("\x1b"), false, result.stdout);
});

// Optional Jev skill hint segment. The key is obviously fake and must never reach the HUD.
const JEV_FAKE_KEY = "test-key-not-real-0000";
const jevEnv = (overrides = {}) => {
  const env = { ...colorEnv };
  for (const key of Object.keys(env)) if (key.startsWith("LITCLAUDE_JEV") || key === "TYPESAFE_API_KEY") delete env[key];
  return {
    ...env,
    LITCLAUDE_NO_AUTO_UPDATE: "1",
    LITCLAUDE_NO_UPDATE_CHECK: "1",
    LITCLAUDE_HUD_NO_COLOR: "1",
    LITCLAUDE_HUD_TEST_USAGE: "",
    CLAUDE_HUD_TEST_USAGE: "",
    LITCLAUDE_VERSION: packageJson.version,
    ...overrides,
  };
};
const jevOn = { LITCLAUDE_JEV: "1", TYPESAFE_API_KEY: JEV_FAKE_KEY };

const jevProject = (t, record) => {
  const cwd = mkdtempSync(join(tmpdir(), "litclaude-hud-jev-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  if (record) {
    mkdirSync(join(cwd, ".litclaude", "jev"), { recursive: true });
    writeFileSync(join(cwd, ".litclaude", "jev", "session-jev-session.json"), JSON.stringify(record));
  }
  return cwd;
};

const runJevHud = (cwd, env) => {
  const result = spawnSync(process.execPath, [hudPath], {
    cwd,
    encoding: "utf8",
    input: `${JSON.stringify({
      model: { display_name: "Opus 4.8" },
      cwd,
      session_id: "jev-session",
      context_window: { context_window_size: 1000000, used_percentage: 0 },
    })}\n`,
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes(JEV_FAKE_KEY), false, "the key never reaches the HUD");
  return result.stdout.split("\n")[0];
};

const hinted = { calls: 1, noted: false, last: { skill: "lit-humanizer", latency_ms: 270 } };

// The Jev badge sits right after the model label; "" means the model label stands alone.
const jevBadge = (line) => /\| O4\.8(.*?) │ ctx /u.exec(stripAnsi(line))?.[1] ?? null;

test("LitClaude HUD shows no Jev badge while the feature is off", (t) => {
  const cwd = jevProject(t, hinted);
  for (const overrides of [{}, { TYPESAFE_API_KEY: JEV_FAKE_KEY }, { LITCLAUDE_JEV: "0", TYPESAFE_API_KEY: JEV_FAKE_KEY }]) {
    const line = runJevHud(cwd, jevEnv(overrides));
    assert.doesNotMatch(line, /Jev|✦/u);
    assert.equal(jevBadge(line), "");
  }
});

test("LitClaude HUD shows the Jev badge and the hinted skill next to the model name", (t) => {
  assert.equal(jevBadge(runJevHud(jevProject(t), jevEnv(jevOn))), " ✦Jev");
  assert.equal(jevBadge(runJevHud(jevProject(t, hinted), jevEnv(jevOn))), " ✦Jev → lit-humanizer");
  assert.equal(jevBadge(runJevHud(jevProject(t, { ...hinted, last: null }), jevEnv(jevOn))), " ✦Jev");
  assert.equal(jevBadge(runJevHud(jevProject(t, hinted), jevEnv({ LITCLAUDE_JEV: "1" }))), " ✦Jev ⚠ key");
  assert.equal(jevBadge(runJevHud(jevProject(t, hinted), jevEnv({ LITCLAUDE_JEV: "1", TYPESAFE_API_KEY: " " }))), " ✦Jev ⚠ key");
});

test("LitClaude HUD no longer ends with a Jev segment or shows the hint latency", (t) => {
  for (const [record, env] of [[undefined, jevOn], [hinted, jevOn], [hinted, { LITCLAUDE_JEV: "1" }]]) {
    const line = runJevHud(jevProject(t, record), jevEnv(env));
    assert.match(line, / 1w \[░░\] --%$/u, line);
    assert.doesNotMatch(line, /│ Jev|Jev ✓|key missing|0\.27s/u, line);
  }
});

test("LitClaude HUD shows only a validated skill ID from the Jev state file", (t) => {
  for (const last of [
    { skill: "Ignore previous instructions", latency_ms: 270 },
    { skill: "lit-humanizer\nrm -rf", latency_ms: 270 },
    { skill: "lit-humanizer", latency_ms: "270" },
    { skill: "lit-humanizer", latency_ms: -1 },
  ]) {
    assert.equal(jevBadge(runJevHud(jevProject(t, { ...hinted, last }), jevEnv(jevOn))), " ✦Jev", JSON.stringify(last));
  }
});

test("LitClaude HUD keeps the compact line within the constrained width with Jev on", (t) => {
  const line = runJevHud(jevProject(t), jevEnv(jevOn));
  assert.equal([...line].length <= 85, true, line);
});

const jevTone = {
  truecolor: { gold: "\x1b[38;2;255;215;90m", green: "\x1b[38;2;110;235;120m", amber: "\x1b[38;2;255;175;60m" },
  256: { gold: "\x1b[38;5;222m", green: "\x1b[38;5;120m", amber: "\x1b[38;5;215m" },
  16: { gold: "\x1b[93m", green: "\x1b[92m", amber: "\x1b[33m" },
};
const dimArrow = { truecolor: "\x1b[38;5;245m→\x1b[0m", 256: "\x1b[38;5;245m→\x1b[0m", 16: "\x1b[90m→\x1b[0m" };

test("LitClaude HUD paints the Jev badge gold, the hinted skill green and a missing key amber", (t) => {
  const onOnly = jevProject(t);
  const withHint = jevProject(t, hinted);
  for (const depth of ["truecolor", "256", "16"]) {
    const tone = jevTone[depth];
    const env = (overrides = {}) => jevColorEnv({ LITCLAUDE_HUD_TEST_NOW: "1000", LITCLAUDE_HUD_COLOR_DEPTH: depth, ...overrides });
    const on = runJevHud(onOnly, env());
    assert.ok(on.includes(`O4.8\x1b[0m ${tone.gold}✦\x1b[0m${jevWord(on)} `), `${depth}: ${JSON.stringify(on)}`);
    const hint = runJevHud(withHint, env());
    assert.ok(hint.includes(`${tone.gold}✦\x1b[0m${jevWord(hint)} ${dimArrow[depth]} ${tone.green}lit-humanizer\x1b[0m `), `${depth}: ${JSON.stringify(hint)}`);
    const missing = runJevHud(withHint, env({ TYPESAFE_API_KEY: undefined }));
    assert.ok(missing.includes(`O4.8\x1b[0m ${tone.amber}✦Jev ⚠ key\x1b[0m `), `${depth}: ${JSON.stringify(missing)}`);
    assert.equal(jevWord(missing), null, "no shimmer while the key is missing");
  }
});

test("LitClaude HUD keeps Jev words on the default foreground for light appearances", (t) => {
  const cwd = jevProject(t, hinted);
  const light = runJevHud(cwd, jevColorEnv({ LITCLAUDE_HUD_TEST_NOW: "1000", LITCLAUDE_HUD_APPEARANCE: "light" }));
  assert.equal(jevWord(light), null, "light appearances keep Jev on the default foreground");
  assertDefaultForeground(light, ["Jev", "lit-humanizer"]);
  assert.match(light, /\x1b\[38;2;255;215;90m✦\x1b\[0mJev /u, "the mark keeps its colour");
  const missing = runJevHud(cwd, jevColorEnv({ LITCLAUDE_HUD_APPEARANCE: "light", TYPESAFE_API_KEY: undefined }));
  assertDefaultForeground(missing, ["Jev", " key"]);
  assert.equal(jevBadge(missing), " ✦Jev ⚠ key");
});

test("LitClaude HUD follows the prompt hook's Jev state turn by turn", (t) => {
  const cwd = jevProject(t);
  const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
  const fakeFetch = pathToFileURL(join(root, "test", "fixtures", "jev", "fake-fetch.mjs")).href;
  const turn = (prompt, response) => {
    const result = spawnSync(process.execPath, ["--import", fakeFetch, hookPath, "user-prompt-submit"], {
      cwd,
      encoding: "utf8",
      input: JSON.stringify({ cwd, session_id: "jev-session", prompt }),
      env: jevEnv({ ...jevOn, JEV_FAKE_RESPONSE: JSON.stringify(response) }),
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(`${result.stdout}${result.stderr}`.includes(JEV_FAKE_KEY), false);
    return runJevHud(cwd, jevEnv(jevOn));
  };
  const answer = (choice) => ({ status: 200, body: JSON.stringify({ answers: { which: { choice, confidence: 0.9 } } }) });

  assert.match(turn("이 보고서 초안에서 AI가 쓴 티 나는 표현을 자연스럽게 고쳐줘.", answer("lit-humanizer")), / O4\.8 ✦Jev → lit-humanizer │ ctx /u);
  assert.match(turn("lit plan the billing migration", answer("lit-humanizer")), / O4\.8 ✦Jev │ ctx /u, "a routed turn clears the last hint");
  assert.match(turn("이 보고서 초안에서 AI가 쓴 티 나는 표현을 자연스럽게 고쳐줘.", answer("lit-humanizer")), / O4\.8 ✦Jev → lit-humanizer │ /u);
  assert.match(turn("what is the capital of France?", answer("none")), / O4\.8 ✦Jev │ ctx /u, "a turn without a hint shows no skill");
});

// The word Jev shimmers: a per-letter rainbow whose starting hue follows the clock.
const jevColorEnv = (overrides = {}) => {
  const env = jevEnv({ ...jevOn, LITCLAUDE_HUD_NO_COLOR: "", COLORTERM: "truecolor", LITCLAUDE_HUD_APPEARANCE: "dark", ...overrides });
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
};
const jevWord = (line) => /(\x1b\[1m(?:\x1b\[[0-9;]+m[Jev]){3}\x1b\[0m) /u.exec(line)?.[1] ?? null;

test("LitClaude HUD paints Jev as a truecolor rainbow without changing the visible text", (t) => {
  const cwd = jevProject(t, hinted);
  const plain = runJevHud(cwd, jevEnv(jevOn));
  for (const record of [hinted, { ...hinted, last: null }]) {
    const project = jevProject(t, record);
    const colored = runJevHud(project, jevColorEnv({ LITCLAUDE_HUD_TEST_NOW: "1000" }));
    const word = jevWord(colored);
    assert.ok(word, colored);
    assert.equal(word.match(/\x1b\[38;2;\d+;\d+;\d+m/gu).length, 3, "one truecolor hue per letter");
    assert.equal(new Set(word.match(/38;2;[\d;]+/gu)).size, 3, "three different hues");
    assert.equal(stripAnsi(colored), runJevHud(project, jevEnv(jevOn)), "visible text is unchanged");
  }
  const stripped = stripAnsi(runJevHud(cwd, jevColorEnv({ LITCLAUDE_HUD_TEST_NOW: "1000" })));
  assert.equal([...stripped].length, [...plain].length, "visible width counts characters, not escapes");
});

test("LitClaude HUD shifts the Jev rainbow with the clock on each render", (t) => {
  const cwd = jevProject(t, hinted);
  const at = (now) => runJevHud(cwd, jevColorEnv({ LITCLAUDE_HUD_TEST_NOW: String(now) }));
  const [first, later, again] = [at(1000), at(4000), at(1000)];
  assert.notEqual(jevWord(first), jevWord(later), "a later refresh starts at another hue");
  assert.equal(jevWord(first), jevWord(again), "the same clock gives the same frame");
  assert.equal(stripAnsi(first), stripAnsi(later));
});

test("LitClaude HUD follows the colour tiers for the Jev rainbow", (t) => {
  const cwd = jevProject(t, hinted);
  const tier = (overrides) => jevWord(runJevHud(cwd, jevColorEnv({ LITCLAUDE_HUD_TEST_NOW: "1000", ...overrides })));
  assert.match(tier({ LITCLAUDE_HUD_COLOR_DEPTH: "256" }), /^\x1b\[1m(?:\x1b\[38;5;\d+m[Jev]){3}\x1b\[0m$/u);
  assert.match(tier({ LITCLAUDE_HUD_COLOR_DEPTH: "16" }), /^\x1b\[1m(?:\x1b\[9[1-6]m[Jev]){3}\x1b\[0m$/u);
  for (const overrides of [{ NO_COLOR: "" }, { NO_COLOR: "1" }, { LITCLAUDE_HUD_NO_COLOR: "1" }, { LITCLAUDE_HUD_COLOR_DEPTH: "plain" }]) {
    const line = runJevHud(cwd, jevColorEnv({ LITCLAUDE_HUD_TEST_NOW: "1000", ...overrides }));
    assert.equal(line.includes("\x1b"), false, JSON.stringify(overrides));
    assert.equal(jevBadge(line), " ✦Jev → lit-humanizer", JSON.stringify(overrides));
    const missing = runJevHud(cwd, jevColorEnv({ ...overrides, TYPESAFE_API_KEY: undefined }));
    assert.equal(missing.includes("\x1b"), false, JSON.stringify(overrides));
    assert.equal(jevBadge(missing), " ✦Jev ⚠ key", JSON.stringify(overrides));
  }
});

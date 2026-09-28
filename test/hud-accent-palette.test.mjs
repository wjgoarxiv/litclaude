import assert from "node:assert/strict";
import test from "node:test";

import {
  HUD_ACCENT_THEMES,
  accentCodeForName,
  hudColorDepth,
  litBrandPrefix,
  normalizeHudAccent,
  normalizeHudAppearance,
  normalizeHudColorDepth,
} from "../plugins/litclaude/lib/hud-accent-palette.mjs";

const packageJson = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../package.json", import.meta.url), "utf8")));

test("LitClaude HUD accent palette exposes ten vivid choices", () => {
  const expected = [
    ["cyan", 81],
    ["blue", 39],
    ["teal", 49],
    ["green", 118],
    ["lavender", 177],
    ["rose", 198],
    ["gold", 220],
    ["orange", 208],
    ["slate", 75],
    ["gray", 231],
  ];

  assert.deepEqual(
    HUD_ACCENT_THEMES.map((theme) => [theme.name, theme.code]),
    expected,
  );
  assert.equal(new Set(HUD_ACCENT_THEMES.map((theme) => theme.code)).size, 10);
  assert.equal(HUD_ACCENT_THEMES.some((theme) => [60, 66, 132, 136, 139, 173, 245].includes(theme.code)), false);
  assert.equal(normalizeHudAccent("not-a-theme"), "cyan");
  assert.equal(normalizeHudAccent(" ROSE "), "rose");
  assert.equal(accentCodeForName("rose"), 198);
  assert.equal(accentCodeForName("not-a-theme"), 81);
});

test("LitClaude HUD keeps appearance separate from capability depth and preserves WSL detection", () => {
  assert.equal(normalizeHudAppearance("light"), "light");
  assert.equal(normalizeHudAppearance("dark"), "dark");
  assert.equal(normalizeHudAppearance("anything-else"), "unknown");
  assert.equal(normalizeHudAppearance(undefined), "dark");
  assert.equal(normalizeHudAppearance(""), "dark");
  assert.equal(normalizeHudColorDepth("none"), "plain");
  assert.equal(normalizeHudColorDepth("24bit"), "truecolor");
  assert.equal(normalizeHudColorDepth("ansi256"), "256");
  assert.equal(normalizeHudColorDepth("ansi16"), "16");
  assert.equal(hudColorDepth({ COLORTERM: "truecolor", LITCLAUDE_HUD_COLOR_DEPTH: "16" }), "16");
  assert.equal(hudColorDepth({ WSL_DISTRO_NAME: "Ubuntu", TERM: "xterm-256color" }), "truecolor");
  assert.equal(hudColorDepth({ TERM: "xterm-256color" }), "256");
  assert.equal(hudColorDepth({ TERM: "xterm" }), "16");
  assert.equal(hudColorDepth({ TERM: "dumb", COLORTERM: "truecolor" }), "plain");
  assert.equal(hudColorDepth({ NO_COLOR: "", COLORTERM: "truecolor" }), "plain");
  assert.match(litBrandPrefix(packageJson.version, { depth: "16" }), /\x1b\[36m/u);
  assert.doesNotMatch(litBrandPrefix(packageJson.version, { depth: "16" }), /38;5|38;2/u);
  assert.match(litBrandPrefix(packageJson.version, { depth: "truecolor", appearance: "light" }), /^\x1b\[0m\x1b\[1m/u);
  assert.match(litBrandPrefix(packageJson.version, { depth: "truecolor", appearance: "unknown" }), /^\x1b\[0m\[/u);
  assert.match(litBrandPrefix(packageJson.version, { depth: "truecolor", appearance: "dark" }), /^\x1b\[0m\x1b\[1m/u);
});

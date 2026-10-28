import assert from "node:assert/strict";
import test from "node:test";

import { charWidth, textWidth, truncateToWidth } from "../plugins/litclaude/lib/mod/layout.mjs";
import {
  EASE,
  TIMINGS,
  barCells,
  gradientAt,
  isSettled,
  lerpColor,
  motionProfile,
  retarget,
  sample,
  still,
} from "../plugins/litclaude/lib/mod/motion.mjs";
import { glyphSet, normalizeModSettings, resolveGlyphs } from "../plugins/litclaude/lib/mod/settings.mjs";

test("cell widths count Hangul, CJK and emoji as two cells and marks as none", () => {
  assert.equal(charWidth("a"), 1);
  assert.equal(charWidth("교"), 2);
  assert.equal(charWidth("漢"), 2);
  assert.equal(charWidth("🔥"), 2);
  assert.equal(charWidth("́"), 0);
  assert.equal(charWidth("️"), 0);
  assert.equal(textWidth("README 데모 GIF 교체"), 6 + 1 + 4 + 1 + 3 + 1 + 4);
  assert.equal(textWidth("🔥 LIT"), 6);
  assert.equal(textWidth("✓ ● ○ ▰ ▱ ⟳ ˚ ✦"), 15);
});

test("truncation never splits a double-width cell and ends with an ellipsis", () => {
  assert.equal(truncateToWidth("plain text", 20), "plain text");
  assert.equal(truncateToWidth("README 데모 GIF 교체", 10), "README 데…");
  assert.equal(textWidth(truncateToWidth("README 데모 GIF 교체", 10)), 10);
  // At 9 cells the Hangul syllable would leave no room for the ellipsis, so it drops whole.
  assert.equal(truncateToWidth("README 데모 GIF 교체", 9), "README…");
  assert.equal(truncateToWidth("데모", 1), "…");
  assert.equal(truncateToWidth("데모", 0), "");
});

test("easings hit their ends and ease-out-back overshoots before settling", () => {
  for (const ease of Object.values(EASE)) {
    assert.equal(Math.abs(Math.round(ease(0) * 1000) / 1000), 0);
    assert.equal(Math.round(ease(1) * 1000) / 1000, 1);
  }
  const peak = Math.max(...Array.from({ length: 101 }, (_, i) => EASE.outBack(i / 100)));
  assert.ok(peak > 1.05 && peak < 1.15, `outBack peak ${peak}`);
  assert.ok(EASE.inOutCubic(0.25) < 0.25 && EASE.inOutCubic(0.75) > 0.75);
  assert.ok(EASE.inCubic(0.5) < 0.2);
});

test("the approved timings are the fast set", () => {
  assert.deepEqual(
    { stagger: TIMINGS.stagger, entry: TIMINGS.entry, fill: TIMINGS.fill, noticeIn: TIMINGS.noticeIn, noticeOut: TIMINGS.noticeOut, crossfade: TIMINGS.crossfade, shimmer: TIMINGS.shimmer, embers: TIMINGS.embers },
    { stagger: 60, entry: 160, fill: 300, noticeIn: 220, noticeOut: 150, crossfade: 140, shimmer: 400, embers: 1000 },
  );
  assert.ok(TIMINGS.completion <= 1200);
});

test("motion profiles: full overshoots, subtle does not and is shorter, off is instant", () => {
  const full = motionProfile("full");
  const subtle = motionProfile("subtle");
  const off = motionProfile("off");
  assert.equal(full.enterEase, EASE.outBack);
  assert.equal(subtle.enterEase, EASE.outCubic);
  assert.ok(subtle.duration(TIMINGS.fill) < full.duration(TIMINGS.fill));
  assert.equal(off.duration(TIMINGS.fill), 0);
  assert.equal(full.embers, true);
  assert.equal(subtle.embers, false);
  assert.equal(off.shimmer, false);
});

test("channels retarget from where they stand and settle", () => {
  let channel = still(0.25);
  assert.equal(sample(channel, 0), 0.25);
  channel = retarget(channel, 0.75, 1000, 300);
  assert.equal(sample(channel, 1000), 0.25);
  assert.equal(sample(channel, 1300), 0.75);
  assert.ok(Math.abs(sample(channel, 1150) - 0.5) < 1e-9, "ease-in-out is half way at half time");
  assert.equal(isSettled(channel, 1299), false);
  assert.equal(isSettled(channel, 1300), true);
  // Retargeting mid-flight starts from the sampled value, so the bar never jumps.
  const mid = retarget(channel, 0, 1150, 300);
  assert.ok(Math.abs(sample(mid, 1150) - 0.5) < 1e-9);
  assert.equal(retarget(still(1), 1, 0, 300).dur, 0, "a retarget to the same value is no animation");
  assert.equal(isSettled(retarget(still(0), 1, 0, 0), 0), true);
});

test("colors mix in RGB and gradients follow their stops", () => {
  assert.equal(lerpColor("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(lerpColor("#0aa6c2", "#c27a0a", 0), "#0aa6c2");
  assert.equal(lerpColor("#0aa6c2", "#c27a0a", 1), "#c27a0a");
  assert.equal(gradientAt(["#ff2d95", "#00e5ff"], 0), "#ff2d95");
  assert.equal(gradientAt(["#ff6337", "#ff2d95", "#00e5ff"], 0.5), "#ff2d95");
  assert.equal(gradientAt(["#ff6337", "#ff2d95", "#00e5ff"], 1), "#00e5ff");
});

test("the progress bar fills whole cells and fades the leading cell in by colour", () => {
  const glyphs = (fraction, cells) => barCells(fraction, cells).map(({ glyph }) => glyph).join("");
  assert.equal(glyphs(0, 4), "░░░░");
  assert.equal(glyphs(1, 4), "████");
  assert.equal(glyphs(0.5, 4), "██░░");
  assert.equal(glyphs(3 / 7, 7), "███░░░░");
  assert.equal(glyphs(0.53125, 4), "███░");
  const quarter = barCells(0.5625, 4)[2].color;
  const threeQuarters = barCells(0.6875, 4)[2].color;
  assert.equal(barCells(0.5, 4)[2].color, "#30363d", "an empty cell is the track");
  assert.notEqual(quarter, threeQuarters, "the head brightens as it fills");
  assert.equal(lerpColor("#30363d", barCells(0.75, 4)[2].color, 0.25), quarter);
  assert.equal(barCells(0.5, 10).length, 10);
  const filled = barCells(1, 5).map(({ color }) => color);
  assert.equal(filled[0], "#ff2d95");
  assert.equal(filled[4], "#00e5ff");
});

test("a moving bar brightens its leading cell, and only that cell", () => {
  const still = barCells(0.53125, 4);
  const moving = barCells(0.53125, 4, 1);
  assert.deepEqual(moving.map(({ glyph }) => glyph), still.map(({ glyph }) => glyph));
  assert.notEqual(moving[2].color, still[2].color, "the partial head cell glows");
  assert.deepEqual([moving[0].color, moving[1].color, moving[3].color], [still[0].color, still[1].color, still[3].color]);
  assert.notEqual(barCells(0.5, 4, 1)[1].color, barCells(0.5, 4)[1].color, "a whole-cell head glows too");
});

test("settings fall back to safe defaults", () => {
  assert.deepEqual(normalizeModSettings({}), { motion: "full", glyphs: "auto", band: "always", notify: "off", club: "on" });
  assert.deepEqual(normalizeModSettings({ motion: "Subtle", glyphs: "NERD", band: "auto", notify: "Finish", club: "OFF" }), { motion: "subtle", glyphs: "nerd", band: "auto", notify: "finish", club: "off" });
  assert.deepEqual(normalizeModSettings({ motion: "wild", glyphs: "emoji", band: "sometimes", notify: "always", club: "maybe" }), { motion: "full", glyphs: "auto", band: "always", notify: "off", club: "on" });
  assert.equal(normalizeModSettings(undefined).motion, "full");
});

test("glyphs: auto follows the icon font, and only the terminal ever gets Nerd glyphs", () => {
  assert.equal(resolveGlyphs("auto", "terminal", true), "nerd");
  assert.equal(resolveGlyphs("auto", "terminal", false), "basic");
  assert.equal(resolveGlyphs("nerd", "terminal", false), "nerd", "an explicit choice wins in the terminal");
  assert.equal(resolveGlyphs("basic", "terminal", true), "basic");
  for (const surface of ["desktop", "vscode", "mobile"]) {
    assert.equal(resolveGlyphs("nerd", surface, true), "basic", `${surface} draws with its own font`);
    assert.equal(resolveGlyphs("auto", surface, true), "basic", surface);
  }
});

test("the basic glyph set uses no private-use code points", () => {
  const basic = glyphSet("basic");
  for (const value of Object.values(basic)) {
    for (const ch of value) assert.ok(ch.codePointAt(0) < 0xe000 || ch.codePointAt(0) > 0xf8ff, `private-use ${ch.codePointAt(0).toString(16)}`);
  }
  const nerd = glyphSet("nerd");
  assert.equal(nerd.capLeft, "");
  assert.equal(nerd.capRight, "");
  assert.equal(basic.capLeft, "");
  assert.equal(charWidth(nerd.capLeft), 1);
});

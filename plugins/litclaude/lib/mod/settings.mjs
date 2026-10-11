// The LIT band's three userConfig options. The manifest declares them as plain strings without an
// `options` list, because Claude Code 2.1.270 and older refuse a whole plugin whose userConfig has
// one; the values are checked here instead, and anything unknown falls back to the default.

const CHOICES = Object.freeze({
  motion: ["full", "subtle", "off"],
  glyphs: ["auto", "nerd", "basic"],
  band: ["auto", "always", "off"],
});

const pick = (value, choices) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return choices.includes(normalized) ? normalized : choices[0];
};

export const normalizeModSettings = (options) => ({
  motion: pick(options?.motion, CHOICES.motion),
  glyphs: pick(options?.glyphs, CHOICES.glyphs),
  band: pick(options?.band, CHOICES.band),
});

// The glyph set one surface draws. Private-use Nerd Font glyphs only reach the terminal, which
// draws with the person's own fonts; `auto` uses them there when the icon font is installed. The
// desktop app and the other surfaces always get the basic set.
export const resolveGlyphs = (preference, surface, iconFontPresent) => {
  if (surface !== "terminal") return "basic";
  if (preference === "auto") return iconFontPresent ? "nerd" : "basic";
  return preference === "nerd" ? "nerd" : "basic";
};

const BASIC = Object.freeze({
  capLeft: "",
  capRight: "",
  done: "✓",
  now: "●",
  todo: "○",
  warn: "⚠",
  link: "─",
  rail: "━",
  next: "▸",
  lane: "●",
  idleLane: "◌",
  loop: "⟳",
  fail: "✗",
  flag: "⚑",
});

const NERD = Object.freeze({
  ...BASIC,
  capLeft: "",
  capRight: "",
  done: "",
  todo: "",
  warn: "",
});

export const glyphSet = (glyphs) => (glyphs === "nerd" ? NERD : BASIC);

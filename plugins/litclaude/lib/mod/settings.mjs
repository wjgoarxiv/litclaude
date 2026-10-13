// The LIT band's four userConfig options. The manifest declares them as plain strings without an
// `options` list, because Claude Code 2.1.270 and older refuse a whole plugin whose userConfig has
// one; the values are checked here instead, and anything unknown falls back to the default (the
// first choice). `notify` raises a notification through the person's own channel when LIT work
// completes or a LIT turn longer than three minutes ends; `finish+sound` adds a sound only where
// the plugin ships one, and none ships yet, so it notifies like `finish`.

export const MOD_CHOICES = Object.freeze({
  motion: ["full", "subtle", "off"],
  glyphs: ["auto", "nerd", "basic"],
  band: ["always", "auto", "off"],
  notify: ["off", "finish", "finish+sound"],
});

const pick = (value, choices) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return choices.includes(normalized) ? normalized : choices[0];
};

export const normalizeModSettings = (options) => ({
  motion: pick(options?.motion, MOD_CHOICES.motion),
  glyphs: pick(options?.glyphs, MOD_CHOICES.glyphs),
  band: pick(options?.band, MOD_CHOICES.band),
  notify: pick(options?.notify, MOD_CHOICES.notify),
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
  warn: "⚠",
  link: "─",
  rail: "━",
  next: "▸",
  lane: "●",
  idleLane: "◌",
  loop: "⟳",
  fail: "✗",
  flag: "⚑",
  bolt: "⚡",
  recentBolt: "↯",
  branch: "git",
});

const NERD = Object.freeze({
  ...BASIC,
  capLeft: "",
  capRight: "",
  done: "",
  warn: "",
  bolt: "",
  recentBolt: "",
  branch: "",
});

export const glyphSet = (glyphs) => (glyphs === "nerd" ? NERD : BASIC);

// The status line's accents (hud-accent-palette.mjs HUD_ACCENT_THEMES, kept equal by a test) as
// xterm 256-colour codes. The mod cannot import that file, so the card reads the same names here.
export const ACCENT_CODES = Object.freeze({
  cyan: 81,
  blue: 39,
  teal: 49,
  green: 118,
  lavender: 177,
  rose: 198,
  gold: 220,
  orange: 208,
  slate: 75,
  gray: 231,
});

const CUBE = [0, 95, 135, 175, 215, 255];
const hex2 = (value) => value.toString(16).padStart(2, "0");

export const xterm256Hex = (code) => {
  if (code >= 232) {
    const level = 8 + (code - 232) * 10;
    return `#${hex2(level).repeat(3)}`;
  }
  const index = code - 16;
  return `#${[Math.floor(index / 36), Math.floor(index / 6) % 6, index % 6].map((step) => hex2(CUBE[step])).join("")}`;
};

export const accentHex = (name) => xterm256Hex(ACCENT_CODES[String(name ?? "").trim().toLowerCase()] ?? ACCENT_CODES.cyan);

const knownAccent = (name) => {
  const normalized = String(name ?? "").trim().toLowerCase();
  return Object.hasOwn(ACCENT_CODES, normalized) ? normalized : null;
};

// The accent the status line draws with: the installer writes it into the statusLine command
// (`LITCLAUDE_HUD_ACCENT=<name> node …`) and records it under the `litclaude` settings key; an
// accent exported in the shell is the last resort, as for a hand-written status line.
export const accentFromSettings = (settings, envValue) => {
  const command = typeof settings?.statusLine?.command === "string" ? settings.statusLine.command : "";
  const inline = /\bLITCLAUDE_HUD_ACCENT=([A-Za-z]+)/u.exec(command)?.[1];
  return accentHex(knownAccent(inline) ?? knownAccent(settings?.litclaude?.hudAccent) ?? knownAccent(envValue) ?? "cyan");
};

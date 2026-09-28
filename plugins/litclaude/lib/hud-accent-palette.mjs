export const HUD_ACCENT_THEMES = Object.freeze([
  { name: "cyan", code: 81, mood: "LitClaude default" },
  { name: "blue", code: 39, mood: "electric blue" },
  { name: "teal", code: 49, mood: "bright teal" },
  { name: "green", code: 118, mood: "neon green" },
  { name: "lavender", code: 177, mood: "bright violet" },
  { name: "rose", code: 198, mood: "hot pink" },
  { name: "gold", code: 220, mood: "signal amber" },
  { name: "orange", code: 208, mood: "vivid orange" },
  { name: "slate", code: 75, mood: "ice blue" },
  { name: "gray", code: 231, mood: "bright white" },
]);

const accentNames = new Set(HUD_ACCENT_THEMES.map((theme) => theme.name));

export const normalizeHudAccent = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return accentNames.has(normalized) ? normalized : "cyan";
};

export const themeForAccent = (value) => {
  const normalized = normalizeHudAccent(value);
  return HUD_ACCENT_THEMES.find((theme) => theme.name === normalized) ?? HUD_ACCENT_THEMES[0];
};

export const accentCodeForName = (value) => themeForAccent(value).code;

// An unset appearance keeps the original dark-terminal look; light and unknown opt
// into default-foreground text.
export const normalizeHudAppearance = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "dark";
  return normalized === "light" || normalized === "dark" ? normalized : "unknown";
};

export const normalizeHudColorDepth = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["truecolor", "24bit", "24"].includes(normalized)) return "truecolor";
  if (["256", "256color", "ansi256"].includes(normalized)) return "256";
  if (["16", "ansi16", "ansi"].includes(normalized)) return "16";
  if (["plain", "none", "0"].includes(normalized)) return "plain";
  return "";
};

export const ansi16CodeForAccent = (value) => ({
  cyan: 36,
  blue: 34,
  teal: 36,
  green: 32,
  lavender: 35,
  rose: 35,
  gold: 33,
  orange: 33,
  slate: 36,
  gray: 37,
}[normalizeHudAccent(value)] ?? 36);

// --- LitClaude neon brand banner (D21) -------------------------------------
// `[🔥LITCLAUDE vX.Y.Z]` rendered as a neon glow. Truecolor terminals get a
// per-letter hot-pink -> electric-cyan gradient; 256-color terminals fall back
// to bright-magenta bold; NO_COLOR is plain text. The 🔥 is mandatory and the
// brand is accent-independent (LITCLAUDE_HUD_ACCENT still themes the HUD body).
const NEON_BRAND = "LITCLAUDE";
export const NEON_START = Object.freeze([255, 45, 149]); // #ff2d95 hot pink
export const NEON_END = Object.freeze([0, 229, 255]); // #00e5ff electric cyan

export const supportsTruecolor = (env = process.env) => {
  // The portable signal: terminals that export COLORTERM=truecolor|24bit.
  if (/truecolor|24bit/iu.test(String(env.COLORTERM || ""))) return true;
  // Windows Terminal (including WSL2) renders 24-bit color but does NOT export
  // COLORTERM into the shell — it advertises itself via WT_SESSION instead.
  // Without this, WSL2 users get the 256-color magenta fallback by mistake.
  if (env.WT_SESSION) return true;
  // Claude Code may sanitize WT_SESSION before invoking statusLine commands,
  // while keeping WSL markers. Preserve the Windows Terminal/WSL2 gradient path.
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  // 24-bit terminal emulators that may not set COLORTERM in every shell.
  if (/\b(?:vscode|hyper|wezterm|ghostty|iterm\.app)\b/iu.test(String(env.TERM_PROGRAM || ""))) return true;
  // terminfo direct-color / truecolor entries (e.g. xterm-direct, *-truecolor).
  if (/-direct|truecolor/iu.test(String(env.TERM || ""))) return true;
  return false;
};

export const hudColorDepth = (env = process.env) => {
  if (Object.hasOwn(env, "NO_COLOR") || env.LITCLAUDE_HUD_NO_COLOR === "1" || /^dumb$/iu.test(String(env.TERM || ""))) return "plain";
  const override = normalizeHudColorDepth(env.LITCLAUDE_HUD_COLOR_DEPTH);
  if (override) return override;
  if (supportsTruecolor(env)) return "truecolor";
  return /256color/iu.test(String(env.TERM || "")) ? "256" : "16";
};

export const litBrandPrefix = (version, { noColor = false, truecolor = false, depth = "", appearance = "dark" } = {}) => {
  const label = `[🔥${NEON_BRAND} v${version}]`;
  if (noColor) return label;
  const resolvedDepth = depth || (truecolor ? "truecolor" : "256");
  if (resolvedDepth === "plain") return label;
  if (appearance === "unknown") return `\x1b[0m${label}\x1b[0m`;
  if (appearance === "light") return `\x1b[0m\x1b[1m${label}\x1b[0m`;
  if (resolvedDepth === "16") return `\x1b[0m\x1b[1m\x1b[36m${label}\x1b[0m`;
  if (resolvedDepth !== "truecolor") {
    // 256-color neon fallback: bright magenta, bold.
    return `\x1b[0m\x1b[1m\x1b[38;5;201m${label}\x1b[0m`;
  }
  const n = NEON_BRAND.length;
  let out = `\x1b[0m\x1b[1m[🔥`;
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 0 : i / (n - 1);
    const r = Math.round(NEON_START[0] + (NEON_END[0] - NEON_START[0]) * t);
    const g = Math.round(NEON_START[1] + (NEON_END[1] - NEON_START[1]) * t);
    const b = Math.round(NEON_START[2] + (NEON_END[2] - NEON_START[2]) * t);
    out += `\x1b[38;2;${r};${g};${b}m${NEON_BRAND[i]}`;
  }
  out += `\x1b[38;2;${NEON_END[0]};${NEON_END[1]};${NEON_END[2]}m v${version}]\x1b[0m`;
  return out;
};

// --- Rainbow text (Jev skill hint) ------------------------------------------
// Per-character hue sweep starting at `phase` degrees: truecolor paints exact hues, 256-color
// snaps each hue to the 6x6x6 cube, 16-color picks the nearest bright hue, plain returns the
// text untouched. Spaces get no escape, and stripping the escapes always gives back `text`.
const RAINBOW_ANSI16 = Object.freeze([91, 93, 92, 96, 94, 95]);

const hueToRgb = (hue) => {
  // HSV with a softened saturation so every hue stays legible on a dark terminal.
  const h = ((hue % 360) + 360) % 360 / 60;
  const s = 0.65;
  const x = 1 - Math.abs((h % 2) - 1);
  const [r, g, b] = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][Math.floor(h) % 6];
  return [r, g, b].map((channel) => Math.round(255 * (1 - s + s * channel)));
};

export const rainbowText = (text, { depth = "plain", phase = 0 } = {}) => {
  if (!["truecolor", "256", "16"].includes(depth)) return text;
  const chars = [...text];
  const step = chars.length > 1 ? Math.min(60, 300 / (chars.length - 1)) : 0;
  const painted = chars.map((char, index) => {
    if (char === " ") return char;
    const hue = (((phase + index * step) % 360) + 360) % 360;
    if (depth === "16") return `\x1b[${RAINBOW_ANSI16[Math.floor(((hue + 30) % 360) / 60)]}m${char}`;
    const [r, g, b] = hueToRgb(hue);
    if (depth === "256") {
      const cube = (value) => Math.round((value / 255) * 5);
      return `\x1b[38;5;${16 + 36 * cube(r) + 6 * cube(g) + cube(b)}m${char}`;
    }
    return `\x1b[38;2;${r};${g};${b}m${char}`;
  });
  return `\x1b[1m${painted.join("")}\x1b[0m`;
};

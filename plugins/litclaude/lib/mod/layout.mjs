// Terminal cell arithmetic for the LIT band. The band is laid out by LitClaude itself rather than
// left to wrap, so every width here is in terminal cells: Hangul, CJK and emoji take two, combining
// marks and variation selectors none. Pure functions only; the mod runs them inside Claude Code and
// the tests run them under Node.

const ZERO_WIDTH = /[\p{Mn}\p{Me}​-‏︀-️]/u;
const EMOJI = /\p{Emoji_Presentation}/u;

const isWide = (code) =>
  (code >= 0x1100 && code <= 0x115f)
  || (code >= 0x2e80 && code <= 0x303e)
  || (code >= 0x3041 && code <= 0x33ff)
  || (code >= 0x3400 && code <= 0x4dbf)
  || (code >= 0x4e00 && code <= 0x9fff)
  || (code >= 0xa000 && code <= 0xa4cf)
  || (code >= 0xa960 && code <= 0xa97f)
  || (code >= 0xac00 && code <= 0xd7a3)
  || (code >= 0xf900 && code <= 0xfaff)
  || (code >= 0xfe30 && code <= 0xfe4f)
  || (code >= 0xff00 && code <= 0xff60)
  || (code >= 0xffe0 && code <= 0xffe6)
  || (code >= 0x20000 && code <= 0x3fffd);

export const charWidth = (ch) => {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return 0;
  if (ZERO_WIDTH.test(ch)) return 0;
  if (EMOJI.test(ch) || isWide(code)) return 2;
  return 1;
};

export const textWidth = (text) => {
  let width = 0;
  for (const ch of String(text)) width += charWidth(ch);
  return width;
};

export const truncateToWidth = (text, cells, ellipsis = "…") => {
  const value = String(text);
  if (cells <= 0) return "";
  if (textWidth(value) <= cells) return value;
  const room = cells - textWidth(ellipsis);
  if (room <= 0) return ellipsis.slice(0, cells);
  let out = "";
  let width = 0;
  for (const ch of value) {
    const w = charWidth(ch);
    if (width + w > room) break;
    out += ch;
    width += w;
  }
  return `${out.trimEnd()}${ellipsis}`;
};

// Segments arrive in display order with a priority (lower numbers outlast higher ones) and an
// optional `minWidth`, which marks the one flexible segment (the next task) that may shrink. Fitting
// drops the highest priority numbers until the row fits with that segment at its minimum, then lets
// it grow back into whatever room is left. Returns the kept segments, in display order, with widths.
export const fitSegments = (segments, columns, gap = 1) => {
  let kept = segments.map((segment) => ({ ...segment, natural: segment.width }));
  const isFlexible = (segment) => Number.isFinite(segment.minWidth);
  const total = () => kept.reduce((sum, segment) => sum + (isFlexible(segment) ? Math.min(segment.minWidth, segment.natural) : segment.width), 0)
    + Math.max(0, kept.length - 1) * gap;
  while (kept.length > 0 && total() > columns) {
    const worst = kept.reduce((a, b) => (b.priority >= a.priority ? b : a));
    kept = kept.filter((segment) => segment !== worst);
  }
  let spare = columns - total();
  return kept.map(({ natural, ...segment }) => {
    if (!isFlexible(segment)) return segment;
    const base = Math.min(segment.minWidth, natural);
    const width = Math.min(natural, base + spare);
    spare -= width - base;
    return { ...segment, width };
  });
};

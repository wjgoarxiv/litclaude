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

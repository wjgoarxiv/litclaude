// Progress gauges for the lit-adhd brief (plans/lit-adhd.md D9). Code draws them so the model
// copies them and never invents its own: `[▉▉▉░░] 3/5`, one cell per item up to ten, scaled to ten
// cells above that, and `[???] k/?` when the total is not recorded.

const MAX_CELLS = 10;
const known = (value) => Number.isInteger(value) && value >= 0;

/** `[▉▉▉░░] 3/5`; an unknown total reads `[???] k/?`, an unknown count `[???] ?/?`. */
export const gauge = (done, total) => {
  if (!known(total)) return `[???] ${known(done) ? done : "?"}/?`;
  const k = known(done) ? Math.min(done, total) : 0;
  const cells = Math.min(total, MAX_CELLS);
  let filled = k;
  if (total > MAX_CELLS) filled = k === total ? MAX_CELLS : k === 0 ? 0 : Math.min(MAX_CELLS - 1, Math.max(1, Math.floor((k * MAX_CELLS) / total)));
  return `[${"▉".repeat(filled)}${"░".repeat(cells - filled)}] ${k}/${total}`;
};

/** `{done, total, gauge, remaining}` with `remaining` as recorded, or `["unknown"]`. */
export const progressOf = (done, total, remaining) => ({
  done: known(done) ? done : null,
  total: known(total) ? total : null,
  gauge: gauge(done, total),
  remaining: Array.isArray(remaining) && remaining.length ? remaining : known(total) && known(done) && done >= total ? [] : ["unknown"],
});

/** One gauge over several: the sum of known totals, or `[???] k/?` when any total is unknown. */
export const aggregateProgress = (items) => {
  const done = items.reduce((sum, item) => sum + (known(item.done) ? item.done : 0), 0);
  const total = items.every((item) => known(item.total)) ? items.reduce((sum, item) => sum + item.total, 0) : null;
  return { done, total, gauge: gauge(done, total) };
};

// Terminal columns a character takes: combining marks and Hangul medial/final jamo take none, East
// Asian wide and fullwidth characters and most emoji take two.
const charWidth = (codePoint) => {
  if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if (/\p{Mn}|\p{Me}|\p{Cf}/u.test(String.fromCodePoint(codePoint)) || (codePoint >= 0x1160 && codePoint <= 0x11ff)) return 0;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f)
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe4f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  ) return 2;
  return 1;
};

export const displayWidth = (text) => [...String(text)].reduce((sum, ch) => sum + charWidth(ch.codePointAt(0)), 0);

/** Clips to `width` display columns, ending in `…` when anything was cut. */
export const clipToWidth = (text, width) => {
  const value = String(text);
  if (displayWidth(value) <= width) return value;
  let out = "";
  let used = 0;
  for (const ch of value) {
    const w = charWidth(ch.codePointAt(0));
    if (used + w > width - 1) break;
    out += ch;
    used += w;
  }
  return `${out}…`;
};

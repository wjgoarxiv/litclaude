/** Return source lines that are outside Markdown code fences, preserving line indexes. */
export const planLinesOutsideFences = (text) => {
  const visible = [];
  let fence = null;
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (!fence && fenceMatch) {
      fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
      continue;
    }
    if (
      fence
      && fenceMatch
      && fenceMatch[1][0] === fence.marker
      && fenceMatch[1].length >= fence.length
      && fenceMatch[2].trim() === ""
    ) {
      fence = null;
      continue;
    }
    if (!fence) visible.push({ line, index });
  }
  return visible;
};

// A task waits on the user when its line holds `BLOCKED:` outside inline code, or an indented body
// line under it starts with `BLOCKED:`. A mention such as `BLOCKED:` in backticks is not a marker.
const blockedLine = (line) => /\bBLOCKED:/u.test(line.replace(/`[^`]*`/gu, ""));
const blockedBodyLine = (line) => /^[ \t]+(?:[-*][ \t]+)?BLOCKED:/u.test(line);

/** Parse the exact column-zero checkbox grammar consumed by start-work. */
export const parsePlanTaskRows = (text) => {
  const visible = planLinesOutsideFences(text);
  return visible.flatMap(({ line, index }, at) => {
    const match = /^- \[([ xX])\]\s+(.+?)\s*$/u.exec(line);
    if (!match) return [];
    let blocked = blockedLine(match[2]);
    for (let next = at + 1; !blocked && next < visible.length && /^(?:[ \t]|$)/u.test(visible[next].line); next += 1) {
      blocked = blockedBodyLine(visible[next].line);
    }
    return [{ checked: match[1].toLowerCase() === "x", text: match[2], line, index, ...(blocked ? { blocked } : {}) }];
  });
};

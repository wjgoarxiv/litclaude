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

/** Parse the exact column-zero checkbox grammar consumed by start-work. */
export const parsePlanTaskRows = (text) => planLinesOutsideFences(text).flatMap(({ line, index }) => {
  const match = /^- \[([ xX])\]\s+(.+?)\s*$/u.exec(line);
  return match ? [{ checked: match[1].toLowerCase() === "x", text: match[2], line, index }] : [];
});

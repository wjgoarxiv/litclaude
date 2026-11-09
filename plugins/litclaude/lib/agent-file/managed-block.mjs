// A LitFamily block inside a user-owned instruction file (CLAUDE.md, AGENTS.md): the lines between
// `<!-- litfamily:<id>:start v=<version> … -->` and `<!-- litfamily:<id>:end -->`. Only those lines are
// ever written; the user's text before and after them stays byte for byte. The start marker records
// what was added in front of the block (`pre=`, hex) and whether the file was created for it (`new=1`),
// so removing the block takes back exactly that and an add-then-remove returns the original bytes,
// whatever the file's line endings. A start without its end, or two of either, is malformed: it is
// reported and refused, never guessed at.

export class ManagedBlockError extends Error {}

const startPrefix = (id) => `<!-- litfamily:${id}:start`;
const endMarker = (id) => `<!-- litfamily:${id}:end -->`;
const eolOf = (text) => (text.includes("\r\n") ? "\r\n" : "\n");
const START_LINE = /^<!-- litfamily:[^:\s]+:start v=(\S+)((?: [a-z]+=[0-9a-f]*)*) -->/u;

const occurrences = (text, needle) => {
  const found = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) found.push(at);
  return found;
};

// The block's span `[start, end)`, end just past the end marker, and its recorded attributes; or null.
const locate = (text, id) => {
  const starts = occurrences(text, startPrefix(id));
  const ends = occurrences(text, endMarker(id));
  if (starts.length === 0 && ends.length === 0) return null;
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
    throw new ManagedBlockError(`malformed LitFamily ${id} block: expected one start and one end marker`);
  }
  const head = START_LINE.exec(text.slice(starts[0]));
  if (!head) throw new ManagedBlockError(`malformed LitFamily ${id} block: unreadable start marker`);
  const attrs = Object.fromEntries(head[2].trim().split(" ").filter(Boolean).map((pair) => pair.split("=")));
  return {
    start: starts[0],
    end: ends[0] + endMarker(id).length,
    version: head[1],
    pre: attrs.pre ? Buffer.from(attrs.pre, "hex").toString("utf8") : "",
    created: attrs.new === "1",
  };
};

const render = ({ id, version, body }, eol, { pre, created }) => [
  `${startPrefix(id)} v=${version}${pre ? ` pre=${Buffer.from(pre, "utf8").toString("hex")}` : ""}${created ? " new=1" : ""} -->`,
  ...String(body).replace(/\r?\n$/u, "").split(/\r?\n/u),
  endMarker(id),
].join(eol);

/** `{state: "absent" | "present" | "malformed", version, created}` for block `id` in `text`. */
export const inspectBlock = (text, id) => {
  let span;
  try {
    span = locate(text, id);
  } catch {
    return { state: "malformed", version: null, created: false };
  }
  return span ? { state: "present", version: span.version, created: span.created } : { state: "absent", version: null, created: false };
};

/** Adds or replaces block `id`; `created` marks a file made for the block. Returns `{text, changed}`. */
export const upsertBlock = (text, block, { created = false } = {}) => {
  const eol = eolOf(text);
  const span = locate(text, block.id);
  if (span) {
    const rendered = render(block, eol, span);
    const next = `${text.slice(0, span.start)}${rendered}${text.slice(span.end)}`;
    return { text: next, changed: next !== text };
  }
  const pre = text === "" ? "" : `${text.endsWith("\n") ? "" : eol}${eol}`;
  return { text: `${text}${pre}${render(block, eol, { pre, created })}${eol}`, changed: true };
};

/** Removes block `id`, the line ending after it and what was added before it; `created` is from its marker. */
export const removeBlock = (text, id) => {
  const span = locate(text, id);
  if (!span) return { text, changed: false, created: false };
  let before = text.slice(0, span.start);
  let after = text.slice(span.end);
  const eol = after.startsWith("\r\n") ? "\r\n" : after.startsWith("\n") ? "\n" : "";
  after = after.slice(eol.length);
  if (span.pre && before.endsWith(span.pre)) before = before.slice(0, -span.pre.length);
  return { text: `${before}${after}`, changed: true, created: span.created };
};

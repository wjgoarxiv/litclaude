// Extract the comment lines an edit ADDED, so Skill(comment-checker) judges real text
// instead of being told "go look at the comments".
//
// This is deliberately an EXTRACTOR, not a classifier. It decides which lines are
// comments and which of those are new; it never decides whether a comment is bad. That
// judgment is the policy skill's job, and encoding it here as regex heuristics is how
// you get confident wrong answers about prose.

import { extname } from "node:path";

const MAX_REPORTED_LINES = 20;
const MAX_SCANNED_CHARS = 200_000;

// Line-comment markers by extension. Block comments are handled separately.
const LINE_COMMENT_MARKERS = new Map([
  ["//", [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h", ".cc", ".cpp", ".cs", ".dart", ".zig", ".scala", ".php"]],
  ["#", [".py", ".rb", ".sh", ".bash", ".zsh", ".yaml", ".yml", ".toml", ".ex", ".exs", ".jl", ".r", ".pl", ".tf"]],
  ["--", [".sql", ".lua", ".hs", ".elm", ".adb", ".ads"]],
]);

const markersFor = (filePath) => {
  const extension = extname(filePath).toLowerCase();
  const markers = [];
  for (const [marker, extensions] of LINE_COMMENT_MARKERS) {
    if (extensions.includes(extension)) markers.push(marker);
  }
  return markers;
};

const BLOCK_OPENERS = [
  { open: "/*", close: "*/" },
  { open: "<!--", close: "-->" },
  { open: '"""', close: '"""' },
];

/**
 * True when `line` is, ON ITS OWN, a comment line for this file type.
 *
 * SCOPE LIMIT: whole-line comments only. A trailing comment (`const x = 1; // set x`)
 * is NOT detected, because finding one without a real parser means guessing about
 * `"https://example.com"`, regex literals like `/a#b/`, and `#` inside string
 * literals — and a false positive here sends the policy skill after code that is not
 * a comment. Callers MUST state this limit rather than implying the list is complete.
 */
const isCommentLine = (line, markers) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (markers.some((marker) => trimmed.startsWith(marker))) return true;
  if (BLOCK_OPENERS.some(({ open }) => trimmed.startsWith(open))) return true;
  // A continuation line inside a block comment, e.g. " * keeps the docblock going".
  if (/^\*\s/u.test(trimmed) || trimmed === "*/") return true;
  return false;
};

const splitLines = (text) => String(text ?? "").split(/\r?\n/u);

/** Lines present in `next` that were not present in `previous`, order preserved. */
const addedLines = (previous, next) => {
  const before = new Set(splitLines(previous).map((line) => line.trim()));
  return splitLines(next).filter((line) => !before.has(line.trim()));
};

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const pathOf = (toolInput) =>
  [toolInput.file_path, toolInput.filePath, toolInput.path].find((value) => typeof value === "string" && value.length > 0) ?? "";

/**
 * Candidate added lines per tool shape. Returns raw lines; comment filtering happens after,
 * so a tool shape we do not recognize contributes nothing rather than guessing.
 */
const candidateLines = (toolName, toolInput) => {
  if (toolName === "write") return splitLines(toolInput.content ?? toolInput.contents);
  if (toolName === "edit") return addedLines(toolInput.old_string ?? toolInput.oldString, toolInput.new_string ?? toolInput.newString);

  if (toolName === "multiedit" || toolName === "multi_edit") {
    const edits = Array.isArray(toolInput.edits) ? toolInput.edits : [];
    return edits.flatMap((edit) =>
      isRecord(edit) ? addedLines(edit.old_string ?? edit.oldString, edit.new_string ?? edit.newString) : [],
    );
  }

  if (toolName === "apply_patch") {
    const patch = [toolInput.input, toolInput.patch, toolInput.command].find((value) => typeof value === "string") ?? "";
    return splitLines(patch)
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1));
  }

  return [];
};

/**
 * Extract the WHOLE-LINE comments this edit added.
 *
 * Returns `{ path, lines, truncated }` — `truncated` is true when the scan stopped at a
 * cap and the list is therefore a prefix, not the whole set. Returns null when the edit
 * added no whole-line comments, in which case the caller stays silent.
 *
 * The result is deliberately incomplete in two known ways, and both are reportable:
 * trailing comments are never scanned (see isCommentLine), and the list is capped.
 */
export const extractAddedCommentLines = (input) => {
  const toolName = typeof input?.tool_name === "string" ? input.tool_name.toLowerCase() : "";
  if (!isRecord(input?.tool_input)) return null;
  const toolInput = input.tool_input;

  const filePath = pathOf(toolInput);
  if (filePath.length === 0) return null;

  const markers = markersFor(filePath);
  if (markers.length === 0) return null;

  const candidates = candidateLines(toolName, toolInput);
  if (candidates.length === 0) return null;

  let scanned = 0;
  const lines = [];
  let truncated = false;
  for (const line of candidates) {
    scanned += line.length;
    if (scanned > MAX_SCANNED_CHARS) {
      truncated = true;
      break;
    }
    if (!isCommentLine(line, markers)) continue;
    lines.push(line.trim());
    if (lines.length >= MAX_REPORTED_LINES) {
      truncated = true;
      break;
    }
  }

  return lines.length === 0 ? null : { path: filePath, lines, truncated };
};

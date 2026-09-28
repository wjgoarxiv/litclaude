// Hand-rolled parser for the rule-frontmatter subset: description, alwaysApply, and
// globs (with the `paths` / `applyTo` aliases). Not a YAML implementation — LitClaude
// ships zero runtime dependencies, and a rule file that uses YAML beyond this subset
// degrades to "no frontmatter" with a diagnostic rather than failing the hook.

const BOM = "﻿";

const stripBom = (text) => (text.startsWith(BOM) ? text.slice(1) : text);

/** Strip a trailing `# comment`, honoring quotes. */
const stripComment = (line) => {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' || character === "'") {
      if (quote === null) quote = character;
      else if (quote === character) quote = null;
      continue;
    }
    if (quote === null && character === "#") return line.slice(0, index);
  }
  return line;
};

const unquote = (value) => {
  if (value.length === 0) return "";
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1);
  return value;
};

const isQuoted = (value) => value.startsWith('"') || value.startsWith("'");

const splitInlineArray = (value) => {
  const inner = value.slice(1, value.lastIndexOf("]"));
  const parts = [];
  let current = "";
  let quote = null;
  for (const character of inner) {
    if (character === '"' || character === "'") {
      if (quote === null) quote = character;
      else if (quote === character) quote = null;
      current += character;
      continue;
    }
    if (quote === null && character === ",") {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current.trim());
  return parts.map(unquote).filter(Boolean);
};

/** Parse a glob value; returns { values, consumed } where consumed counts lines. */
const parseGlobValue = (rawValue, lines, lineIndex) => {
  if (rawValue.startsWith("[")) {
    if (!rawValue.includes("]")) return { values: [], consumed: 1, diagnostic: "Unclosed inline array" };
    return { values: splitInlineArray(rawValue), consumed: 1 };
  }

  if (rawValue.length === 0) {
    const values = [];
    let consumed = 1;
    for (let index = lineIndex + 1; index < lines.length; index += 1) {
      const line = stripComment(lines[index] ?? "");
      if (line.trim().length === 0) {
        consumed += 1;
        continue;
      }
      const item = /^\s+-\s*(.*)$/u.exec(line);
      if (item === null) break;
      values.push(unquote((item[1] ?? "").trim()));
      consumed += 1;
    }
    return { values: values.filter(Boolean), consumed };
  }

  const quoted = isQuoted(rawValue);
  const value = unquote(rawValue);
  // An unquoted comma list is a comma list; a quoted one is a single glob.
  if (!quoted && value.includes(",")) {
    return { values: value.split(",").map((item) => item.trim()).filter(Boolean), consumed: 1 };
  }
  return { values: value.length > 0 ? [value] : [], consumed: 1 };
};

const parseFrontmatterBlock = (yamlText) => {
  const lines = yamlText.replace(/\r\n/gu, "\n").split("\n");
  const frontmatter = {};
  const globs = [];
  const seen = new Set();
  let diagnostic;
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = stripComment(lines[lineIndex] ?? "").trim();
    if (line.length === 0) {
      lineIndex += 1;
      continue;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) {
      // Not a key: value pair. Record it once and keep going — a single odd line
      // must not discard the rest of an otherwise usable rule.
      diagnostic ??= `Unparsed frontmatter line ${lineIndex + 1}`;
      lineIndex += 1;
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    const rawValue = line.slice(colonIndex + 1).trim();

    if (key === "description") {
      frontmatter.description = unquote(rawValue);
      lineIndex += 1;
      continue;
    }

    if (key === "alwaysApply") {
      if (rawValue === "true") frontmatter.alwaysApply = true;
      else if (rawValue === "false") frontmatter.alwaysApply = false;
      else diagnostic ??= `Expected boolean for alwaysApply on line ${lineIndex + 1}`;
      lineIndex += 1;
      continue;
    }

    if (key === "globs" || key === "paths" || key === "applyTo") {
      const parsed = parseGlobValue(rawValue, lines, lineIndex);
      if (parsed.diagnostic !== undefined) diagnostic ??= parsed.diagnostic;
      for (const glob of parsed.values) {
        if (seen.has(glob)) continue;
        seen.add(glob);
        globs.push(glob);
      }
      lineIndex += parsed.consumed;
      continue;
    }

    lineIndex += 1;
  }

  if (globs.length > 0) frontmatter.globs = globs;
  return { frontmatter, diagnostic };
};

/**
 * Parse a rule file into { frontmatter, body, diagnostic }.
 * Never throws: malformed input degrades to a body-only rule.
 */
export const parseRuleFile = (content) => {
  const text = stripBom(typeof content === "string" ? content : "");
  const opening = /^---[ \t]*\r?\n/u.exec(text);
  if (opening === null) return { frontmatter: {}, body: text };

  const rest = text.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r?\n|$)/mu.exec(rest);
  if (closing === null) {
    return { frontmatter: {}, body: text, diagnostic: "Missing closing frontmatter delimiter" };
  }

  const yamlText = rest.slice(0, closing.index);
  const body = rest.slice(closing.index + closing[0].length);
  try {
    const parsed = parseFrontmatterBlock(yamlText);
    return { frontmatter: parsed.frontmatter, body, ...(parsed.diagnostic ? { diagnostic: parsed.diagnostic } : {}) };
  } catch (error) {
    return {
      frontmatter: {},
      body: text,
      diagnostic: `Malformed frontmatter: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }
};

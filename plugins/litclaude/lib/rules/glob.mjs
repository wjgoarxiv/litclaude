// Hand-rolled glob matcher for the LitClaude rules engine.
//
// WHY THIS EXISTS: LitClaude ships zero runtime dependencies. Vendoring picomatch
// (~1,100 lines) to match `.cursor/rules` globs would make it the first one and change
// a packaging convention that scripts/validate-plugin.mjs, tools/check-pack-payload.mjs
// and the installer all rely on. So this implements the subset that rule frontmatter
// actually uses: `**`, `*`, `?`, `{a,b}`, and a leading `!`.
//
// It DOES NOT reimplement picomatch. The divergences are deliberate, enumerated in
// docs/rules.md, and pinned one-by-one in test/rules-glob.test.mjs under
// "pinned divergences". Read those before changing anything here: a silent change to
// this file silently changes which rules reach the model.

const MAX_BRACE_EXPANSIONS = 256;
const MAX_PATTERN_LENGTH = 4096;

const REGEX_METACHARACTERS = new Set([".", "+", "^", "$", "(", ")", "|", "[", "]", "{", "}", "\\"]);

/** Backslash is treated as a path separator, never as an escape (divergence D6). */
const normalizeSeparators = (value) => String(value ?? "").replaceAll("\\", "/").replace(/\/{2,}/gu, "/");

const stripLeadingDotSlash = (value) => (value.startsWith("./") ? value.slice(2) : value);

export const normalizeGlobPattern = (pattern) => stripLeadingDotSlash(normalizeSeparators(pattern));

export const normalizeGlobPath = (path) => stripLeadingDotSlash(normalizeSeparators(path)).replace(/^\/+/u, "");

const escapeLiteral = (character) => (REGEX_METACHARACTERS.has(character) ? `\\${character}` : character);

/** Locate the next balanced `{...}` group at or after `from`. Returns null when there is none. */
const findBraceGroup = (pattern, from) => {
  for (let index = from; index < pattern.length; index += 1) {
    if (pattern[index] !== "{") continue;
    let depth = 0;
    for (let scan = index; scan < pattern.length; scan += 1) {
      if (pattern[scan] === "{") depth += 1;
      else if (pattern[scan] === "}") {
        depth -= 1;
        if (depth === 0) return { start: index, end: scan };
      }
    }
    // Unbalanced `{` — leave it literal rather than throwing on hostile text.
    return null;
  }
  return null;
};

const splitTopLevelCommas = (value) => {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const character of value) {
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
};

const expandFrom = (pattern, from, out) => {
  if (out.length >= MAX_BRACE_EXPANSIONS) return;
  const group = findBraceGroup(pattern, from);
  if (group === null) {
    out.push(pattern);
    return;
  }

  const alternatives = splitTopLevelCommas(pattern.slice(group.start + 1, group.end));
  // `{a}` and `{}` carry no alternation, so bash leaves them literal — so do we (D5).
  if (alternatives.length < 2) {
    expandFrom(pattern, group.end + 1, out);
    return;
  }

  for (const alternative of alternatives) {
    if (out.length >= MAX_BRACE_EXPANSIONS) return;
    const next = `${pattern.slice(0, group.start)}${alternative}${pattern.slice(group.end + 1)}`;
    // Re-scan from the same offset so a nested group inside `alternative` still expands.
    expandFrom(next, group.start, out);
  }
};

/** Expand `{a,b}` alternation into concrete patterns. Always returns at least one entry. */
export const expandBraces = (pattern) => {
  const normalized = normalizeGlobPattern(pattern);
  const out = [];
  expandFrom(normalized, 0, out);
  return out.length === 0 ? [normalized] : out;
};

/** Compile one path segment. `*` and `**`-inside-a-segment both stop at a separator (D8). */
const segmentSource = (segment) => {
  let source = "";
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (character === "*") {
      while (segment[index + 1] === "*") index += 1;
      source += "[^/]*";
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeLiteral(character);
  }
  return source;
};

/** Build the anchored regex source for one brace-free pattern. */
export const globRegexSource = (pattern) => {
  const segments = normalizeGlobPattern(pattern).split("/");
  let source = "";
  for (let index = 0; index < segments.length; index += 1) {
    const isLast = index === segments.length - 1;
    if (segments[index] === "**") {
      // Trailing `/**` requires at least one segment below (D7); a middle `**` may span zero.
      source += isLast ? "[^/]+(?:/[^/]+)*" : "(?:[^/]+/)*";
      continue;
    }
    source += segmentSource(segments[index]);
    if (!isLast) source += "/";
  }
  return `^${source}$`;
};

const matcherCache = new Map();

/** Compile a pattern into a reusable `(path) => boolean` predicate. */
export const createGlobMatcher = (pattern) => {
  const key = normalizeGlobPattern(pattern);
  const cached = matcherCache.get(key);
  if (cached !== undefined) return cached;

  let matcher;
  if (key.length === 0 || key.length > MAX_PATTERN_LENGTH) {
    // An empty or absurd pattern matches nothing rather than throwing or matching all.
    matcher = () => false;
  } else {
    const expressions = [];
    for (const expanded of expandBraces(key)) {
      try {
        expressions.push(new RegExp(globRegexSource(expanded), "u"));
      } catch {
        // A pattern that cannot compile contributes no matches instead of failing the hook.
      }
    }
    matcher = (path) => {
      const candidate = normalizeGlobPath(path);
      if (candidate.length === 0) return false;
      return expressions.some((expression) => expression.test(candidate));
    };
  }

  matcherCache.set(key, matcher);
  return matcher;
};

export const matchGlob = (pattern, path) => createGlobMatcher(pattern)(path);

// Decide whether one rule applies to one target path.
//
// Precedence, matching the dialect .cursor/rules is written in:
//   1. a single-file rule (CONTEXT.md, copilot-instructions.md) always applies;
//   2. alwaysApply: true always applies;
//   3. otherwise the rule needs a glob, and a leading `!` pattern vetoes a match.
// A rule with only a `description` and no globs is agent-requested: it is never
// auto-injected, it is named so the model can choose to open it.

import { createGlobMatcher, normalizeGlobPattern } from "./glob.mjs";

const asList = (value) => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

export const normalizeRuleGlobs = (frontmatter) => {
  const patterns = [
    ...asList(frontmatter?.globs),
    ...asList(frontmatter?.paths),
    ...asList(frontmatter?.applyTo),
  ]
    .filter((pattern) => typeof pattern === "string" && pattern.length > 0)
    .map(normalizeGlobPattern);
  return [...new Set(patterns)];
};

const compiledCache = new Map();

const compilePatternSet = (patterns) => {
  const key = JSON.stringify(patterns);
  const cached = compiledCache.get(key);
  if (cached !== undefined) return cached;

  const positive = [];
  const negative = [];
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      const body = pattern.slice(1);
      if (body.length > 0) negative.push(createGlobMatcher(body));
      continue;
    }
    positive.push({ pattern, isMatch: createGlobMatcher(pattern) });
  }

  const compiled = { positive, negative };
  compiledCache.set(key, compiled);
  return compiled;
};

const pathBaseList = (pathBases) => {
  const bases = [pathBases?.projectRelative, pathBases?.scopeRelative, pathBases?.basename];
  return bases.filter((base) => typeof base === "string" && base.length > 0);
};

const noMatch = () => ({ matched: false, reason: { kind: "no-match" } });

export const matchRule = ({ frontmatter = {}, isSingleFile = false, pathBases = {} }) => {
  if (isSingleFile) return { matched: true, reason: { kind: "single-file" } };
  if (frontmatter.alwaysApply === true) return { matched: true, reason: { kind: "alwaysApply" } };

  const patterns = normalizeRuleGlobs(frontmatter);
  if (patterns.length === 0) return noMatch();

  const { positive, negative } = compilePatternSet(patterns);
  if (positive.length === 0) return noMatch();

  const bases = pathBaseList(pathBases);
  for (const { pattern, isMatch } of positive) {
    for (const base of bases) {
      if (!isMatch(base)) continue;
      // A negative pattern vetoes the whole rule for this path, matching the donor.
      if (negative.some((isExcluded) => isExcluded(base))) return noMatch();
      return { matched: true, reason: { kind: "glob", pattern } };
    }
  }

  return noMatch();
};

/** True when a rule participates in the static (always-on) lane. */
export const isStaticRule = (candidate) =>
  candidate.isSingleFile === true || candidate.frontmatter?.alwaysApply === true;

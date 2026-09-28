// Top level of the rules engine: two injection lanes over one discovery pass.
//
//   staticRulesBlock  — SessionStart / UserPromptSubmit. Carries single-file rules and
//                       `alwaysApply: true` rules. Glob-scoped rules are NOT here;
//                       injecting them unconditionally is what makes rule text noise.
//   dynamicRulesBlock — PostToolUse, keyed on the paths an edit actually touched.
//                       Carries glob-scoped rules whose pattern matched one of them.
//
// A rule carrying only a `description` and no globs is agent-requested: never
// auto-injected by either lane. That is the dialect .cursor/rules is written in.
//
// Neither lane throws. Any failure returns "" and the session proceeds without rules.

import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  DEFAULT_DYNAMIC_MAX_RESULT_CHARS,
  DEFAULT_DYNAMIC_MAX_RULE_CHARS,
  DEFAULT_MAX_RULE_CHARS,
  DEFAULT_STATIC_MAX_RESULT_CHARS,
} from "./constants.mjs";
import { findProjectRoot, findRuleCandidates, pathBasesForTarget, toRelativePath } from "./discovery.mjs";
import { dedupeByBody, formatDynamicBlock, formatStaticBlock } from "./format.mjs";
import { parseRuleFile } from "./frontmatter.mjs";
import { isStaticRule, matchRule } from "./matcher.mjs";
import { sortCandidates } from "./ordering.mjs";
import { claimInjectedKeys, ruleKey } from "./session-state.mjs";
import { pathIdentity, samePathIdentity } from "../secure-path-read.mjs";

const MAX_RULE_FILE_BYTES = 256 * 1024;

const hashBody = (body) => createHash("sha256").update(body).digest("hex").slice(0, 16);

const isSameOrChildPath = (parentPath, childPath) => {
  const rel = relative(parentPath, childPath);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

const readCandidateBounded = (candidate) => {
  let fd;
  try {
    const pathStats = lstatSync(candidate.path);
    if (pathStats.isSymbolicLink() || !pathStats.isFile()) return null;
    const realPath = realpathSync.native(candidate.path);
    if (realPath !== candidate.realPath || !isSameOrChildPath(candidate.containmentRoot, realPath)) return null;

    fd = openSync(candidate.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedStats = fstatSync(fd);
    if (
      !openedStats.isFile()
      || !samePathIdentity(pathIdentity(openedStats), pathIdentity(pathStats))
      || openedStats.size !== pathStats.size
    ) return null;

    const buffer = Buffer.alloc(Math.min(MAX_RULE_FILE_BYTES, openedStats.size));
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    return buffer.subarray(0, offset).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

/** Read + parse one candidate. Returns null when the file is unusable. */
const loadCandidate = (candidate) => {
  const content = readCandidateBounded(candidate);
  if (content === null) return null;

  const parsed = parseRuleFile(content);
  const body = parsed.body.trim();
  if (body.length === 0) return null;

  return { ...candidate, frontmatter: parsed.frontmatter, body, bodyHash: hashBody(body) };
};

const loadCandidates = (candidates) => {
  const loaded = [];
  for (const candidate of sortCandidates(candidates)) {
    const rule = loadCandidate(candidate);
    if (rule !== null) loaded.push(rule);
  }
  return loaded;
};

const resolveProjectRoot = (cwd) => {
  try {
    return findProjectRoot(resolve(cwd));
  } catch {
    return null;
  }
};

const claimFormattedBlock = ({ rules, format, projectRoot, sessionId }) => {
  if (projectRoot === null || sessionId === undefined) return format(rules).text;
  let remaining = rules;
  while (remaining.length > 0) {
    const formatted = format(remaining);
    if (formatted.text.length === 0 || formatted.emittedRules.length === 0) return "";
    const attempted = new Set(formatted.emittedRules.map(ruleKey));
    const claim = claimInjectedKeys(projectRoot, sessionId, [...attempted]);
    if (!claim.persisted) return "";
    if (claim.claimed.length > 0) {
      const claimed = new Set(claim.claimed);
      return format(formatted.emittedRules.filter((rule) => claimed.has(ruleKey(rule)))).text;
    }
    remaining = remaining.filter((rule) => !attempted.has(ruleKey(rule)));
  }
  return "";
};

/**
 * Static lane. Returns "" when nothing applies.
 * `pluginRoot: null` disables bundled rules (used by tests to isolate the project).
 */
export const staticRulesBlock = ({
  cwd,
  homeDir,
  pluginRoot,
  skipUserHome = false,
  maxRuleChars = DEFAULT_MAX_RULE_CHARS,
  maxResultChars = DEFAULT_STATIC_MAX_RESULT_CHARS,
  sessionId,
  platform,
} = {}) => {
  try {
    const projectRoot = resolveProjectRoot(cwd ?? process.cwd());
    const candidates = findRuleCandidates({ projectRoot, targetFile: null, homeDir, pluginRoot, skipUserHome, platform });
    const rules = loadCandidates(candidates).filter(isStaticRule);
    if (rules.length === 0) return "";

    const unique = dedupeByBody(rules);
    return claimFormattedBlock({
      rules: unique,
      format: (selected) => formatStaticBlock(selected, { maxRuleChars, maxResultChars }),
      projectRoot,
      sessionId,
    });
  } catch {
    return "";
  }
};

/**
 * Dynamic lane. `filePaths` are the paths an edit actually mutated, as reported by
 * lib/mutated-file-paths.mjs. Returns "" when no rule matches any of them.
 */
export const dynamicRulesBlock = ({
  cwd,
  filePaths,
  homeDir,
  pluginRoot,
  skipUserHome = false,
  maxRuleChars = DEFAULT_DYNAMIC_MAX_RULE_CHARS,
  maxResultChars = DEFAULT_DYNAMIC_MAX_RESULT_CHARS,
  sessionId,
  platform,
} = {}) => {
  try {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return "";
    const workingDirectory = resolve(cwd ?? process.cwd());
    const projectRoot = resolveProjectRoot(workingDirectory);

    const matchedRules = [];
    const matchedKeys = new Set();
    let describedTarget = "";

    for (const rawPath of filePaths) {
      const targetFile = resolve(workingDirectory, rawPath);
      const candidates = findRuleCandidates({ projectRoot, targetFile, homeDir, pluginRoot, skipUserHome, platform });

      for (const rule of loadCandidates(candidates)) {
        // The static lane already carries these; repeating them is pure noise.
        if (isStaticRule(rule)) continue;

        const result = matchRule({
          frontmatter: rule.frontmatter,
          isSingleFile: rule.isSingleFile,
          pathBases: pathBasesForTarget(projectRoot, targetFile, rule),
        });
        if (!result.matched) continue;

        const key = ruleKey(rule);
        if (matchedKeys.has(key)) continue;
        matchedKeys.add(key);
        matchedRules.push({ ...rule, matchReason: result.reason });
      }

      if (describedTarget.length === 0 && matchedRules.length > 0) {
        describedTarget = projectRoot === null ? rawPath : toRelativePath(projectRoot, targetFile);
      }
    }

    if (matchedRules.length === 0) return "";

    const unique = dedupeByBody(matchedRules);
    return claimFormattedBlock({
      rules: unique,
      format: (selected) => formatDynamicBlock(selected, describedTarget, { maxRuleChars, maxResultChars }),
      projectRoot,
      sessionId,
    });
  } catch {
    return "";
  }
};

export { findProjectRoot } from "./discovery.mjs";

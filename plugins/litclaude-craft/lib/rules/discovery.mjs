// Find the project root, then collect every rule candidate that could apply, with the
// directory distance that decides ordering.

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  BUNDLED_RULE_SUBDIR,
  GLOBAL_DISTANCE,
  PROJECT_MARKERS,
  PROJECT_RULE_SUBDIRS,
  PROJECT_SINGLE_FILES,
  USER_HOME_RULE_SUBDIRS,
} from "./constants.mjs";
import { scanRuleFiles, singleFileInfo } from "./scanner.mjs";

const toPosix = (value) => value.replaceAll("\\", "/");

export const toRelativePath = (root, filePath) => toPosix(relative(root, filePath));

export const isSameOrChildPath = (childPath, parentPath) => {
  const relativePath = relative(parentPath, resolve(childPath));
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
};

const canonicalTargetIsInside = (projectRoot, targetFile) => {
  const lexicalRoot = resolve(projectRoot);
  const lexicalTarget = resolve(targetFile);
  if (!isSameOrChildPath(lexicalTarget, lexicalRoot)) return false;
  try {
    const realRoot = realpathSync.native(lexicalRoot);
    let existing = lexicalTarget;
    while (!existsSync(existing)) {
      const parent = dirname(existing);
      if (parent === existing) return false;
      existing = parent;
    }
    return isSameOrChildPath(realpathSync.native(existing), realRoot);
  } catch {
    return false;
  }
};

/** Walk up from startDir until a directory holds a project marker. Null when none does. */
export const findProjectRoot = (startDir) => {
  if (typeof startDir !== "string" || startDir.length === 0) return null;
  let current = resolve(startDir);
  for (;;) {
    for (const marker of PROJECT_MARKERS) {
      if (existsSync(join(current, marker))) return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

/**
 * Directories to scan, with distance from the edited file.
 * Static mode (targetFile null) scans the project root only, at distance 0.
 */
export const walkDirectories = (projectRoot, targetFile) => {
  if (targetFile === null || targetFile === undefined) return [{ directory: projectRoot, distance: 0 }];

  const start = dirname(resolve(targetFile));
  if (!isSameOrChildPath(start, projectRoot)) return [{ directory: projectRoot, distance: 0 }];

  const walked = [];
  let current = start;
  let distance = 0;
  for (;;) {
    walked.push({ directory: current, distance });
    if (current === projectRoot) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
    distance += 1;
  }
  return walked;
};

const projectCandidates = (projectRoot, targetFile) => {
  const root = resolve(projectRoot);
  if (targetFile !== null && targetFile !== undefined && !canonicalTargetIsInside(root, targetFile)) return [];
  const candidates = [];

  for (const walked of walkDirectories(root, targetFile)) {
    for (const [parentDirectory, subDirectory] of PROJECT_RULE_SUBDIRS) {
      const source = `${parentDirectory}/${subDirectory}`;
      for (const file of scanRuleFiles({
        rootDir: join(walked.directory, parentDirectory, subDirectory),
        allowedRoot: root,
      })) {
        candidates.push({
          path: file.path,
          realPath: file.realPath,
          containmentRoot: file.containmentRoot,
          source,
          distance: walked.distance,
          isGlobal: false,
          isSingleFile: false,
          relativePath: toRelativePath(root, file.path),
        });
      }
    }
  }

  for (const walked of walkDirectories(root, targetFile)) {
    for (const ruleFile of PROJECT_SINGLE_FILES) {
      const filePath = join(walked.directory, ruleFile);
      const info = singleFileInfo(filePath, { allowedRoot: root });
      if (info === null) continue;
      candidates.push({
        path: info.path,
        realPath: info.realPath,
        containmentRoot: info.containmentRoot,
        source: ruleFile,
        distance: walked.distance,
        isGlobal: false,
        isSingleFile: true,
        relativePath: toRelativePath(root, filePath),
      });
    }
  }

  return candidates;
};

const userHomeCandidates = (homeDirectory) => {
  const candidates = [];
  for (const subDirectory of USER_HOME_RULE_SUBDIRS) {
    const source = `~/${subDirectory}`;
    for (const file of scanRuleFiles({ rootDir: join(homeDirectory, subDirectory), allowedRoot: homeDirectory })) {
      candidates.push({
        path: file.path,
        realPath: file.realPath,
        containmentRoot: file.containmentRoot,
        source,
        distance: GLOBAL_DISTANCE,
        isGlobal: true,
        isSingleFile: false,
        relativePath: toRelativePath(homeDirectory, file.path),
      });
    }
  }
  return candidates;
};

/** Bundled rules that only make sense on one platform, keyed by relative path. */
const PLATFORM_GATED_BUNDLED_RULES = new Map([["bundled-rules/windows-git-bash.md", "win32"]]);

const bundledCandidates = (pluginRoot, platform) => {
  if (pluginRoot === null || pluginRoot === undefined) return [];
  const activePlatform = platform ?? process.platform;
  const ruleDirectory = join(pluginRoot, BUNDLED_RULE_SUBDIR);
  const candidates = [];
  for (const file of scanRuleFiles({ rootDir: ruleDirectory, allowedRoot: pluginRoot })) {
    const relativePath = toRelativePath(pluginRoot, file.path);
    const requiredPlatform = PLATFORM_GATED_BUNDLED_RULES.get(relativePath);
    if (requiredPlatform !== undefined && requiredPlatform !== activePlatform) continue;
    candidates.push({
      path: file.path,
      realPath: file.realPath,
      containmentRoot: file.containmentRoot,
      source: "plugin-bundled",
      distance: GLOBAL_DISTANCE,
      isGlobal: true,
      isSingleFile: false,
      relativePath,
    });
  }
  return candidates;
};

export const findRuleCandidates = ({
  projectRoot,
  targetFile = null,
  homeDir,
  pluginRoot,
  skipUserHome = false,
  platform,
}) => {
  const candidates = [];
  if (projectRoot !== null && projectRoot !== undefined) {
    candidates.push(...projectCandidates(projectRoot, targetFile));
  }
  candidates.push(...bundledCandidates(pluginRoot, platform));
  if (!skipUserHome) {
    candidates.push(...userHomeCandidates(resolve(homeDir ?? homedir())));
  }
  return candidates;
};

/**
 * The three path bases a glob may match against: project-relative, relative to the
 * directory that owns the rule (so a nested rule can use short globs), and basename.
 */
export const pathBasesForTarget = (projectRoot, targetFile, candidate) => {
  const targetBasename = basename(targetFile);
  if (projectRoot === null || projectRoot === undefined) {
    return { projectRelative: targetBasename, basename: targetBasename };
  }

  const projectRelative = toPosix(relative(projectRoot, targetFile));
  if (candidate.isGlobal === true) return { projectRelative, basename: targetBasename };

  const scopeDirectory = candidate.isSingleFile === true
    ? dirname(candidate.path)
    : scopeDirectoryFor(projectRoot, candidate);
  if (scopeDirectory === null) return { projectRelative, basename: targetBasename };

  return {
    projectRelative,
    scopeRelative: toPosix(relative(scopeDirectory, targetFile)),
    basename: targetBasename,
  };
};

const scopeDirectoryFor = (projectRoot, candidate) => {
  const sourceIndex = candidate.relativePath.indexOf(candidate.source);
  if (sourceIndex === -1) return projectRoot;
  const scopeRelative = candidate.relativePath.slice(0, sourceIndex).replace(/\/$/u, "");
  return scopeRelative.length === 0 ? projectRoot : join(projectRoot, scopeRelative);
};

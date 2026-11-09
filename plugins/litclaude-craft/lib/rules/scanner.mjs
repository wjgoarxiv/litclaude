// Bounded recursive scan for rule files. Every failure mode returns fewer files
// rather than throwing: a hook that dies on an unreadable directory is worse than
// a hook that injects nothing.

import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { DEFAULT_MAX_SCAN_DEPTH, DEFAULT_MAX_SCAN_FILES, RULE_FILE_EXTENSIONS, SCANNER_EXCLUDED_DIRS } from "./constants.mjs";

const isRuleFile = (fileName) => RULE_FILE_EXTENSIONS.some((extension) => fileName.endsWith(extension));

const isSameOrChildPath = (parentPath, childPath) => {
  const rel = relative(parentPath, childPath);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

const hasSymlinkComponent = (rootPath, targetPath) => {
  const rel = relative(rootPath, targetPath);
  if (!isSameOrChildPath(rootPath, targetPath)) return true;
  let current = rootPath;
  for (const component of rel.split(/[\\/]/u).filter(Boolean)) {
    current = join(current, component);
    if (lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
};

const scanDirectory = (directoryPath, depth, options, visited, results) => {
  if (results.length >= options.maxFiles) return;

  let realDirectory;
  try {
    const walkedStats = lstatSync(directoryPath);
    if (walkedStats.isSymbolicLink() || !walkedStats.isDirectory()) return;
    realDirectory = realpathSync.native(directoryPath);
    if (!isSameOrChildPath(options.allowedRealRoot, realDirectory)) return;
  } catch {
    return;
  }
  // Symlink loops are the reason this is a set of REAL paths, not of walked paths.
  if (visited.has(realDirectory)) return;
  visited.add(realDirectory);

  let entries;
  try {
    entries = readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= options.maxFiles) return;
    const entryPath = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (!options.excludedDirs.has(entry.name) && depth < options.maxDepth) {
        scanDirectory(entryPath, depth + 1, options, visited, results);
      }
      continue;
    }

    if (entry.isSymbolicLink()) continue;

    if (entry.isFile() && isRuleFile(entry.name)) {
      try {
        const realPath = realpathSync.native(entryPath);
        if (!isSameOrChildPath(options.allowedRealRoot, realPath)) continue;
        results.push({ path: entryPath, realPath, containmentRoot: options.allowedRealRoot });
      } catch {
        // A disappearing or unreadable candidate is simply absent from this hook pass.
      }
    }
  }
};

export const scanRuleFiles = ({ rootDir, allowedRoot, excludedDirs, maxDepth, maxFiles } = {}) => {
  if (typeof rootDir !== "string" || rootDir.length === 0) return [];
  const rootPath = isAbsolute(rootDir) ? rootDir : resolve(rootDir);
  const allowedPath = resolve(allowedRoot ?? rootPath);

  let allowedRealRoot;
  try {
    allowedRealRoot = realpathSync.native(allowedPath);
    if (hasSymlinkComponent(allowedPath, rootPath)) return [];
  } catch {
    return [];
  }

  const results = [];
  scanDirectory(
    rootPath,
    0,
    {
      excludedDirs: new Set(excludedDirs ?? SCANNER_EXCLUDED_DIRS),
      maxDepth: maxDepth ?? DEFAULT_MAX_SCAN_DEPTH,
      maxFiles: maxFiles ?? DEFAULT_MAX_SCAN_FILES,
      allowedRealRoot,
    },
    new Set(),
    results,
  );
  return results;
};

/** Return { path, realPath } for a single rule file, or null when it is not a readable file. */
export const singleFileInfo = (filePath, { allowedRoot } = {}) => {
  try {
    const allowedPath = resolve(allowedRoot ?? dirname(filePath));
    const allowedRealRoot = realpathSync.native(allowedPath);
    if (hasSymlinkComponent(allowedPath, resolve(filePath))) return null;
    const stats = lstatSync(filePath);
    if (stats.isSymbolicLink() || !stats.isFile()) return null;
    const realPath = realpathSync.native(filePath);
    if (!isSameOrChildPath(allowedRealRoot, realPath)) return null;
    return { path: filePath, realPath, containmentRoot: allowedRealRoot };
  } catch {
    return null;
  }
};

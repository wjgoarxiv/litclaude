// Discovery surfaces, ordering priority, and injection budgets for the rules engine.

/** Walk UP from a start directory until a directory contains one of these. */
export const PROJECT_MARKERS = Object.freeze([
  ".git",
  "pnpm-workspace.yaml",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  ".venv",
]);

/** [parentDir, subDir] pairs scanned recursively at every walked directory. */
export const PROJECT_RULE_SUBDIRS = Object.freeze([
  [".litcodex", "rules"],
  [".claude", "rules"],
  [".cursor", "rules"],
  [".github", "instructions"],
]);

/** Single-file project rules. Frontmatter optional; they always apply. */
export const PROJECT_SINGLE_FILES = Object.freeze([".github/copilot-instructions.md", "CONTEXT.md"]);

/** User-home rule directories, relative to the home directory. */
export const USER_HOME_RULE_SUBDIRS = Object.freeze([".litclaude/rules", ".claude/rules", ".cursor/rules"]);

/** Bundled rule directory, relative to the plugin root. */
export const BUNDLED_RULE_SUBDIR = "bundled-rules";

export const RULE_FILE_EXTENSIONS = Object.freeze([".md", ".mdc"]);

/** Lower sorts earlier. Unknown sources sort last. */
export const SOURCE_PRIORITY = Object.freeze(
  new Map([
    [".litcodex/rules", 0],
    [".claude/rules", 1],
    [".cursor/rules", 2],
    [".github/instructions", 3],
    [".github/copilot-instructions.md", 4],
    ["CONTEXT.md", 7],
    ["~/.litclaude/rules", 100],
    ["~/.claude/rules", 101],
    ["~/.cursor/rules", 102],
    ["plugin-bundled", 200],
  ]),
);

/** Distance assigned to user-home and bundled rules so local rules always win. */
export const GLOBAL_DISTANCE = 9999;

export const DEFAULT_MAX_RULE_CHARS = 12_000;
export const DEFAULT_MAX_SCAN_FILES = 1000;
export const DEFAULT_MAX_SCAN_DEPTH = 10;

/** SessionStart carries the full budget. */
export const DEFAULT_STATIC_MAX_RESULT_CHARS = 40_000;

/** UserPromptSubmit picks up stragglers at a reduced size. */
export const DEFAULT_PROMPT_MAX_RULE_CHARS = 6_000;
export const DEFAULT_PROMPT_MAX_RESULT_CHARS = 16_000;

/** PostToolUse stays lightweight — it can fire on every edit. */
export const DEFAULT_DYNAMIC_MAX_RULE_CHARS = 4_000;
export const DEFAULT_DYNAMIC_MAX_RESULT_CHARS = 10_000;

/** After a compaction the re-injection is deliberately small and bounded. */
export const DEFAULT_POST_COMPACT_MAX_RULE_CHARS = 3_500;
export const DEFAULT_POST_COMPACT_MAX_RESULT_CHARS = 4_000;

/** How many times one session may re-inject rules after compaction. */
export const POST_COMPACT_REINJECTION_BUDGET = 2;

export const TRUNCATION_NOTICE = "\n\n[Truncated. Full rule: {path}]";

export const SCANNER_EXCLUDED_DIRS = Object.freeze([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".turbo",
  ".next",
  "coverage",
  "vendor",
]);

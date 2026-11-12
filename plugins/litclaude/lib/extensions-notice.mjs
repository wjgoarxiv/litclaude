// The LitFamily extensions notice. Nine skills that make files left LitClaude for the wjgoarxiv-skills
// marketplace; LitClaude keeps a same-name stub for each. The installer prints this notice after every
// install or update, and the SessionStart hook shows it once in the first session that runs a new
// version (recorded in LitClaude's own home, beside the update-notifier state). On an upgrade it also
// names what older versions left on disk. Plain text only: no colour, never in a JSON result.
import { lstatSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";

// Each moved skill and the wjgoarxiv-skills plugin that now ships it.
export const EXTENSION_SKILLS = Object.freeze({
  "lit-pptx": "decks",
  "lit-docx": "documents",
  "lit-diagram-drawer": "figures",
  "lit-schematic": "figures",
  "lit-scientific-visualization": "figures",
  "frontend-ui-ux": "design",
  "visual-qa": "design",
  "lit-typographic-motion": "video-covers",
  "readme-studio": "video-covers",
});

export const EXTENSIONS_SHELF = "github.com/wjgoarxiv/wjgoarxiv-skills";
export const MARKETPLACE_LINE = "claude plugin marketplace add wjgoarxiv/wjgoarxiv-skills";
export const installLine = (plugin) => `claude plugin install ${plugin}@wjgoarxiv-skills`;

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const STATE_FILE = "extensions-notice.json";

const isDirectory = (path) => {
  try {
    const value = lstatSync(path);
    return value.isDirectory() && !value.isSymbolicLink();
  } catch {
    return false;
  }
};

const oldVersions = (parent, currentVersion) => {
  try {
    return readdirSync(parent)
      .filter((name) => stableVersion.test(name) && name !== currentVersion && isDirectory(join(parent, name)))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  } catch {
    return [];
  }
};

const homeRelative = (path, home) => {
  const rel = home ? relative(home, path) : "";
  return rel && !rel.startsWith("..") && !rel.startsWith(sep) ? `~/${rel.split(sep).join("/")}` : path;
};

/**
 * What older LitClaude versions left on disk: old version folders of the plugin cache and of the
 * compatibility copy, and the two runtime caches the moved skills used. Only folders that exist.
 */
export const extensionLeftovers = ({ claudeHome, litHome, cacheHome, currentVersion, home = homedir() }) => {
  const rows = [];
  for (const parent of [join(claudeHome, "plugins", "cache", "litclaude-ai", "litclaude"), join(litHome, "litclaude-ai")]) {
    const versions = oldVersions(parent, currentVersion);
    if (versions.length > 0) rows.push(`${homeRelative(parent, home)}/ old versions ${versions.join(", ")} (keep ${currentVersion})`);
  }
  for (const name of ["office-runtime", "motion-runtime"]) {
    const path = join(cacheHome, "litclaude", name);
    if (isDirectory(path)) rows.push(homeRelative(path, home));
  }
  return rows;
};

/** The notice as lines; `leftovers` comes from extensionLeftovers and adds the upgrade part. */
export const extensionsNoticeLines = ({ leftovers = [] } = {}) => [
  "LitFamily extensions",
  "  LitClaude's core is complete and works on its own.",
  "  Nine skills that make files (decks, documents, figures, design, video covers) are now LitFamily",
  `  extensions, kept on the extension shelf at ${EXTENSIONS_SHELF}. Install the ones`,
  "  you use beside LitClaude to get the full LitFamily experience:",
  `    ${MARKETPLACE_LINE}`,
  `    ${installLine("decks")}   # or documents, figures, design, video-covers`,
  ...(leftovers.length === 0 ? [] : [
    "  Older versions left these behind. The extensions reuse the two runtime caches; if you do not",
    "  install them, you can delete all of these once older Claude Code sessions are closed:",
    ...leftovers.map((row) => `    ${row}`),
  ]),
];

const environmentHomes = (env) => {
  const home = env.HOME || homedir();
  return {
    home,
    claudeHome: env.CLAUDE_CONFIG_DIR || env.CLAUDE_HOME || join(home, ".claude"),
    litHome: env.LITCLAUDE_HOME || join(home, ".litclaude"),
    cacheHome: env.XDG_CACHE_HOME || join(home, ".cache"),
  };
};

const insideFolder = (path, folder) => {
  try {
    const rel = relative(realpathSync(folder), realpathSync(path));
    return rel.length > 0 && !rel.startsWith("..") && !rel.startsWith(sep);
  } catch {
    return false;
  }
};

/**
 * The SessionStart notice, once per version: null when this plugin does not run from Claude Code's
 * plugin cache (a checkout or --plugin-dir), when this version already showed it, or when the record
 * cannot be written (so a broken record never repeats it every session).
 */
export const claimSessionExtensionsNotice = ({ pluginRoot, version, env = process.env, now = Date.now() }) => {
  try {
    if (typeof version !== "string" || !stableVersion.test(version)) return null;
    const homes = environmentHomes(env);
    if (!insideFolder(pluginRoot, join(homes.claudeHome, "plugins", "cache"))) return null;
    if (!isDirectory(homes.litHome)) return null;
    const record = join(homes.litHome, STATE_FILE);
    try {
      if (lstatSync(record).isSymbolicLink()) return null;
      if (JSON.parse(readFileSync(record, "utf8")).version === version) return null;
    } catch {
      // No record yet, or an unreadable one: show the notice and rewrite it.
    }
    const staging = `${record}.${process.pid}.tmp`;
    writeFileSync(staging, `${JSON.stringify({ version, shownAt: new Date(now).toISOString() })}\n`, { flag: "wx" });
    renameSync(staging, record);
    const leftovers = extensionLeftovers({ ...homes, currentVersion: version });
    return extensionsNoticeLines({ leftovers }).join("\n");
  } catch {
    return null;
  }
};

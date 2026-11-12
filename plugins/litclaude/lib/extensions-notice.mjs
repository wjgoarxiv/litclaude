// The LitFamily extensions notice. Nine skills that make files left LitClaude for the wjgoarxiv-skills
// marketplace; LitClaude keeps a same-name stub for each. The installer prints this notice after every
// install or update, and the SessionStart hook shows it once in the first session that runs a new
// version (recorded in LitClaude's own home, beside the update-notifier state). On an upgrade it also
// names what older versions left on disk, and any skill of the user's own that has an extension's name.
// Plain text only: no colour, never in a JSON result.
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
export const MARKETPLACE_UPDATE_LINE = "claude plugin marketplace update wjgoarxiv-skills";
export const updateLine = (plugin) => `claude plugin update ${plugin}@wjgoarxiv-skills`;

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

const exists = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

// The real path of a folder, so a cwd reached through a symlink still reads as inside the home folder.
const real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

// A path for a shell line: "$HOME/..." under the home folder, single-quoted otherwise.
const shellPath = (path, home) => {
  const rel = home ? relative(home, path) : "";
  if (rel && !rel.startsWith("..") && !rel.startsWith(sep)) return `"$HOME/${rel.split(sep).join("/").replace(/["$`\\]/gu, "\\$&")}"`;
  return `'${path.replaceAll("'", "'\\''")}'`;
};

// One line that moves a same-name skill whole into a dated folder Claude Code does not read.
const moveAsideLine = (path, backups, home) => {
  const folder = shellPath(backups, home);
  const stamped = folder.startsWith('"') ? `${folder.slice(0, -1)}/$(date +%Y%m%d-%H%M%S)"` : `${folder}/"$(date +%Y%m%d-%H%M%S)"`;
  return `d=${stamped}; mkdir -p "$d" && mv ${shellPath(path, home)} "$d"/`;
};

/**
 * Skills of the user's own that carry an extension's name: `<claudeHome>/skills/<id>` (personal) and
 * `<cwd>/.claude/skills/<id>` (project). Claude Code loads such a folder beside the extension's
 * `<plugin>:<id>`, so the two compete for the same requests. Read only; each row carries the line that
 * moves the folder into `extension-backups/<date>/` beside its skills folder, which Claude Code does not read.
 */
export const sameNameSkills = ({ claudeHome, cwd, home = homedir() }) => {
  const realHome = real(home);
  const bases = [{ scope: "personal", base: real(claudeHome) }];
  if (typeof cwd === "string" && cwd) {
    const project = join(real(cwd), ".claude");
    if (project !== bases[0].base) bases.push({ scope: "project", base: project });
  }
  const rows = [];
  for (const { scope, base } of bases) {
    for (const [id, plugin] of Object.entries(EXTENSION_SKILLS)) {
      const path = join(base, "skills", id);
      if (!exists(path)) continue;
      rows.push({
        id, plugin, scope, path,
        shown: homeRelative(path, realHome),
        move: moveAsideLine(path, join(base, "extension-backups"), realHome),
      });
    }
  }
  return rows;
};

/** The notice as lines; `leftovers` adds the upgrade part and `sameName` (from sameNameSkills) the move lines. */
export const extensionsNoticeLines = ({ leftovers = [], sameName = [] } = {}) => [
  "LitFamily extensions",
  "  LitClaude's core is complete and works on its own.",
  "  Nine skills that make files (decks, documents, figures, design, video covers) are now LitFamily",
  `  extensions, kept on the extension shelf at ${EXTENSIONS_SHELF}. Install the ones`,
  "  you use beside LitClaude to get the full LitFamily experience:",
  `    ${MARKETPLACE_LINE}`,
  `    ${installLine("decks")}   # or documents, figures, design, video-covers`,
  "  To update an installed extension, refresh the shelf first and then the plugin. Claude Code installs a",
  "  new copy only when the plugin's version has changed, and the new copy loads after /reload-plugins or",
  "  in a new session:",
  `    ${MARKETPLACE_UPDATE_LINE}`,
  `    ${updateLine("decks")}   # or the plugin you installed`,
  ...(sameName.length === 0 ? [] : [
    "  A skill of your own has the name of an extension, so Claude Code loads it beside the extension and",
    "  the two compete for the same requests. Move it whole into a dated folder Claude Code does not read:",
    ...sameName.flatMap((row) => [`    ${row.shown} competes with ${row.plugin}:${row.id}`, `      ${row.move}`]),
  ]),
  ...(leftovers.length === 0 ? [] : [
    "  Older versions left these behind. The old version folders can be deleted once older Claude Code",
    "  sessions are closed. The extensions reuse the runtime caches, so delete those only if you do not",
    "  install them:",
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
export const claimSessionExtensionsNotice = ({ pluginRoot, version, cwd, env = process.env, now = Date.now() }) => {
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
    const sameName = sameNameSkills({ claudeHome: homes.claudeHome, cwd, home: homes.home });
    return extensionsNoticeLines({ leftovers, sameName }).join("\n");
  } catch {
    return null;
  }
};

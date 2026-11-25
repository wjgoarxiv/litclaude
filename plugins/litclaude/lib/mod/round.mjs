// The one answer to "does this terminal draw the round caps (U+E0B6, U+E0B4)?", for the status line, the
// card and the installer. The person's glyph setting wins; then terminals that draw the caps themselves;
// over SSH the fonts here are not the ones on screen; otherwise a Nerd Font installed here, told by file
// names alone. No Node built-ins: the card reads folders through the host, the rest through lib/round-caps.mjs.

const EXPLICIT = ["nerd", "round", "basic"];
const FONT_NAME = /(?:nerd[ _-]?font|[a-z0-9]NF[MP]?[-_. ]).*\.(?:ttf|otf|ttc)$/iu;
const MAX_NAMES = 4000;
const MAX_FOLDERS = 200;
const MAX_LEVELS = 3;

/** `LITCLAUDE_HUD_GLYPHS`, then the card's `glyphs` option; "auto" when neither chooses. */
export const glyphSetting = (env, option) => [env?.LITCLAUDE_HUD_GLYPHS, option].find((value) => EXPLICIT.includes(value)) ?? "auto";

export const drawsRoundCaps = (env) => Boolean(env?.WT_SESSION || env?.KITTY_WINDOW_ID)
  || env?.TERM === "xterm-kitty" || /^(?:vscode|wezterm|ghostty)$/iu.test(env?.TERM_PROGRAM ?? "");

/** Every platform's font folders the environment names; one that is not here is simply empty. */
export const fontFolders = (env) => {
  const home = env?.HOME?.trim();
  const data = env?.XDG_DATA_HOME?.trim() || (home && `${home}/.local/share`);
  return [
    home && `${home}/Library/Fonts`, "/Library/Fonts",
    data && `${data}/fonts`, home && `${home}/.fonts`, "/usr/local/share/fonts", "/usr/share/fonts",
    env?.LOCALAPPDATA && `${env.LOCALAPPDATA}/Microsoft/Windows/Fonts`, env?.WINDIR && `${env.WINDIR}/Fonts`,
  ].filter(Boolean);
};

/** Whether a Nerd Font's file name is in `folders`. `list(path)` gives { name, kind, isLink } entries; no font is opened. */
export const findNerdFont = async (list, folders) => {
  let names = 0;
  let opened = 0;
  let level = folders;
  for (let depth = 0; depth < MAX_LEVELS; depth += 1) {
    const below = [];
    for (const folder of level) {
      opened += 1;
      if (opened > MAX_FOLDERS) return false;
      let entries = [];
      try {
        entries = await list(folder);
      } catch {
        // A missing or unreadable folder holds no font we can name.
      }
      for (const entry of Array.isArray(entries) ? entries : []) {
        names += 1;
        if (names > MAX_NAMES) return false;
        if ((entry.kind === "file" || entry.isLink) && FONT_NAME.test(entry.name)) return true;
        if (entry.kind !== "file" && !entry.isLink) below.push(`${folder}/${entry.name}`);
      }
    }
    level = below;
  }
  return false;
};

/** `hasFont` is asked only when neither the setting nor the terminal has answered, and never over SSH. */
export const roundCaps = async ({ env, setting = glyphSetting(env), hasFont }) => {
  if (setting !== "auto") return setting !== "basic";
  return drawsRoundCaps(env) || (!env?.SSH_CONNECTION && await hasFont());
};

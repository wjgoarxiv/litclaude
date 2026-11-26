// lib/mod/round.mjs's rule for the processes that run on Node: the status line and the installer.

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ignitionStateRoot } from "./hud-ignition.mjs";
import { findNerdFont, fontFolders, glyphSetting, roundCaps } from "./mod/round.mjs";

const DAY_MS = 86_400_000;
const withHome = (env) => ({ ...env, HOME: env.HOME?.trim() || homedir() });
const listFolder = (path) => readdirSync(path, { withFileTypes: true })
  .map((entry) => ({ name: entry.name, kind: entry.isFile() ? "file" : entry.isDirectory() ? "dir" : "other", isLink: !entry.isFile() && !entry.isDirectory() }));

export const nerdFontInstalled = (env = process.env) => findNerdFont(listFolder, fontFolders(withHome(env)));

/** Drops the kept answer, so the next status line looks again. */
export const forgetNerdFont = (env = process.env) => {
  try {
    rmSync(join(ignitionStateRoot(env), "nerd-font.json"), { force: true });
  } catch {
    // A shared temp folder may be another user's; a new font changes its folder, which drops the answer too.
  }
};

/** The status line draws often, so its answer is kept for a day, or until a font folder changes. */
export const nerdFontInstalledCached = async (env = process.env, now = Date.now()) => {
  const key = fontFolders(withHome(env)).map((path) => {
    try {
      return `${path}:${statSync(path).mtimeMs}`;
    } catch {
      return `${path}:`;
    }
  }).join("|");
  const root = ignitionStateRoot(env);
  const file = join(root, "nerd-font.json");
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    if (saved.key === key && now >= saved.at && now - saved.at < DAY_MS && typeof saved.found === "boolean") return saved.found;
  } catch {
    // No answer saved yet, or an unreadable one: look again.
  }
  const found = await nerdFontInstalled(env);
  try {
    mkdirSync(root, { recursive: true });
    const staging = `${file}.${process.pid}.tmp`;
    writeFileSync(staging, JSON.stringify({ key, at: now, found }));
    renameSync(staging, file);
  } catch {
    // Without a place to keep it the next draw looks again.
  }
  return found;
};

/** The card's stored `glyphs` option: the one the installer writes, then any other marketplace's LitClaude. */
export const storedGlyphs = (settings) => {
  const configs = settings?.pluginConfigs ?? {};
  return configs["litclaude@litclaude-ai"]?.options?.glyphs
    ?? Object.entries(configs).find(([key, config]) => key.startsWith("litclaude@") && config?.options?.glyphs !== undefined)?.[1].options.glyphs;
};

const readSettings = (env) => {
  try {
    return JSON.parse(readFileSync(join(env.CLAUDE_CONFIG_DIR || env.CLAUDE_HOME || join(withHome(env).HOME, ".claude"), "settings.json"), "utf8"));
  } catch {
    return null;
  }
};

export const roundCapsHere = ({ env = process.env, cached = false, settings = readSettings(env) } = {}) => roundCaps({
  env,
  setting: glyphSetting(env, storedGlyphs(settings)),
  hasFont: () => (cached ? nerdFontInstalledCached(env) : nerdFontInstalled(env)),
});

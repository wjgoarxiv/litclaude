// Opt-in icon font for the LIT band: the symbols-only Nerd Font (Symbols Nerd Font Mono, MIT), so the
// band can draw its rounded pill caps (U+E0B6, U+E0B4) and icons while the person keeps their own
// terminal font. The font is not bundled: install downloads one pinned official release archive,
// refuses it unless its SHA-256 matches, takes the two pinned files out of it (each checked again),
// and writes them into the per-user font folder only. A manifest of what was written lets
// uninstall remove exactly those files and leave any copy the person installed alone.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { linkSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";

export const ICON_FONT = Object.freeze({
  family: "Symbols Nerd Font Mono",
  release: "v3.5.1",
  url: "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/NerdFontsSymbolsOnly.zip",
  archiveSha256: "fdca3682534f6f65e1ccb2345b0362ccf67d9b8eca7c8025330946e93e2473bc",
  archiveMaxBytes: 8 * 1024 * 1024,
  files: Object.freeze([
    Object.freeze({ entry: "SymbolsNerdFontMono-Regular.ttf", name: "SymbolsNerdFontMono-Regular.ttf", sha256: "fe471e538392f51910faab985fa8e192a39dd3426125edd15b71b3680df0e749", kind: "font" }),
    Object.freeze({ entry: "LICENSE", name: "SymbolsNerdFontMono-LICENSE.txt", sha256: "84a7a98c82140fb12c37fe42b93805baa16024cb3e5acc599b7ffe612c55d847", kind: "license" }),
  ]),
});

// Font file names the LIT band treats as "the icon font is installed": this one, and the
// proportional symbols font a person may have installed some other way.
export const ICON_FONT_FILE_NAMES = Object.freeze(["SymbolsNerdFontMono-Regular.ttf", "SymbolsNerdFont-Regular.ttf"]);

export const ICON_FONT_QUESTION = "Install the icon font for LitClaude's status band? (y/N) ";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export class IconFontError extends Error {}

/** The per-user font folder, or null where installing one safely is not supported (Windows). */
export const iconFontDir = ({ platform = process.platform, env = process.env, home }) => {
  if (platform === "darwin") return join(home, "Library", "Fonts");
  if (platform === "win32") return null;
  return join(env.XDG_DATA_HOME?.trim() || join(home, ".local", "share"), "fonts");
};

export const iconFontManifestPath = (litHome) => join(litHome, "icon-font", "manifest.json");

export const parseYesNo = (answer) => /^\s*y(?:es)?\s*$/iu.test(String(answer ?? ""));

const readU16 = (buffer, offset) => buffer.readUInt16LE(offset);
const readU32 = (buffer, offset) => buffer.readUInt32LE(offset);

/**
 * Reads the named entries out of a zip archive held in memory (stored or deflated, no zip64), by
 * its central directory. Returns a Map of entry name to bytes; a missing entry is simply absent.
 */
export const extractZipEntries = (archive, names) => {
  const wanted = new Set(names);
  const found = new Map();
  let end = -1;
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 22 - 65_535); offset -= 1) {
    if (readU32(archive, offset) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new IconFontError("the archive is not a zip file");
  const count = readU16(archive, end + 10);
  let offset = readU32(archive, end + 16);
  for (let index = 0; index < count; index += 1) {
    if (readU32(archive, offset) !== 0x02014b50) throw new IconFontError("the archive's directory is damaged");
    const method = readU16(archive, offset + 10);
    const compressedSize = readU32(archive, offset + 20);
    const nameLength = readU16(archive, offset + 28);
    const extraLength = readU16(archive, offset + 30);
    const commentLength = readU16(archive, offset + 32);
    const localOffset = readU32(archive, offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
    if (!wanted.has(name)) continue;
    if (readU32(archive, localOffset) !== 0x04034b50) throw new IconFontError(`the archive entry ${name} is damaged`);
    const dataStart = localOffset + 30 + readU16(archive, localOffset + 26) + readU16(archive, localOffset + 28);
    const data = archive.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) found.set(name, Buffer.from(data));
    else if (method === 8) found.set(name, inflateRawSync(data));
    else throw new IconFontError(`the archive entry ${name} uses an unsupported compression method`);
  }
  return found;
};

/**
 * The pinned archive's bytes: a local copy named by LITCLAUDE_ICON_FONT_SOURCE (for offline
 * installs), else the official release download. Either way it is refused unless its size is
 * under the cap and its SHA-256 is the pinned one.
 */
export const loadIconFontArchive = async ({ env = process.env, pins = ICON_FONT, fetchImpl = globalThis.fetch } = {}) => {
  let bytes;
  const local = env.LITCLAUDE_ICON_FONT_SOURCE?.trim();
  if (local) {
    const stat = lstatSync(local);
    if (!stat.isFile() || stat.size > pins.archiveMaxBytes) throw new IconFontError(`${local} is not a regular file under ${pins.archiveMaxBytes} bytes`);
    bytes = readFileSync(local);
  } else {
    if (typeof fetchImpl !== "function") throw new IconFontError("this Node.js has no fetch; download the archive and set LITCLAUDE_ICON_FONT_SOURCE");
    const response = await fetchImpl(pins.url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new IconFontError(`the download answered HTTP ${response.status}`);
    const declared = Number(response.headers?.get?.("content-length") ?? 0);
    if (declared > pins.archiveMaxBytes) throw new IconFontError("the download is larger than the pinned archive");
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (bytes.length > pins.archiveMaxBytes) throw new IconFontError("the archive is larger than the pinned archive");
  const actual = sha256(bytes);
  if (actual !== pins.archiveSha256) throw new IconFontError(`the archive's SHA-256 is ${actual}, not the pinned ${pins.archiveSha256}; nothing was installed`);
  return bytes;
};

const lstatOrNull = (path) => {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
};

// What sits at a destination now: nothing, the exact pinned file, a different file, or something
// that is not a regular file (a link, a folder), which is never written through or over.
const destinationState = (path, expectedSha) => {
  const stat = lstatOrNull(path);
  if (!stat) return "absent";
  if (stat.isSymbolicLink() || !stat.isFile()) return "not-a-file";
  return sha256(readFileSync(path)) === expectedSha ? "same" : "different";
};

export const planIconFontInstall = ({ platform = process.platform, env = process.env, home, pins = ICON_FONT }) => {
  const dir = iconFontDir({ platform, env, home });
  if (!dir) return { supported: false, dir: null, files: [] };
  return {
    supported: true,
    dir,
    files: pins.files.map((file) => {
      const path = join(dir, file.name);
      return { ...file, path, state: destinationState(path, file.sha256) };
    }),
  };
};

const readManifest = (litHome) => {
  try {
    const manifest = JSON.parse(readFileSync(iconFontManifestPath(litHome), "utf8"));
    return Array.isArray(manifest?.files) ? manifest : null;
  } catch {
    return null;
  }
};

const writeManifest = (litHome, manifest) => {
  const path = iconFontManifestPath(litHome);
  mkdirSync(dirname(path), { recursive: true });
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  renameSync(staging, path);
};

// Writes a new file without ever replacing one: the bytes go to a fresh temporary name in the same
// folder, then a hard link claims the destination, which fails if anything appeared there.
const writeNewFile = (path, bytes) => {
  const staging = `${path}.litclaude-${process.pid}.tmp`;
  writeFileSync(staging, bytes, { flag: "wx", mode: 0o644 });
  try {
    linkSync(staging, path);
  } finally {
    unlinkSync(staging);
  }
};

/**
 * Installs the pinned files from a verified archive into the per-user font folder. A destination
 * that already holds the pinned bytes is left as it is (and recorded as LitClaude's only if an
 * earlier LitClaude install wrote it); a different file or a link is never overwritten.
 */
export const installIconFont = ({ archive, platform = process.platform, env = process.env, home, litHome, pins = ICON_FONT, spawn = spawnSync, now = () => new Date() }) => {
  const plan = planIconFontInstall({ platform, env, home, pins });
  if (!plan.supported) return { status: "unsupported", installed: [], present: [], skipped: [] };
  const entries = extractZipEntries(archive, pins.files.map(({ entry }) => entry));
  const previous = readManifest(litHome)?.files ?? [];
  const owned = [];
  const installed = [];
  const present = [];
  const skipped = [];
  for (const file of plan.files) {
    const bytes = entries.get(file.entry);
    if (!bytes) throw new IconFontError(`the archive has no ${file.entry}; nothing was installed`);
    if (sha256(bytes) !== file.sha256) throw new IconFontError(`${file.entry} in the archive does not match its pinned SHA-256; nothing was installed`);
  }
  mkdirSync(plan.dir, { recursive: true });
  for (const file of plan.files) {
    if (file.state === "absent") {
      writeNewFile(file.path, entries.get(file.entry));
      installed.push(file.path);
      owned.push({ path: file.path, sha256: file.sha256, kind: file.kind });
    } else if (file.state === "same") {
      present.push(file.path);
      if (previous.some((entry) => entry.path === file.path && entry.sha256 === file.sha256)) owned.push({ path: file.path, sha256: file.sha256, kind: file.kind });
    } else {
      skipped.push({ path: file.path, reason: file.state === "different" ? "a different file is already there" : "something other than a regular file is there" });
    }
  }
  if (owned.length > 0) writeManifest(litHome, { family: pins.family, release: pins.release, installedAt: now().toISOString(), files: owned });
  let fontCache = null;
  if (platform !== "darwin" && installed.length > 0) {
    const result = spawn("fc-cache", ["-f", plan.dir], { encoding: "utf8", timeout: 60_000 });
    fontCache = result.error?.code === "ENOENT" ? "fc-cache not found" : result.status === 0 ? "refreshed" : "fc-cache failed";
  }
  return { status: installed.length > 0 ? "installed" : skipped.length > 0 && present.length === 0 ? "skipped" : "present", dir: plan.dir, installed, present, skipped, fontCache };
};

/** Removes only the files the manifest records, and only while they still hold the recorded bytes. */
export const uninstallIconFont = ({ litHome, dryRun = false }) => {
  const manifest = readManifest(litHome);
  if (!manifest) return { removed: [], kept: [] };
  const removed = [];
  const kept = [];
  for (const file of manifest.files) {
    const state = destinationState(file.path, file.sha256);
    if (state === "same") {
      if (!dryRun) rmSync(file.path, { force: true });
      removed.push(file.path);
    } else if (state !== "absent") {
      kept.push({ path: file.path, reason: state === "different" ? "its bytes changed since LitClaude wrote it" : "it is no longer a regular file" });
    }
  }
  if (!dryRun) rmSync(dirname(iconFontManifestPath(litHome)), { recursive: true, force: true });
  return { removed, kept };
};

/** Whether the icon font is installed for this user, and whether LitClaude wrote it. */
export const iconFontStatus = ({ platform = process.platform, env = process.env, home, litHome }) => {
  const dir = iconFontDir({ platform, env, home });
  if (!dir) return { supported: false, present: false, path: null, managed: false };
  const managedPaths = new Set((readManifest(litHome)?.files ?? []).map(({ path }) => path));
  for (const name of ICON_FONT_FILE_NAMES) {
    const path = join(dir, name);
    const stat = lstatOrNull(path);
    if (stat?.isFile()) return { supported: true, present: true, path, managed: managedPaths.has(path) };
  }
  return { supported: true, present: false, path: join(dir, ICON_FONT.files[0].name), managed: false };
};

/**
 * One line on pointing the terminal at the font, for the terminal named by TERM_PROGRAM (kitty by
 * TERM). It is only needed when the terminal's own fallback does not pick the font up; nothing here
 * changes a terminal's settings.
 */
export const terminalFontHint = (env = process.env, family = ICON_FONT.family) => {
  const program = env.TERM_PROGRAM ?? "";
  if (program === "iTerm.app") return `iTerm2: only if icons show as boxes, set Settings > Profiles > Text > Non-ASCII Font to ${family}.`;
  if (program === "Apple_Terminal") return `Terminal.app: macOS font fallback usually finds ${family}; if icons show as boxes, pick a Nerd Font in Settings > Profiles > Text.`;
  if (program === "vscode") return `VS Code: only if icons show as boxes, add it to terminal.integrated.fontFamily, for example "Menlo, '${family}'".`;
  if (program === "ghostty") return `Ghostty: Nerd Font symbols are built in; if icons still show as boxes, add font-family = ${family} after your font in its config.`;
  if (program === "WezTerm") return `WezTerm: Nerd Font symbols are built in; if icons still show as boxes, add '${family}' to config.font = wezterm.font_with_fallback { ... }.`;
  if (env.TERM === "xterm-kitty" || env.KITTY_WINDOW_ID) return `kitty: only if icons show as boxes, add "symbol_map U+E000-U+F8FF ${family}" to kitty.conf.`;
  return `Terminal: only if icons show as boxes, add ${family} as a fallback font in your terminal's font settings.`;
};

/** What to tell a Windows user, where LitClaude does not register fonts itself. */
export const windowsIconFontInstructions = (pins = ICON_FONT) =>
  `Windows: LitClaude does not register fonts itself. Download ${pins.url}, check its SHA-256 is ${pins.archiveSha256}, then right-click SymbolsNerdFontMono-Regular.ttf and choose "Install for me".`;

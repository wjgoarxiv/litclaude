import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

import {
  ICON_FONT,
  ICON_FONT_QUESTION,
  IconFontError,
  extractZipEntries,
  iconFontDir,
  iconFontManifestPath,
  iconFontStatus,
  installIconFont,
  loadIconFontArchive,
  parseYesNo,
  planIconFontInstall,
  terminalFontHint,
  uninstallIconFont,
} from "../bin/icon-font.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(root, "bin", "litclaude-ai.js");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// A minimal zip writer for fixtures: local headers, one central directory, no CRC (the installer
// checks SHA-256 pins, not CRC).
const makeZip = (entries) => {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, store = false } of entries) {
    const nameBytes = Buffer.from(name);
    const body = store ? data : deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
};

const FONT = Buffer.from("fake font bytes ".repeat(64));
const LICENSE = Buffer.from("The MIT License (MIT)\n");
const fixtureZip = () => makeZip([
  { name: "README.md", data: Buffer.from("readme") },
  { name: "SymbolsNerdFontMono-Regular.ttf", data: FONT },
  { name: "LICENSE", data: LICENSE, store: true },
]);
const fixturePins = (archive = fixtureZip()) => ({
  ...ICON_FONT,
  url: "https://example.invalid/NerdFontsSymbolsOnly.zip",
  archiveSha256: sha256(archive),
  files: ICON_FONT.files.map((file) => ({ ...file, sha256: sha256(file.kind === "font" ? FONT : LICENSE) })),
});
const scratch = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-icon-font-")));
  return { dir, home: join(dir, "home"), litHome: join(dir, "home", ".litclaude"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

test("the pins name the official symbols-only release asset and both files' hashes", () => {
  assert.match(ICON_FONT.url, /^https:\/\/github\.com\/ryanoasis\/nerd-fonts\/releases\/download\/v\d+\.\d+\.\d+\/NerdFontsSymbolsOnly\.zip$/u);
  assert.ok(ICON_FONT.url.includes(`/${ICON_FONT.release}/`));
  for (const hash of [ICON_FONT.archiveSha256, ...ICON_FONT.files.map(({ sha256: value }) => value)]) assert.match(hash, /^[0-9a-f]{64}$/u);
  assert.deepEqual(ICON_FONT.files.map(({ kind }) => kind), ["font", "license"]);
  assert.equal(ICON_FONT.family, "Symbols Nerd Font Mono");
  assert.equal(ICON_FONT_QUESTION, "Install the icon font for LitClaude's status band? (y/N) ");
});

test("answers default to No", () => {
  for (const yes of ["y", "Y", "yes", " YES "]) assert.equal(parseYesNo(yes), true, yes);
  for (const no of ["", "n", "no", "yep", "sure", undefined, null]) assert.equal(parseYesNo(no), false, String(no));
});

test("zip entries come out stored or deflated, and junk is refused", () => {
  const entries = extractZipEntries(fixtureZip(), ["SymbolsNerdFontMono-Regular.ttf", "LICENSE", "missing"]);
  assert.deepEqual(entries.get("SymbolsNerdFontMono-Regular.ttf"), FONT);
  assert.deepEqual(entries.get("LICENSE"), LICENSE);
  assert.equal(entries.has("missing"), false);
  assert.throws(() => extractZipEntries(Buffer.from("not a zip at all, just text that is long enough"), ["LICENSE"]), IconFontError);
});

test("the archive is refused unless its SHA-256 is the pinned one, from a local copy or a download", async () => {
  const { dir, cleanup } = scratch();
  try {
    const archive = fixtureZip();
    const path = join(dir, "symbols.zip");
    writeFileSync(path, archive);
    const pins = fixturePins(archive);
    assert.deepEqual(await loadIconFontArchive({ env: { LITCLAUDE_ICON_FONT_SOURCE: path }, pins }), archive);
    await assert.rejects(loadIconFontArchive({ env: { LITCLAUDE_ICON_FONT_SOURCE: path }, pins: { ...pins, archiveSha256: "0".repeat(64) } }), /not the pinned .*nothing was installed/u);
    await assert.rejects(loadIconFontArchive({ env: { LITCLAUDE_ICON_FONT_SOURCE: path }, pins: { ...pins, archiveMaxBytes: 10 } }), /under 10 bytes/u);
    let asked;
    const fetchImpl = async (url) => {
      asked = url;
      return { ok: true, status: 200, headers: { get: () => String(archive.length) }, arrayBuffer: async () => archive };
    };
    assert.deepEqual(await loadIconFontArchive({ env: {}, pins, fetchImpl }), archive);
    assert.equal(asked, pins.url);
    await assert.rejects(loadIconFontArchive({ env: {}, pins, fetchImpl: async () => ({ ok: false, status: 404 }) }), /HTTP 404/u);
    await assert.rejects(loadIconFontArchive({ env: {}, pins, fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => String(archive.length) }, arrayBuffer: async () => Buffer.from("tampered") }) }), /SHA-256/u);
  } finally {
    cleanup();
  }
});

test("the font folder is the per-user one, and Windows is not installed into", () => {
  assert.equal(iconFontDir({ platform: "darwin", env: {}, home: "/Users/a" }), "/Users/a/Library/Fonts");
  assert.equal(iconFontDir({ platform: "linux", env: {}, home: "/home/a" }), "/home/a/.local/share/fonts");
  assert.equal(iconFontDir({ platform: "linux", env: { XDG_DATA_HOME: "/data" }, home: "/home/a" }), "/data/fonts");
  assert.equal(iconFontDir({ platform: "win32", env: {}, home: "C:\\Users\\a" }), null);
});

test("install writes the font and its licence, records them, and is idempotent", () => {
  const { home, litHome, cleanup } = scratch();
  try {
    const archive = fixtureZip();
    const pins = fixturePins(archive);
    const first = installIconFont({ archive, platform: "darwin", env: {}, home, litHome, pins });
    const fontPath = join(home, "Library", "Fonts", "SymbolsNerdFontMono-Regular.ttf");
    const licensePath = join(home, "Library", "Fonts", "SymbolsNerdFontMono-LICENSE.txt");
    assert.equal(first.status, "installed");
    assert.deepEqual(first.installed, [fontPath, licensePath]);
    assert.deepEqual(readFileSync(fontPath), FONT);
    assert.deepEqual(readFileSync(licensePath), LICENSE);
    const manifest = JSON.parse(readFileSync(iconFontManifestPath(litHome), "utf8"));
    assert.deepEqual(manifest.files.map(({ path }) => path), [fontPath, licensePath]);
    assert.equal(manifest.release, ICON_FONT.release);
    const again = installIconFont({ archive, platform: "darwin", env: {}, home, litHome, pins });
    assert.equal(again.status, "present");
    assert.deepEqual(JSON.parse(readFileSync(iconFontManifestPath(litHome), "utf8")).files.map(({ path }) => path), [fontPath, licensePath], "a second run keeps ownership");
    assert.deepEqual(iconFontStatus({ platform: "darwin", env: {}, home, litHome }), { supported: true, present: true, path: fontPath, managed: true });
  } finally {
    cleanup();
  }
});

test("install never overwrites a different file or writes through a link, and checks every file first", () => {
  const { dir, home, litHome, cleanup } = scratch();
  try {
    const archive = fixtureZip();
    const pins = fixturePins(archive);
    const fonts = join(home, "Library", "Fonts");
    mkdirSync(fonts, { recursive: true });
    writeFileSync(join(fonts, "SymbolsNerdFontMono-Regular.ttf"), "the person's own copy");
    writeFileSync(join(dir, "elsewhere.txt"), "untouched");
    symlinkSync(join(dir, "elsewhere.txt"), join(fonts, "SymbolsNerdFontMono-LICENSE.txt"));
    const result = installIconFont({ archive, platform: "darwin", env: {}, home, litHome, pins });
    assert.equal(result.status, "skipped");
    assert.deepEqual(result.skipped.map(({ reason }) => reason), ["a different file is already there", "something other than a regular file is there"]);
    assert.equal(readFileSync(join(fonts, "SymbolsNerdFontMono-Regular.ttf"), "utf8"), "the person's own copy");
    assert.equal(readFileSync(join(dir, "elsewhere.txt"), "utf8"), "untouched");
    assert.equal(existsSync(iconFontManifestPath(litHome)), false, "nothing was LitClaude's to record");

    const badLicense = { ...pins, files: pins.files.map((file) => (file.kind === "license" ? { ...file, sha256: "0".repeat(64) } : file)) };
    const { home: home2, litHome: litHome2, cleanup: cleanup2 } = scratch();
    try {
      assert.throws(() => installIconFont({ archive, platform: "darwin", env: {}, home: home2, litHome: litHome2, pins: badLicense }), /nothing was installed/u);
      assert.equal(existsSync(join(home2, "Library", "Fonts", "SymbolsNerdFontMono-Regular.ttf")), false, "the font is not written when the licence fails its pin");
    } finally {
      cleanup2();
    }
  } finally {
    cleanup();
  }
});

test("on Linux the font cache is refreshed only when fc-cache exists; Windows gets instructions", () => {
  const { dir, home, litHome, cleanup } = scratch();
  try {
    const archive = fixtureZip();
    const pins = fixturePins(archive);
    const calls = [];
    const missing = installIconFont({ archive, platform: "linux", env: { XDG_DATA_HOME: join(dir, "data") }, home, litHome, pins, spawn: (cmd, args) => (calls.push([cmd, ...args]), { error: { code: "ENOENT" } }) });
    assert.equal(missing.status, "installed");
    assert.equal(missing.fontCache, "fc-cache not found");
    assert.deepEqual(calls, [["fc-cache", "-f", join(dir, "data", "fonts")]]);
    assert.equal(existsSync(join(dir, "data", "fonts", "SymbolsNerdFontMono-Regular.ttf")), true);
    assert.equal(installIconFont({ archive, platform: "win32", env: {}, home, litHome, pins }).status, "unsupported");
    assert.equal(planIconFontInstall({ platform: "win32", env: {}, home, pins }).supported, false);
  } finally {
    cleanup();
  }
});

test("uninstall removes only the files LitClaude wrote, and only while they are unchanged", () => {
  const { home, litHome, cleanup } = scratch();
  try {
    const archive = fixtureZip();
    const pins = fixturePins(archive);
    installIconFont({ archive, platform: "darwin", env: {}, home, litHome, pins });
    const fontPath = join(home, "Library", "Fonts", "SymbolsNerdFontMono-Regular.ttf");
    const licensePath = join(home, "Library", "Fonts", "SymbolsNerdFontMono-LICENSE.txt");
    writeFileSync(licensePath, "edited by the person");
    const dry = uninstallIconFont({ litHome, dryRun: true });
    assert.deepEqual(dry.removed, [fontPath]);
    assert.equal(existsSync(fontPath), true, "a dry run removes nothing");
    const real = uninstallIconFont({ litHome });
    assert.deepEqual(real.removed, [fontPath]);
    assert.deepEqual(real.kept, [{ path: licensePath, reason: "its bytes changed since LitClaude wrote it" }]);
    assert.equal(existsSync(fontPath), false);
    assert.equal(readFileSync(licensePath, "utf8"), "edited by the person");
    assert.equal(existsSync(iconFontManifestPath(litHome)), false);
    assert.deepEqual(uninstallIconFont({ litHome }), { removed: [], kept: [] }, "without a manifest nothing is touched");
  } finally {
    cleanup();
  }
});

test("a copy the person installed is reported as present but not LitClaude's", () => {
  const { home, litHome, cleanup } = scratch();
  try {
    const fonts = join(home, "Library", "Fonts");
    mkdirSync(fonts, { recursive: true });
    writeFileSync(join(fonts, "SymbolsNerdFont-Regular.ttf"), "own");
    assert.deepEqual(iconFontStatus({ platform: "darwin", env: {}, home, litHome }), { supported: true, present: true, path: join(fonts, "SymbolsNerdFont-Regular.ttf"), managed: false });
    rmSync(fonts, { recursive: true });
    assert.equal(iconFontStatus({ platform: "darwin", env: {}, home, litHome }).present, false);
  } finally {
    cleanup();
  }
});

test("the terminal hint names the terminal and never edits its settings", () => {
  assert.match(terminalFontHint({ TERM_PROGRAM: "iTerm.app" }), /^iTerm2: .*Non-ASCII Font/u);
  assert.match(terminalFontHint({ TERM_PROGRAM: "Apple_Terminal" }), /^Terminal\.app: /u);
  assert.match(terminalFontHint({ TERM_PROGRAM: "vscode" }), /terminal\.integrated\.fontFamily/u);
  assert.match(terminalFontHint({ TERM_PROGRAM: "ghostty" }), /^Ghostty: /u);
  assert.match(terminalFontHint({ TERM_PROGRAM: "WezTerm" }), /^WezTerm: /u);
  assert.match(terminalFontHint({ TERM: "xterm-kitty" }), /symbol_map U\+E000-U\+F8FF/u);
  assert.match(terminalFontHint({}), /^Terminal: only if icons show as boxes/u);
});

// The installer CLI, always in a scratch HOME so nothing reaches the real font folder.
const runCli = (args, sandbox, extra = {}) => {
  const env = {
    ...process.env,
    HOME: sandbox.home,
    LITCLAUDE_HOME: sandbox.litHome,
    CLAUDE_CONFIG_DIR: join(sandbox.home, ".claude"),
    CLAUDE_HOME: join(sandbox.home, ".claude"),
    LITCLAUDE_NO_AUTO_UPDATE: "1",
    LITCLAUDE_NO_UPDATE_CHECK: "1",
    NO_COLOR: "1",
    LITCLAUDE_SPINNER: "0",
    LITCLAUDE_MOTION_PREWARM: "0",
    ...extra,
  };
  for (const name of ["LITCLAUDE_ICON_FONT_SOURCE", "LITCLAUDE_ICON_FONT_PROMPT", "TERM_PROGRAM"]) if (!Object.hasOwn(extra, name)) delete env[name];
  mkdirSync(sandbox.home, { recursive: true });
  return spawnSync(process.execPath, [binPath, ...args], { cwd: sandbox.home, encoding: "utf8", env });
};
const fontsIn = (sandbox) => join(sandbox.home, process.platform === "darwin" ? "Library/Fonts" : ".local/share/fonts");

test("install takes --icon-font and refuses anything else that is not an option", () => {
  const sandbox = scratch();
  try {
    const refused = runCli(["install", "--dry-run", "--icon-fonts"], sandbox);
    assert.equal(refused.status, 64);
    assert.match(refused.stderr, /Unknown install option: --icon-fonts/u);
    const dry = runCli(["install", "--dry-run", "--icon-font"], sandbox);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /Would install icon font: Symbols Nerd Font Mono v\d+\.\d+\.\d+ .*SHA-256/u);
    assert.equal(existsSync(fontsIn(sandbox)), false, "a dry run writes no font");
    const quiet = runCli(["install", "--dry-run"], sandbox);
    assert.match(quiet.stdout, /Icon font: not requested \(pass --icon-font\)/u);
  } finally {
    sandbox.cleanup();
  }
});

test("a real install with --icon-font refuses an archive that is not the pinned one and still installs LitClaude", () => {
  const sandbox = scratch();
  try {
    const fake = join(sandbox.dir, "fake.zip");
    writeFileSync(fake, fixtureZip());
    const result = runCli(["install", "--icon-font"], sandbox, { LITCLAUDE_ICON_FONT_SOURCE: fake });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /INSTALL_PASS/u);
    assert.match(result.stderr, /ICON_FONT_FAILED: the archive's SHA-256 is [0-9a-f]{64}, not the pinned/u);
    assert.equal(existsSync(join(fontsIn(sandbox), "SymbolsNerdFontMono-Regular.ttf")), false);
    const plain = runCli(["install"], sandbox);
    assert.equal(plain.status, 0, plain.stderr);
    assert.doesNotMatch(plain.stdout + plain.stderr, /ICON_FONT_(?:INSTALLED|FAILED)/u, "a non-interactive install without the flag never installs it");
  } finally {
    sandbox.cleanup();
  }
});

test("uninstall and doctor report the icon font from the manifest", () => {
  const sandbox = scratch();
  try {
    const archive = fixtureZip();
    installIconFont({ archive, platform: process.platform === "win32" ? "linux" : process.platform, env: {}, home: sandbox.home, litHome: sandbox.litHome, pins: fixturePins(archive), spawn: () => ({ error: { code: "ENOENT" } }) });
    const dryUninstall = runCli(["uninstall", "--dry-run"], sandbox);
    assert.equal(dryUninstall.status, 0, dryUninstall.stderr);
    assert.match(dryUninstall.stdout, /Would remove icon font file: .*SymbolsNerdFontMono-Regular\.ttf/u);
    assert.equal(lstatSync(join(fontsIn(sandbox), "SymbolsNerdFontMono-Regular.ttf")).isFile(), true);
    const dryDoctor = runCli(["doctor", "--dry-run"], sandbox);
    assert.match(dryDoctor.stdout, /ICON_FONT: present \(.*SymbolsNerdFontMono-Regular\.ttf, installed by LitClaude\)/u);
    const uninstall = runCli(["uninstall"], sandbox);
    assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.match(uninstall.stdout, /ICON_FONT_REMOVED: .*SymbolsNerdFontMono-Regular\.ttf/u);
    assert.equal(existsSync(join(fontsIn(sandbox), "SymbolsNerdFontMono-Regular.ttf")), false);
    const after = runCli(["doctor", "--dry-run"], sandbox);
    assert.match(after.stdout, /ICON_FONT: not installed \(optional; litclaude-ai install --icon-font\)/u);
  } finally {
    sandbox.cleanup();
  }
});

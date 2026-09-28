import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { compareStableSemver } from "./update-notifier.mjs";

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const receiptName = ".litclaude-install-receipt.json";
// Exact pristine trees installed from the registry-published litclaude-ai@0.4.6 tarball.
const legacyVersion = "0.4.6";
const legacy046 = {
  plugin: "64c73f9cb5e5c3070297f56816fc8e5413f03050ea129783d6a6c77a6f3f1ba9",
  marketplace: "b632abbbdbce223063c9c8016b5b34e9bed2d1a0568d348b291d58943ad0363f",
  compatibility: "91bca1a8aec25faafa6ccd6f45346c29a9f1c8f141c5f5d254776fa88efa1ec0",
};
const legacyVendorPathMap = [
  ["018_llm-wikify", "llm-wikify", "18a4a7f2ceb014634b1b6a814896caee91606884098ca999e14eb6aa5e750ddd"],
  ["022_handoff", "handoff", "418c5882efb8fde13601da180bf8d8c4a26a68a6feb82de53ae3fc7898e08943"],
  ["045_scientific-visualization", "scientific-visualization", "080443582be03dec89c961cbcf9661f969ccbcbc1e8ee31ef7bbb8f7a3163db5"],
  ["060_autoresearch-skill", "autoresearch", "25ce45fe792de02e04019e6d0c871738e6a1b8b6cb9a91cd2486b3d4cbb715b9"],
  ["064_autoconference-skill", "autoconference", "d305d2d41721c0196cc5aaa09610f1eb4499f7ba53504bd72bdbefdd21ca7da1"],
];
const conflict = (path, detail = "") => { throw new Error(`INSTALL_OWNERSHIP_CONFLICT: ${path}; use a compatible CLI or preserve this modified, foreign, or unsupported state before retrying${detail ? `. ${detail}` : ""}`); };
const stat = (path) => {
  try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
};

// Check user-selected roots and their descendants. System aliases above those roots
// (such as macOS /var) are outside the installer-owned path boundary.
export function assertInstallPath(root, path, { file = false } = {}) {
  const rel = relative(root, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) conflict(path);
  const parts = rel ? rel.split(sep) : [];
  let current = root;
  for (let index = 0; index <= parts.length; index += 1) {
    const value = stat(current);
    if (value && (value.isSymbolicLink() || (index === parts.length && file ? !value.isFile() || value.nlink !== 1 : !value.isDirectory()))) conflict(current);
    if (index < parts.length) current = join(current, parts[index]);
  }
}

function treeHash(root) {
  const entries = [];
  function walk(path, prefix = "") {
    for (const name of readdirSync(path).sort()) {
      if (!prefix && name === receiptName) continue;
      const next = join(path, name), rel = prefix ? `${prefix}/${name}` : name, value = lstatSync(next);
      if (value.isDirectory()) { entries.push([rel, "directory"]); walk(next, rel); }
      else if (value.isFile() && value.nlink === 1) entries.push([rel, "file", createHash("sha256").update(readFileSync(next)).digest("hex")]);
      else conflict(next);
    }
  }
  walk(root);
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

function detailedTree(root, { receipt = false } = {}) {
  const rows = [];
  function walk(path, prefix = "") {
    const value = lstatSync(path);
    if (value.isSymbolicLink()) conflict(path, "A preserved skill tree cannot contain symlinks");
    if (value.isDirectory()) {
      rows.push([prefix, "directory", value.mode & 0o777]);
      for (const name of readdirSync(path).sort()) {
        if (!prefix && !receipt && name === receiptName) continue;
        walk(join(path, name), prefix ? `${prefix}/${name}` : name);
      }
      return;
    }
    if (!value.isFile() || value.nlink !== 1) conflict(path, "A preserved skill tree must contain only regular, unlinked files");
    rows.push([prefix, "file", value.mode & 0o777, createHash("sha256").update(readFileSync(path)).digest("hex")]);
  }
  walk(root);
  return rows;
}

const rowsHash = (rows) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const treeMap = (rows) => new Map(rows.map((row) => [row[0], row]));
const sameRow = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const ownKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));

const readPluginReceipt = (pluginRoot) => {
  const path = join(pluginRoot, receiptName), value = stat(path);
  if (!value || !value.isFile() || value.nlink !== 1 || value.size > 2048) conflict(path, "Skill preservation requires a valid active plugin receipt");
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { conflict(path, "Active plugin receipt is invalid"); }
};

export function registeredPluginInstallation({ registry, pluginKey, pluginParent, home, version }) {
  const entries = registry.plugins?.[pluginKey];
  if (entries === undefined) return null;
  if (!Array.isArray(entries) || entries.length !== 1) conflict("native registration " + pluginKey);
  const entry = entries[0];
  if (!ownKeys(entry, ["scope", "installPath", "version", "installedAt", "lastUpdated", "installedBy", "enabled"])
    || entry.scope !== "user" || (entry.installedBy !== undefined && entry.installedBy !== "litclaude-ai")
    || typeof entry.version !== "string" || !stableVersion.test(entry.version)
    || compareStableSemver(entry.version, version) > 0 || entry.installPath !== join(pluginParent, entry.version)) {
    conflict("native registration " + pluginKey);
  }
  assertInstallPath(home, entry.installPath);
  return { installPath: entry.installPath, version: entry.version };
}

export function planModifiedLegacySkill({ activePlugin, marketplacePlugin, compatibilityPlugin, version, installedVersion = version, marketplaceVersion = installedVersion }) {
  if (!stat(activePlugin)) return null;
  const skillPath = join(activePlugin, "skills", "lit-korean");
  if (!stat(skillPath)) return null;
  if (!stableVersion.test(installedVersion) || compareStableSemver(installedVersion, version) > 0) {
    conflict(activePlugin, "The registered plugin version is not a supported installed version");
  }
  if (!stat(marketplacePlugin) || !stat(compatibilityPlugin)) {
    conflict(marketplacePlugin, "Redundant pristine plugin copies are missing; modified-skill preservation is unavailable");
  }
  const active = detailedTree(activePlugin);
  const marketplace = detailedTree(marketplacePlugin);
  const compatibility = detailedTree(compatibilityPlugin);
  if (marketplace.some((row, index) => !sameRow(row, compatibility[index])) || marketplace.length !== compatibility.length) {
    conflict(marketplacePlugin, "Redundant pristine plugin copies do not match; modified-skill preservation is unavailable");
  }
  const receipt = readPluginReceipt(activePlugin);
  const peerDigest = treeHash(marketplacePlugin);
  if (receipt?.schema !== "litclaude.install-ownership/v1" || receipt.owner !== "litclaude-ai" || receipt.kind !== "plugin" || receipt.version !== installedVersion || receipt.sha256 !== peerDigest) {
    conflict(activePlugin, "Active plugin receipt does not authenticate the pristine redundant copies");
  }

  const activeByPath = treeMap(active), peerByPath = treeMap(marketplace);
  const changed = new Set([...activeByPath.keys(), ...peerByPath.keys()].filter((path) => !sameRow(activeByPath.get(path), peerByPath.get(path))));
  if (changed.size === 0) return null;
  if (marketplaceVersion !== installedVersion) {
    conflict(marketplacePlugin, "Marketplace and active plugin receipts do not identify the same installed version");
  }
  const legacyPrefix = "skills/lit-korean/";
  if ([...changed].some((path) => path !== "skills/lit-korean" && !path.startsWith(legacyPrefix))) {
    conflict(activePlugin, "Only changes under skills/lit-korean can be preserved automatically");
  }
  const skillStat = stat(skillPath);
  if (!skillStat || !skillStat.isDirectory() || skillStat.isSymbolicLink()) {
    conflict(skillPath, "The modified legacy skill has no safe copy to preserve");
  }
  const skillRows = detailedTree(skillPath, { receipt: true });
  return { activePlugin, skillPath, version: installedVersion, skillRows, sha256: rowsHash(skillRows) };
}

export function preserveModifiedLegacySkill(plan, litHome) {
  if (!plan) return null;
  const parent = join(litHome, "preserved-skills", "lit-korean", plan.version);
  const destination = join(parent, plan.sha256);
  const savedSkill = join(destination, "skill");
  assertInstallPath(litHome, destination);
  const verifySaved = () => {
    const metadataPath = join(destination, "preservation.json"), metadataStat = stat(metadataPath);
    if (!metadataStat || !metadataStat.isFile() || metadataStat.nlink !== 1 || metadataStat.size > 2048) conflict(destination, "An existing preservation path has no valid receipt");
    let metadata;
    try { metadata = JSON.parse(readFileSync(metadataPath, "utf8")); } catch { conflict(metadataPath, "Preservation receipt is invalid"); }
    if (metadata?.schema !== "litclaude.preserved-skill/v1" || metadata.skill !== "lit-korean" || metadata.version !== plan.version || metadata.sha256 !== plan.sha256) {
      conflict(destination, "An existing preservation path has conflicting provenance");
    }
    if (!sameRowList(detailedTree(savedSkill, { receipt: true }), plan.skillRows)) conflict(destination, "An existing preservation copy does not match the user-modified skill");
  };
  if (existsSync(destination)) {
    verifySaved();
    return destination;
  }

  mkdirSync(parent, { recursive: true });
  assertInstallPath(litHome, parent);
  const staging = join(parent, `.preserve-${randomUUID()}`);
  mkdirSync(staging, { recursive: false });
  try {
    const currentRows = detailedTree(plan.skillPath, { receipt: true });
    if (!sameRowList(currentRows, plan.skillRows)) conflict(plan.skillPath, "The legacy skill changed after the ownership preflight");
    cpSync(plan.skillPath, join(staging, "skill"), { recursive: true, errorOnExist: true, force: false });
    if (!sameRowList(detailedTree(join(staging, "skill"), { receipt: true }), plan.skillRows)) {
      conflict(plan.skillPath, "The staged preservation copy does not match the source");
    }
    writeFileSync(join(staging, "preservation.json"), `${JSON.stringify({
      schema: "litclaude.preserved-skill/v1", skill: "lit-korean", version: plan.version, sha256: plan.sha256,
    }, null, 2)}\n`, { flag: "wx" });
    assertInstallPath(litHome, parent);
    renameSync(staging, destination);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  verifySaved();
  return destination;
}

function sameRowList(left, right) {
  return left.length === right.length && left.every((row, index) => sameRow(row, right[index]));
}

export function assertOwnedTree(path, kind, version, { allowPreviousVersion = false, requirePresent = false } = {}) {
  const value = stat(path);
  if (!value) {
    if (requirePresent) conflict(path, "A registered installation tree is missing");
    return null;
  }
  if (!value.isDirectory() || value.isSymbolicLink()) conflict(path);
  const receiptPath = join(path, receiptName), receiptStat = stat(receiptPath);
  const digest = treeHash(path);
  if (!receiptStat) {
    if ((version === legacyVersion || (allowPreviousVersion && compareStableSemver(legacyVersion, version) <= 0)) && legacy046[kind] === digest) return legacyVersion;
    conflict(path, "No ownership receipt; this tree is not a supported pristine legacy baseline for the requested version. Do not move only the reported directory. Review the connected installation or use a separate trial profile; see package docs/migration.md#ownership-conflicts.");
  }
  if (!receiptStat.isFile() || receiptStat.nlink !== 1 || receiptStat.size > 2048) conflict(receiptPath);
  let receipt;
  try { receipt = JSON.parse(readFileSync(receiptPath, "utf8")); } catch { conflict(receiptPath); }
  if (receipt?.schema !== "litclaude.install-ownership/v1" || receipt.owner !== "litclaude-ai" || receipt.kind !== kind || (typeof receipt.version !== "string" || !stableVersion.test(receipt.version) || (allowPreviousVersion ? compareStableSemver(receipt.version, version) > 0 : receipt.version !== version)) || receipt.sha256 !== digest) conflict(path);
  return receipt.version;
}

export function migrateLegacyVendorPaths(receiptRoot, vendorRoot, kind, version) {
  const rootStat = stat(receiptRoot);
  if (!rootStat) return false;
  assertInstallPath(receiptRoot, vendorRoot);
  const moves = [];
  for (const [legacy, canonical, expected] of legacyVendorPathMap) {
    const oldPath = join(vendorRoot, legacy), newPath = join(vendorRoot, canonical), oldStat = stat(oldPath);
    if (!oldStat) continue;
    if (!oldStat.isDirectory() || oldStat.isSymbolicLink()) conflict(oldPath, "Numbered vendor path is not a regular directory");
    if (stat(newPath)) conflict(newPath, "Canonical vendor destination already exists");
    let oldDigest;
    try { oldDigest = treeHash(oldPath); } catch { conflict(oldPath, "Numbered vendor path is not a pristine owned tree"); }
    if (oldDigest !== expected) conflict(oldPath, "Numbered vendor path is not the manifest-owned pristine tree");
    moves.push([oldPath, newPath]);
  }
  if (moves.length === 0) return false;
  const receiptPath = join(receiptRoot, receiptName), receiptStat = stat(receiptPath);
  if (!receiptStat || !receiptStat.isFile() || receiptStat.nlink !== 1 || receiptStat.size > 2048) {
    conflict(receiptRoot, "A numbered vendor migration requires a valid ownership receipt");
  }
  let receipt;
  try { receipt = JSON.parse(readFileSync(receiptPath, "utf8")); } catch { conflict(receiptPath); }
  const beforeDigest = treeHash(receiptRoot);
  if (receipt?.schema !== "litclaude.install-ownership/v1" || receipt.owner !== "litclaude-ai" || receipt.kind !== kind || typeof receipt.version !== "string" || !stableVersion.test(receipt.version) || compareStableSemver(receipt.version, version) > 0 || receipt.sha256 !== beforeDigest) {
    conflict(receiptRoot, "Ownership receipt does not match the pristine tree");
  }
  for (const [oldPath, newPath] of moves) renameSync(oldPath, newPath);
  const afterDigest = treeHash(receiptRoot);
  writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, sha256: afterDigest }, null, 2)}\n`);
  return true;
}

export function writeOwnershipReceipt(path, kind, version) {
  writeFileSync(join(path, receiptName), `${JSON.stringify({ schema: "litclaude.install-ownership/v1", owner: "litclaude-ai", kind, version, sha256: treeHash(path) }, null, 2)}\n`, { flag: "wx" });
}

export function assertCurrentPointer(home, current, target, version, { expectedVersion } = {}) {
  assertInstallPath(home, dirname(current));
  const value = stat(current);
  if (!value) return null;
  let currentVersion;
  if (value.isSymbolicLink()) {
    const linked = resolve(dirname(current), readlinkSync(current));
    const linkedVersion = relative(dirname(target), linked);
    if (!stableVersion.test(linkedVersion) || compareStableSemver(linkedVersion, version) > 0 || !stat(linked)) conflict(current);
    assertInstallPath(home, linked);
    assertOwnedTree(linked, "compatibility", linkedVersion);
    currentVersion = linkedVersion;
  } else {
    currentVersion = assertOwnedTree(current, "compatibility", version, { allowPreviousVersion: true });
  }
  if (expectedVersion && currentVersion !== expectedVersion) conflict(current, "The active plugin registration and compatibility pointer do not match");
  return currentVersion;
}

export function removeEmptyDirectory(path) {
  try { rmdirSync(path); } catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error; }
}


export function assertOwnedRegistrations({ registry, settings, marketplaces, pluginKey, marketplaceName, marketplacePath, pluginParent, home, version, modifiedPluginRoot, modifiedPluginVersion }) {
  const sourceMatches = (value) => ownKeys(value, ["source", "path"]) && value.source === "directory" && value.path === marketplacePath;
  const registration = registeredPluginInstallation({ registry, pluginKey, pluginParent, home, version });
  if (registration && !(registration.installPath === modifiedPluginRoot && registration.version === modifiedPluginVersion)) {
    assertOwnedTree(registration.installPath, "plugin", registration.version);
  }
  const hud = settings.litclaude;
  if (hud?.statusLineManaged === true && (typeof hud.statusLineVersion !== "string" || !stableVersion.test(hud.statusLineVersion) || compareStableSemver(hud.statusLineVersion, version) > 0)) conflict("managed HUD version");
  const configured = settings.extraKnownMarketplaces?.[marketplaceName];
  if (configured !== undefined && (!ownKeys(configured, ["source"]) || !sourceMatches(configured.source))) conflict(`settings marketplace ${marketplaceName}`);
  const known = marketplaces[marketplaceName];
  if (known !== undefined && (!ownKeys(known, ["source", "installLocation", "lastUpdated"]) || !sourceMatches(known.source) || known.installLocation !== marketplacePath)) conflict(`known marketplace ${marketplaceName}`);
}

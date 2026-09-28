#!/usr/bin/env node
// Office runtime for lit-pptx and lit-docx.
//
// The deck engine needs pptxgenjs (and sharp for recoloured or mesh backgrounds); the
// Python helpers need python-pptx, python-docx, markdown, beautifulsoup4, pymupdf, pyyaml
// and defusedxml. None of them ship in the npm tarball. They install on first use from the
// pinned lockfiles in ./office-runtime-lock/ into a LitClaude-owned cache:
//
//   $LITCLAUDE_OFFICE_RUNTIME                        when set (tests, isolated probes)
//   ${XDG_CACHE_HOME:-~/.cache}/litclaude/office-runtime       otherwise
//
// Each environment lives in node-<key> or python-<key>. <key> hashes the lockfiles, the
// platform and the Python minor version, so a lockfile change or a new interpreter gets a
// fresh environment instead of mutating an old one.
// Nothing is installed globally and no harness configuration is touched. pandoc, XeLaTeX
// and LibreOffice (soffice) are optional host tools that are only reported, never installed.
//
//   node office-runtime.mjs status [--json]      readiness report, never installs
//   node office-runtime.mjs ensure [--node] [--python] [--json]
//   node office-runtime.mjs node-modules         ensure Node deps, print node_modules path
//   node office-runtime.mjs python               ensure Python deps, print the interpreter

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCK_DIR = fileURLToPath(new URL("./office-runtime-lock/", import.meta.url));
const NODE_LOCK_FILES = ["package.json", "package-lock.json"];
const PYTHON_LOCK_FILE = "requirements.lock";
const READY = ".litclaude-ready";
const MIN_PYTHON = [3, 10];
const STALE_LOCK_MS = 20 * 60 * 1000;

const HOST_TOOLS = [
  { id: "soffice", args: ["--version"], feature: "rendered pages; the QA gates fall back to structural checks" },
  { id: "pandoc", args: ["--version"], feature: "DOCX-to-Markdown and the publisher PDF path" },
  { id: "xelatex", args: ["--version"], feature: "publisher PDF output" },
];

const run = (command, args, options = {}) => spawnSync(command, args, { encoding: "utf8", ...options });

export function pythonCommand() {
  return process.env.LITCLAUDE_OFFICE_PYTHON || "python3";
}

export function probePython(command = pythonCommand()) {
  const probe = run(command, ["-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"]);
  if (probe.error || probe.status !== 0) return { ok: false, command, detail: (probe.stderr || probe.error?.message || "not found").trim() };
  const version = probe.stdout.trim();
  const [major, minor] = version.split(".").map(Number);
  const ok = major > MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor >= MIN_PYTHON[1]);
  return { ok, command, version, detail: ok ? version : `${version} is older than ${MIN_PYTHON.join(".")}` };
}

function lockDigest(files, extra) {
  const hash = createHash("sha256");
  for (const file of files) hash.update(readFileSync(path.join(LOCK_DIR, file)));
  hash.update(extra);
  return hash.digest("hex").slice(0, 12);
}

export function runtimeRoot() {
  if (process.env.LITCLAUDE_OFFICE_RUNTIME) return path.resolve(process.env.LITCLAUDE_OFFICE_RUNTIME);
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(homedir(), ".cache");
  return path.join(cacheHome, "litclaude", "office-runtime");
}

export function nodeRuntimeDir() {
  return path.join(runtimeRoot(), `node-${lockDigest(NODE_LOCK_FILES, `${process.platform}-${process.arch}`)}`);
}

export function pythonRuntimeDir(python = probePython()) {
  const minor = python.version ? python.version.split(".").slice(0, 2).join(".") : "none";
  return path.join(runtimeRoot(), `python-${lockDigest([PYTHON_LOCK_FILE], `${process.platform}-${process.arch}-py${minor}`)}`);
}

const venvPython = (dir) => (process.platform === "win32" ? path.join(dir, "Scripts", "python.exe") : path.join(dir, "bin", "python"));

const pinnedNodeVersions = () => JSON.parse(readFileSync(path.join(LOCK_DIR, "package.json"), "utf8")).dependencies;

function pinnedPythonPackages() {
  return readFileSync(path.join(LOCK_DIR, PYTHON_LOCK_FILE), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

// One installer per environment at a time. mkdir is atomic, so the directory itself is the lock;
// a lock older than STALE_LOCK_MS belongs to an installer that died and is taken over.
function withLock(dir, fn) {
  mkdirSync(path.dirname(dir), { recursive: true });
  const lock = `${dir}.lock`;
  const deadline = Date.now() + STALE_LOCK_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let age = 0;
      try { age = Date.now() - statSync(lock).mtimeMs; } catch { continue; }
      if (age > STALE_LOCK_MS) { rmSync(lock, { recursive: true, force: true }); continue; }
      if (Date.now() > deadline) throw new Error(`OFFICE_RUNTIME_LOCKED: ${lock} is held by another installer`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

const notice = (line) => process.stderr.write(`${line}\n`);

export function nodeStatus() {
  const dir = nodeRuntimeDir();
  const ready = existsSync(path.join(dir, READY));
  return { ready, dir, nodeModules: path.join(dir, "node_modules"), pinned: pinnedNodeVersions() };
}

export function ensureNode() {
  const status = nodeStatus();
  if (status.ready) return status;
  return withLock(status.dir, () => {
    if (existsSync(path.join(status.dir, READY))) return nodeStatus();
    rmSync(status.dir, { recursive: true, force: true });
    mkdirSync(status.dir, { recursive: true });
    for (const file of NODE_LOCK_FILES) copyFileSync(path.join(LOCK_DIR, file), path.join(status.dir, file));
    const pins = Object.entries(status.pinned).map(([name, version]) => `${name} ${version}`).join(", ");
    notice(`LitClaude office runtime: installing pinned Node packages (${pins}) into ${status.dir} — first use only.`);
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = run(npm, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], {
      cwd: status.dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0) {
      throw new Error(`OFFICE_RUNTIME_NODE_INSTALL_FAILED: npm ci exited ${result.status}: ${(result.stderr || result.error?.message || "").trim().slice(-600)}`);
    }
    writeFileSync(path.join(status.dir, READY), `${JSON.stringify({ pinned: status.pinned, at: new Date().toISOString() })}\n`);
    return nodeStatus();
  });
}

export function pythonStatus() {
  const python = probePython();
  const dir = pythonRuntimeDir(python);
  const ready = python.ok && existsSync(path.join(dir, READY)) && existsSync(venvPython(dir));
  return { ready, dir, interpreter: venvPython(dir), host: python, pinned: pinnedPythonPackages() };
}

export function ensurePython() {
  const status = pythonStatus();
  if (status.ready) return status;
  if (!status.host.ok) {
    throw new Error(`OFFICE_RUNTIME_PYTHON_UNAVAILABLE: ${status.host.command}: ${status.host.detail}. Install Python ${MIN_PYTHON.join(".")}+ or set LITCLAUDE_OFFICE_PYTHON.`);
  }
  return withLock(status.dir, () => {
    if (existsSync(path.join(status.dir, READY))) return pythonStatus();
    rmSync(status.dir, { recursive: true, force: true });
    notice(`LitClaude office runtime: creating a Python ${status.host.version} environment with ${status.pinned.length} pinned packages in ${status.dir} — first use only.`);
    const venv = run(status.host.command, ["-m", "venv", status.dir], { stdio: ["ignore", "pipe", "pipe"] });
    if (venv.error || venv.status !== 0) {
      throw new Error(`OFFICE_RUNTIME_VENV_FAILED: ${(venv.stderr || venv.error?.message || "").trim().slice(-600)}`);
    }
    const pip = run(venvPython(status.dir), [
      "-m", "pip", "install", "--only-binary=:all:", "--no-input", "--disable-pip-version-check", "--quiet",
      "-r", path.join(LOCK_DIR, PYTHON_LOCK_FILE),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    if (pip.error || pip.status !== 0) {
      throw new Error(`OFFICE_RUNTIME_PYTHON_INSTALL_FAILED: pip exited ${pip.status}: ${(pip.stderr || pip.error?.message || "").trim().slice(-600)}`);
    }
    writeFileSync(path.join(status.dir, READY), `${JSON.stringify({ python: status.host.version, at: new Date().toISOString() })}\n`);
    return pythonStatus();
  });
}

export function hostToolStatus() {
  return HOST_TOOLS.map(({ id, args, feature }) => {
    const probe = run(id, args, { stdio: ["ignore", "pipe", "pipe"], timeout: 20000 });
    const ok = !probe.error && probe.status === 0;
    const first = ok ? `${probe.stdout || probe.stderr}`.trim().split("\n")[0] : "not found on PATH";
    return { id, available: ok, detail: first, feature };
  });
}

export function officeRuntimeStatus() {
  const node = nodeStatus();
  const python = pythonStatus();
  return {
    root: runtimeRoot(),
    node: { ready: node.ready, dir: node.dir, pinned: node.pinned },
    python: { ready: python.ready, dir: python.dir, host: python.host, packages: python.pinned.length },
    hostTools: hostToolStatus(),
    firstUse: node.ready && python.ready ? "ready" : "installs on first lit-pptx or lit-docx run",
  };
}

function main(argv) {
  const [command = "status", ...rest] = argv;
  const json = rest.includes("--json");
  try {
    if (command === "status") {
      const status = officeRuntimeStatus();
      if (json) console.log(JSON.stringify(status, null, 2));
      else {
        console.log(`office runtime root: ${status.root}`);
        console.log(`node deps:   ${status.node.ready ? "ready" : "not installed (first use installs)"}`);
        console.log(`python deps: ${status.python.ready ? "ready" : status.python.host.ok ? "not installed (first use installs)" : `unavailable: ${status.python.host.detail}`}`);
        for (const tool of status.hostTools) console.log(`${tool.id.padEnd(8)} ${tool.available ? tool.detail : `missing; unavailable: ${tool.feature}`}`);
      }
      return 0;
    }
    if (command === "ensure") {
      const wantNode = rest.includes("--node") || !rest.includes("--python");
      const wantPython = rest.includes("--python") || !rest.includes("--node");
      const result = {};
      if (wantNode) result.node = ensureNode();
      if (wantPython) result.python = ensurePython();
      if (json) console.log(JSON.stringify(result, null, 2));
      else console.log("office runtime ready");
      return 0;
    }
    if (command === "node-modules") {
      console.log(ensureNode().nodeModules);
      return 0;
    }
    if (command === "python") {
      console.log(ensurePython().interpreter);
      return 0;
    }
    console.error(`unknown command: ${command}`);
    return 2;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

// Compare real paths: a temp or home directory reached through a symlink (/var -> /private/var)
// would otherwise make the script think it was imported and print nothing.
const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}

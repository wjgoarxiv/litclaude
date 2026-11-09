// How to start npm on this platform. Since the CVE-2024-27980 fix (Node 18.20.2, 20.12.2, 21.7.3
// and every 22+), Node refuses to spawn a .cmd or .bat file without a shell (spawnSync EINVAL), and
// npm on Windows is npm.cmd. When npm itself started us, npm_execpath names its npm-cli.js and this
// Node runs it with no shell at all. Otherwise the .cmd goes through cmd.exe with every argument
// quoted; an argument cmd.exe could still reinterpret inside quotes is refused, never passed on.
import { existsSync, readFileSync } from "node:fs";
import { win32 } from "node:path";

const CMD_SAFE = /^[\w@.,:=+/\\-]+$/u;
const CMD_UNSAFE = /["%\r\n]/u;

export const quoteForCmd = (arg) => {
  const text = String(arg);
  if (CMD_UNSAFE.test(text)) throw new Error(`refusing to pass ${JSON.stringify(text)} through cmd.exe`);
  // Trailing backslashes are doubled so the closing quote still ends the argument for node.
  return CMD_SAFE.test(text) ? text : `"${text.replace(/(\\+)$/u, "$1$1")}"`;
};

/** { command, args, shell } for spawn/spawnSync; `command` overrides the default npm binary. */
export function npmInvocation(args, { command, platform = process.platform, env = process.env, execPath = process.execPath } = {}) {
  if (platform !== "win32") return { command: command ?? "npm", args, shell: false };
  if (!command && /npm-cli\.c?js$/iu.test(env.npm_execpath ?? "")) {
    return { command: execPath, args: [env.npm_execpath, ...args], shell: false };
  }
  const bin = command ?? "npm.cmd";
  if (!/\.(?:cmd|bat)$/iu.test(bin)) return { command: bin, args, shell: false };
  return { command: quoteForCmd(bin), args: args.map(quoteForCmd), shell: true };
}

const NPM_SHIM_TARGET = /"%~?dp0%?\\([^"\r\n]+)"\s+%\*/gu;

const findOnWindowsPath = (name, env, exists) => {
  const extensions = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  // npm also writes an extensionless sh script beside each .cmd; Windows never runs it, so a bare
  // name is tried only with the PATHEXT extensions, the way cmd.exe resolves it.
  const names = extensions.some((ext) => name.toLowerCase().endsWith(ext.toLowerCase())) ? [name] : extensions.map((ext) => name + ext);
  if (/[\\/]/u.test(name)) return names.find((file) => exists(file)) ?? null;
  for (const dir of (env.PATH ?? env.Path ?? "").split(";").filter(Boolean)) {
    const found = names.map((file) => win32.join(dir, file)).find((file) => exists(file));
    if (found) return found;
  }
  return null;
};

/**
 * { command, args } that run an npm-installed CLI (claude, agent-browser, a language server) with
 * no shell. On Windows npm installs these as .cmd shims, which Node will not spawn without one, so
 * the name is found with PATHEXT and a shim is unwrapped to the script it launches (run with this
 * Node) or the binary. No argument passes through cmd.exe; a .cmd that is not an npm shim throws.
 * A name that is not on PATH comes back unchanged, so the spawn reports ENOENT as before.
 */
export function shellFreeCommand(name, args, {
  platform = process.platform, env = process.env, execPath = process.execPath,
  exists = existsSync, read = (file) => readFileSync(file, "utf8"),
} = {}) {
  if (platform !== "win32") return { command: name, args };
  const found = findOnWindowsPath(name, env, exists);
  if (!found) return { command: name, args };
  if (!/\.(?:cmd|bat)$/iu.test(found)) return { command: found, args };
  const target = [...read(found).matchAll(NPM_SHIM_TARGET)].at(-1)?.[1];
  if (!target) throw new Error(`${found} is not an npm shim and cannot run without a shell; put the program's .exe on PATH instead`);
  const resolved = win32.join(win32.dirname(found), target);
  return /\.[cm]?js$/iu.test(resolved) ? { command: execPath, args: [resolved, ...args] } : { command: resolved, args };
}

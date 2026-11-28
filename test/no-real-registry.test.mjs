import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { cliEnv } from "./helpers/cli-env.mjs";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const OPEN = "([{";
const CLOSE = ")]}";

// Past a string, template or comment that starts at i; i itself when none does.
const skipLiteral = (s, i) => {
  const c = s[i];
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < s.length && s[j] !== c) j += s[j] === "\\" ? 2 : 1;
    return j + 1;
  }
  if (c === "`") {
    let j = i + 1;
    while (j < s.length && s[j] !== "`") {
      if (s[j] === "\\") j += 2;
      else if (s[j] === "$" && s[j + 1] === "{") j = endOfGroup(s, j + 1) + 1;
      else j += 1;
    }
    return j + 1;
  }
  if (c === "/" && s[i + 1] === "/") {
    const j = s.indexOf("\n", i);
    return j < 0 ? s.length : j;
  }
  if (c === "/" && s[i + 1] === "*") {
    const j = s.indexOf("*/", i + 2);
    return j < 0 ? s.length : j + 2;
  }
  return i;
};

const endOfGroup = (s, open) => {
  let depth = 0;
  for (let i = open; i < s.length;) {
    const j = skipLiteral(s, i);
    if (j !== i) { i = j; continue; }
    if (OPEN.includes(s[i])) depth += 1;
    else if (CLOSE.includes(s[i]) && --depth === 0) return i;
    i += 1;
  }
  return s.length;
};

const topLevelParts = (text) => {
  const parts = [];
  let from = 0;
  let depth = 0;
  for (let i = 0; i < text.length;) {
    const j = skipLiteral(text, i);
    if (j !== i) { i = j; continue; }
    if (OPEN.includes(text[i])) depth += 1;
    else if (CLOSE.includes(text[i])) depth -= 1;
    else if (text[i] === "," && depth === 0) { parts.push(text.slice(from, i)); from = i + 1; }
    i += 1;
  }
  parts.push(text.slice(from));
  return parts;
};

// The nearest statement before `before` that declares `name`: its initializer up to the closing `;`, or a function's body.
const declarationOf = (source, name, before) => {
  const found = [...source.slice(0, before).matchAll(new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=|\\bfunction\\s+${name}\\b`, "gu"))].at(-1);
  if (!found) return "";
  const start = found.index + found[0].length;
  if (found[0].startsWith("function")) return source.slice(found.index, endOfGroup(source, source.indexOf("{", start)) + 1);
  let depth = 0;
  for (let i = start; i < source.length;) {
    const j = skipLiteral(source, i);
    if (j !== i) { i = j; continue; }
    if (OPEN.includes(source[i])) depth += 1;
    else if (CLOSE.includes(source[i])) depth -= 1;
    else if (source[i] === ";" && depth === 0) return source.slice(found.index, i);
    if (depth < 0) break;
    i += 1;
  }
  return source.slice(found.index);
};

const KEEPS_REGISTRY_OUT = [
  /\bcliEnv\(/u,
  /\b(?:LITCLAUDE_NO_UPDATE_CHECK|NO_UPDATE_NOTIFIER|LITCLAUDE_NO_AUTO_UPDATE|CI)\s*:\s*"1"/u,
  /["']--no-auto-update["']/u,
  /127\.0\.0\.1/u,
  /\bnpm_config_registry\s*:\s*registry\b/u,
];

const typesUpdate = (source) => /litclaude-ai\.js/u.test(source) && /[\[(,]\s*["']update["']\s*[,\])]/u.test(source);

// The env a spawn call hands over: its own text, plus the declaration of the variable or helper it names.
const envEvidence = (source, call, at) => {
  const named = /\benv\s*(?::\s*([A-Za-z_$][\w$]*)|(?=\s*[,}]))/u.exec(call);
  return named ? `${call}\n${declarationOf(source, named[1] ?? "env", at)}` : call;
};

// Lines of each spawn of the CLI that may carry the update verb and whose own env does not keep the registry out.
const unguardedUpdateSpawns = (source) => {
  if (!typesUpdate(source)) return [];
  const lines = [];
  for (const found of source.matchAll(/\b(?:spawnSync|spawn|execFileSync|execFile)\(/gu)) {
    const open = found.index + found[0].length - 1;
    const call = source.slice(open + 1, endOfGroup(source, open));
    const argv = topLevelParts(call)[1] ?? "";
    if (!call.includes("process.execPath") || !(/["']update["']/u.test(argv) || argv.includes("..."))) continue;
    if (!KEEPS_REGISTRY_OUT.some((pattern) => pattern.test(envEvidence(source, call, found.index)))) lines.push(source.slice(0, found.index).split("\n").length);
  }
  return lines;
};

const BARE = 'spawnSync(process.execPath, [bin, "update", "--yes"], { env: { ...process.env, HOME: home } });\n';
const withCli = (body) => `const bin = join(root, "bin/litclaude-ai.js");\n${body}`;

describe("no test reaches the real npm registry", () => {
  it("the shared CLI env carries the opt-out and an extra cannot remove it", () => {
    assert.equal(cliEnv({ PATH: "/bin" }).LITCLAUDE_NO_UPDATE_CHECK, "1");
    assert.equal(cliEnv({ LITCLAUDE_NO_UPDATE_CHECK: "" }).LITCLAUDE_NO_UPDATE_CHECK, "1");
    assert.equal(cliEnv({ LITCLAUDE_NO_UPDATE_CHECK: undefined }).LITCLAUDE_NO_UPDATE_CHECK, "1");
    assert.equal(cliEnv({ HOME: "/x" }).HOME, "/x");
  });

  it("the detector flags a bare update spawn and passes each way of keeping the registry out of that spawn", () => {
    assert.deepEqual(unguardedUpdateSpawns(withCli(BARE)), [2]);
    for (const guarded of [
      'spawnSync(process.execPath, [bin, "update"], { env: cliEnv({ HOME: home }) });\n',
      'spawnSync(process.execPath, [bin, "update"], { env: { HOME: home, LITCLAUDE_NO_UPDATE_CHECK: "1" } });\n',
      'spawnSync(process.execPath, [bin, "update"], { env: { HOME: home, NO_UPDATE_NOTIFIER: "1" } });\n',
      'spawnSync(process.execPath, [bin, "update"], { env: { HOME: home, LITCLAUDE_NO_AUTO_UPDATE: "1" } });\n',
      'spawnSync(process.execPath, [bin, "update"], { env: { HOME: home, CI: "1" } });\n',
      'spawnSync(process.execPath, [bin, "--no-auto-update", "update"], { env });\n',
      'spawnSync(process.execPath, [bin, "update"], { env: { npm_config_registry: "http://127.0.0.1:9/" } });\n',
    ]) assert.deepEqual(unguardedUpdateSpawns(withCli(guarded)), [], guarded);
  });

  it("a guard elsewhere in the file does not cover a spawn that has none", () => {
    for (const elsewhere of [
      'import { cliEnv } from "./helpers/cli-env.mjs";\n',
      'const registry = "http://127.0.0.1:9/";\n',
      'const other = { CI: "1" };\n',
      'spawnSync(process.execPath, [bin, "update"], { env: cliEnv({}) });\n',
    ]) assert.deepEqual(unguardedUpdateSpawns(withCli(`${elsewhere}${BARE}`)).length, 1, elsewhere);
    assert.equal(unguardedUpdateSpawns(withCli(`${BARE}${BARE}`)).length, 2);
  });

  it("an env named in the spawn is judged by what it is built from", () => {
    const named = (build) => withCli(`const env = (extra) => ${build};\nconst run = (args, extra) => spawnSync(process.execPath, [bin, ...args], { env: env(extra) });\nrun(["update"]);\n`);
    assert.equal(unguardedUpdateSpawns(named("({ HOME: home, ...extra })")).length, 1);
    assert.equal(unguardedUpdateSpawns(named("cliEnv({ HOME: home, ...extra })")).length, 0);
    const bound = withCli('const childEnv = { ...process.env };\nspawnSync(process.execPath, [bin, ...args], { env: childEnv });\nrun(["update"]);\n');
    assert.equal(unguardedUpdateSpawns(bound).length, 1);
    assert.equal(unguardedUpdateSpawns(bound.replace("{ ...process.env }", '{ ...process.env, CI: "1" }')).length, 0);
  });

  it("a spawn that cannot carry the update verb, or is not the CLI, is left alone", () => {
    assert.deepEqual(unguardedUpdateSpawns(withCli(`${BARE}spawnSync(process.execPath, [bin, "install"], { env: {} });\nspawnSync("tar", ["-xzf", f], {});\n`)), [2]);
    assert.deepEqual(unguardedUpdateSpawns('spawnSync(process.execPath, [bin, "update"]);\n'), []);
  });

  it("every spawn of the CLI that may carry the update verb keeps the registry out", () => {
    const offenders = [];
    for (const name of readdirSync(testDir).filter((file) => file.endsWith(".test.mjs") && file !== "no-real-registry.test.mjs")) {
      for (const line of unguardedUpdateSpawns(readFileSync(join(testDir, name), "utf8"))) offenders.push(`${name}:${line}`);
    }
    assert.deepEqual(offenders, [], "a spawn of the CLI that may type update must build its env with cliEnv() from helpers/cli-env.mjs, set an opt-out, pass --no-auto-update or point the registry at 127.0.0.1");
  });
});

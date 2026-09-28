import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

// A stand-in `npm` first on PATH: it records its arguments and environment, then fails, so a
// runtime installer can be driven up to its `npm ci` call without touching the network.
export const fakeNpm = () => {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-fake-npm-"));
  const log = join(dir, "npm.log");
  const bin = join(dir, "npm");
  writeFileSync(bin, `#!/bin/sh\n{ printf 'ARGS %s\\n' "$*"; env; } >> "${log}"\nexit 1\n`);
  chmodSync(bin, 0o755);
  const calls = () => readFileSync(log, "utf8").split(/^(?=ARGS )/mu).filter(Boolean).map((block) => {
    const [args, ...lines] = block.trimEnd().split("\n");
    return { args: args.slice("ARGS ".length), env: lines };
  });
  return { dir, path: `${dir}${delimiter}${process.env.PATH ?? ""}`, calls };
};

// What `npm install -g` exports to a postinstall script, in both spellings npm reads.
export const npmGlobalInstallEnv = {
  npm_config_global: "true",
  npm_config_location: "global",
  npm_config_prefix: "/tmp/litclaude-not-a-prefix",
  npm_config_dry_run: "true",
  NPM_CONFIG_GLOBAL: "true",
  npm_config_registry: "http://127.0.0.1:9/",
};

export const npmGlobalModeKeys = (env) => env.filter((line) => /^npm_config_(?:global|location|prefix|dry_run)=/iu.test(line));

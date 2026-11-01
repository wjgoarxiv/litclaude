#!/usr/bin/env node
// tools/test-shard.mjs — run one shard of the test suite: `node tools/test-shard.mjs <i>/<n>`.
//
// `node --test --test-shard` splits by file count, and a few motion and mark files take most of the
// suite's time, so the split here is by measured seconds (tools/test-shard-timings.json), largest
// file first onto the lightest shard. A test file missing from the table gets DEFAULT_SECONDS, so a
// new file always lands in some shard; the guard test (test/test-shards.test.mjs) proves that the
// shards together are exactly test/*.test.mjs, each file once.
//
// The flags and --import helpers are read from the `test` script in package.json, so a shard runs
// the same way `npm test` does. `--list` prints the shard's files instead of running them.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SHARD_COUNT = 4;
export const PROFILES = ['macos', 'linux'];
const DEFAULT_SECONDS = 30;
const TEST_GLOB = 'test/*.test.mjs';

export function listTestFiles(root = ROOT) {
  return readdirSync(join(root, 'test'))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => `test/${name}`);
}

export function loadTimings(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'tools', 'test-shard-timings.json'), 'utf8'));
}

// Seconds for a `test/<name>.test.mjs` path under one profile.
export function weightsFor(timings, profile) {
  const table = timings[profile] ?? {};
  return (file) => table[file.replace(/^test\//u, '')] ?? DEFAULT_SECONDS;
}

// Longest-processing-time-first. Ties break on the file name and on the lowest shard number, so the
// result depends only on the set of files and their weights, never on the order they are listed in.
export function assignShards(files, weight, count) {
  const shards = Array.from({ length: count }, () => ({ seconds: 0, files: [] }));
  const ordered = [...files].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1));
  for (const file of ordered) {
    const lightest = shards.reduce((best, shard) => (shard.seconds < best.seconds ? shard : best));
    lightest.files.push(file);
    lightest.seconds += weight(file);
  }
  return shards.map((shard) => shard.files.sort());
}

// The `npm test` arguments without the trailing glob.
export function testArgs(root = ROOT) {
  const script = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.test;
  const tokens = script.split(' ');
  if (tokens[0] !== 'node' || tokens.at(-1) !== TEST_GLOB) {
    throw new Error(`package.json "test" must be "node ... ${TEST_GLOB}" for test-shard to follow it, got: ${script}`);
  }
  return tokens.slice(1, -1);
}

export function parseSpec(spec, count = SHARD_COUNT) {
  const match = /^(\d+)\/(\d+)$/u.exec(spec ?? '');
  if (!match || Number(match[2]) !== count || Number(match[1]) < 1 || Number(match[1]) > count) {
    throw new Error(`shard must be <i>/${count} with 1 <= i <= ${count}, got: ${spec ?? '(none)'}`);
  }
  return Number(match[1]);
}

function main(argv) {
  const list = argv.includes('--list');
  const profileAt = argv.indexOf('--profile');
  const profile = profileAt === -1 ? (process.platform === 'darwin' ? 'macos' : 'linux') : argv[profileAt + 1];
  if (!PROFILES.includes(profile)) throw new Error(`--profile must be one of ${PROFILES.join(', ')}`);
  const spec = argv.find((arg, i) => !arg.startsWith('--') && argv[i - 1] !== '--profile');
  const index = parseSpec(spec);
  const files = assignShards(listTestFiles(), weightsFor(loadTimings(), profile), SHARD_COUNT)[index - 1];
  if (list) {
    process.stdout.write(`${files.join('\n')}\n`);
    return 0;
  }
  process.stdout.write(`test shard ${index}/${SHARD_COUNT} (${profile}): ${files.length} file(s)\n`);
  const result = spawnSync(process.execPath, ['--test', ...testArgs(), ...files], { cwd: ROOT, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`test-shard: ${error.message}\n`);
    process.exitCode = 1;
  }
}

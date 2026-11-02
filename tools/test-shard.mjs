#!/usr/bin/env node
// tools/test-shard.mjs — run one shard of the test suite: `node tools/test-shard.mjs <i>/<n>`.
//
// `node --test --test-shard` splits by file count, and a few motion and mark files take most of the
// suite's time, so the split here is by measured seconds (tools/test-shard-timings.json), largest
// file first onto the lightest shard. A test file missing from the table gets DEFAULT_SECONDS, so a
// new file always lands in some shard; the guard tests (test/test-shards.test.mjs,
// test/test-tiers.test.mjs) prove that the shards together are exactly test/*.test.mjs, each file
// once, and that every file sits in exactly one tier (tools/test-tiers.json).
//
// The flags and --import helpers live in TEST_RUN_FLAGS below, so a shard, the fast tier
// (`npm test`), the heavy tier (`npm run test:heavy`) and the whole suite (`npm run test:all`)
// all run `node --test` the same way. `--list` prints the shard's files instead of running them,
// and `--tier <fast|heavy|all>` shards only that tier (the heavy CI job shards `--tier heavy`).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SHARD_COUNT = 4;
export const PROFILES = ['macos', 'linux'];
export const TIERS = ['fast', 'heavy', 'all'];
const DEFAULT_SECONDS = 30;

// The `node --test` flags every runner uses: sequential files, a hung test fails with its name
// after 15 minutes instead of sitting until the job timeout (run 41412939749 printed nothing for
// 82 min), and a file whose tests are done never holds the runner open on a lingering handle.
export const TEST_RUN_FLAGS = [
  '--test',
  '--test-concurrency=1',
  '--test-timeout=900000',
  '--test-force-exit',
  '--import',
  './test/helpers/scrub-ambient-env.mjs',
  '--import',
  './test/helpers/motion-offline-prewarm.mjs',
];

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

// The `node --test` arguments every runner uses (see TEST_RUN_FLAGS).
export function testArgs() {
  return [...TEST_RUN_FLAGS];
}

// The tier's files: `heavy` is tools/test-tiers.json, `fast` is everything else, `all` is the
// whole suite. New files land in `fast` until they are classified heavy.
export function filesForTier(tier, root = ROOT) {
  if (!TIERS.includes(tier)) throw new Error(`tier must be one of ${TIERS.join(', ')}, got: ${tier ?? '(none)'}`);
  const all = listTestFiles(root);
  if (tier === 'all') return all;
  const heavy = new Set(loadTiers(root).heavy);
  return tier === 'heavy' ? all.filter((file) => heavy.has(file)) : all.filter((file) => !heavy.has(file));
}

export function loadTiers(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'tools', 'test-tiers.json'), 'utf8'));
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
  const tierAt = argv.indexOf('--tier');
  const tier = tierAt === -1 ? 'all' : argv[tierAt + 1];
  if (!TIERS.includes(tier)) throw new Error(`--tier must be one of ${TIERS.join(', ')}`);
  const spec = argv.find((arg, i) => !arg.startsWith('--') && argv[i - 1] !== '--profile' && argv[i - 1] !== '--tier');
  const index = parseSpec(spec);
  const files = assignShards(filesForTier(tier), weightsFor(loadTimings(), profile), SHARD_COUNT)[index - 1];
  if (list) {
    process.stdout.write(`${files.join('\n')}\n`);
    return 0;
  }
  process.stdout.write(`test shard ${index}/${SHARD_COUNT} (${profile}, ${tier}): ${files.length} file(s)\n`);
  const result = spawnSync(process.execPath, [...testArgs(), ...files], { cwd: ROOT, stdio: 'inherit' });
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

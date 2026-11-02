// test/test-tiers.test.mjs — every test file runs in exactly one tier.
//
// The fast tier (`npm test`) is the whole suite minus tools/test-tiers.json (`heavy`); the heavy
// tier (`npm run test:heavy`) is the render/Chrome/ffmpeg/motion files plus anything over ~60 s,
// which hold ~93% of the suite's macOS minutes. A file in neither tier never runs; a file in both
// runs twice. The release checklist runs both (`npm run test:all`).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shardModule = await import('../tools/test-shard.mjs');
const tierModule = await import('../tools/test-tier.mjs');
const { TIERS, TEST_RUN_FLAGS, filesForTier, loadTiers } = shardModule;
const { resolveTierFiles } = tierModule;

const allFiles = readdirSync(join(ROOT, 'test')).filter((name) => name.endsWith('.test.mjs')).sort();
const rel = (name) => `test/${name}`;

const EXPECTED_FLAGS = [
  '--test',
  '--test-concurrency=1',
  '--test-timeout=900000',
  '--test-force-exit',
  '--import',
  './test/helpers/scrub-ambient-env.mjs',
  '--import',
  './test/helpers/motion-offline-prewarm.mjs',
];

describe('test tiers: every test file runs in exactly one tier', () => {
  it('the heavy list names real test files, sorted and unique', () => {
    const { heavy } = loadTiers(ROOT);
    assert.ok(Array.isArray(heavy) && heavy.length > 0, 'heavy tier is empty');
    assert.deepEqual([...heavy].sort(), heavy, 'heavy tier is not sorted');
    assert.equal(new Set(heavy).size, heavy.length, 'heavy tier lists a file twice');
    for (const file of heavy) {
      assert.match(file, /^test\/[^/]+\.test\.mjs$/u, `${file} is not a top-level test file`);
      assert.ok(existsSync(join(ROOT, file)), `${file} does not exist`);
    }
  });

  it('fast and heavy partition test/*.test.mjs with no file in two tiers', () => {
    const heavy = new Set(loadTiers(ROOT).heavy);
    const fast = allFiles.map(rel).filter((file) => !heavy.has(file));
    assert.deepEqual([...filesForTier('fast', ROOT)].sort(), [...fast].sort());
    assert.deepEqual([...filesForTier('heavy', ROOT)].sort(), [...heavy].sort());
    assert.deepEqual([...filesForTier('all', ROOT)].sort(), allFiles.map(rel).sort());
    assert.equal(fast.length + heavy.size, allFiles.length, 'a test file is in no tier or in two');
  });

  it('a new test file lands in fast until it is classified heavy', () => {
    const fast = filesForTier('fast', ROOT);
    assert.ok(!fast.includes('test/brand-new-feature.test.mjs'));
    assert.ok(filesForTier('all', ROOT).length === allFiles.length);
  });

  it('rejects an unknown tier', () => {
    assert.throws(() => filesForTier('smoke', ROOT), /tier must be one of/u);
  });
});

describe('test tiers: every runner invokes node --test the same way', () => {
  it('the shared flags pin concurrency, hang timeouts and preloads', () => {
    assert.deepEqual([...TEST_RUN_FLAGS], EXPECTED_FLAGS);
  });

  it('npm scripts route each tier through the tier runner', () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
    assert.equal(scripts.test, 'node tools/test-tier.mjs fast');
    assert.equal(scripts['test:heavy'], 'node tools/test-tier.mjs heavy');
    assert.equal(scripts['test:all'], 'node tools/test-tier.mjs all');
  });

  it('the tier runner resolves the same files as the tier filter', () => {
    for (const tier of TIERS) {
      assert.deepEqual([...resolveTierFiles(tier, ROOT)].sort(), [...filesForTier(tier, ROOT)].sort());
    }
  });

  it('the tier runner --list prints the tier, and rejects an unknown tier', () => {
    for (const tier of TIERS) {
      const result = spawnSync(process.execPath, [join(ROOT, 'tools', 'test-tier.mjs'), tier, '--list'], {
        cwd: ROOT, encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.stdout.split('\n').filter(Boolean).sort(), [...filesForTier(tier, ROOT)].sort());
    }
    const bad = spawnSync(process.execPath, [join(ROOT, 'tools', 'test-tier.mjs'), 'smoke'], {
      cwd: ROOT, encoding: 'utf8',
    });
    assert.notEqual(bad.status, 0, 'an unknown tier was accepted');
  });
});

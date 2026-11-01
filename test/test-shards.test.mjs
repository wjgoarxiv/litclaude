// test/test-shards.test.mjs — the CI test shards cover every test file exactly once.
// ci.yml and ci-linux.yml run `npm run test:shard -- <i>/<n>` as parallel jobs. A file that falls
// out of every shard is a test nobody runs, and a file in two shards runs twice, so both are
// asserted here for each timing profile, together with the workflow matrices that start the shards.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shardModule = await import('../tools/test-shard.mjs');
const { SHARD_COUNT, PROFILES, assignShards, listTestFiles, loadTimings, testArgs, weightsFor } = shardModule;

const allFiles = readdirSync(join(ROOT, 'test')).filter((name) => name.endsWith('.test.mjs')).sort();
const rel = (name) => `test/${name}`;

describe('test shards: every test file runs in exactly one shard', () => {
  for (const profile of PROFILES) {
    it(`${profile}: the shards together are test/*.test.mjs, with no file in two shards`, () => {
      const shards = assignShards(listTestFiles(ROOT), weightsFor(loadTimings(), profile), SHARD_COUNT);
      assert.equal(shards.length, SHARD_COUNT);
      const flat = shards.flat();
      assert.deepEqual([...flat].sort(), allFiles.map(rel).sort(), 'union of the shards differs from test/*.test.mjs');
      assert.equal(new Set(flat).size, flat.length, 'a test file is in more than one shard');
      shards.forEach((shard, i) => assert.ok(shard.length > 0, `shard ${i + 1} is empty`));
    });

    it(`${profile}: the slowest shard is the biggest file or close to an even split`, () => {
      const weights = weightsFor(loadTimings(), profile);
      const shards = assignShards(listTestFiles(ROOT), weights, SHARD_COUNT);
      const seconds = shards.map((shard) => shard.reduce((sum, file) => sum + weights(file), 0));
      const total = seconds.reduce((a, b) => a + b, 0);
      const biggest = Math.max(...listTestFiles(ROOT).map(weights));
      assert.ok(Math.max(...seconds) <= Math.max(biggest, (total / SHARD_COUNT) * 1.2),
        `unbalanced shards (seconds): ${seconds.join(', ')}`);
    });
  }

  it('a new test file that is not in the timing table still lands in exactly one shard', () => {
    const weights = weightsFor(loadTimings(), PROFILES[0]);
    const files = [...listTestFiles(ROOT), 'test/brand-new-feature.test.mjs'];
    const shards = assignShards(files, weights, SHARD_COUNT);
    assert.equal(shards.filter((shard) => shard.includes('test/brand-new-feature.test.mjs')).length, 1);
    assert.equal(shards.flat().length, files.length);
  });

  it('the split does not depend on the order the files are listed in', () => {
    const weights = weightsFor(loadTimings(), PROFILES[0]);
    const files = listTestFiles(ROOT);
    assert.deepEqual(assignShards(files, weights, SHARD_COUNT), assignShards([...files].reverse(), weights, SHARD_COUNT));
  });

  it('fewer files than shards leaves no file out', () => {
    const shards = assignShards(['test/a.test.mjs', 'test/b.test.mjs'], () => 1, 4);
    assert.equal(shards.length, 4);
    assert.deepEqual(shards.flat().sort(), ['test/a.test.mjs', 'test/b.test.mjs']);
  });

  it('the timing table holds only positive seconds', () => {
    const timings = loadTimings();
    for (const profile of PROFILES) {
      for (const [file, seconds] of Object.entries(timings[profile] ?? {})) {
        assert.ok(Number.isFinite(seconds) && seconds > 0, `${profile} ${file}: ${seconds}`);
      }
    }
  });
});

describe('test shards: the command line', () => {
  const list = (spec, profile) => spawnSync(process.execPath, [join(ROOT, 'tools', 'test-shard.mjs'), spec, '--list', '--profile', profile], {
    cwd: ROOT, encoding: 'utf8',
  });

  it('--list prints each shard, and the four lists make up the whole suite once', () => {
    const lines = [];
    for (let i = 1; i <= SHARD_COUNT; i += 1) {
      const result = list(`${i}/${SHARD_COUNT}`, PROFILES[0]);
      assert.equal(result.status, 0, result.stderr);
      lines.push(...result.stdout.split('\n').filter(Boolean));
    }
    assert.deepEqual([...lines].sort(), allFiles.map(rel).sort());
  });

  it('rejects a shard spec that is out of range or malformed', () => {
    for (const spec of ['0/4', `${SHARD_COUNT + 1}/${SHARD_COUNT}`, '2/3', 'x', '1']) {
      assert.notEqual(list(spec, PROFILES[0]).status, 0, `${spec} was accepted`);
    }
  });

  it('runs node --test with exactly the flags and --import helpers of npm test', () => {
    const script = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.test;
    assert.equal(`node ${testArgs(ROOT).join(' ')} test/*.test.mjs`, script);
    assert.ok(testArgs(ROOT).includes('--test-concurrency=1'));
  });
});

describe('test shards: the workflows start every shard', () => {
  for (const name of ['ci.yml', 'ci-linux.yml']) {
    it(`${name} runs shards 1/${SHARD_COUNT} to ${SHARD_COUNT}/${SHARD_COUNT}, each once, and gates "verify" on them`, () => {
      const text = readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');
      const matrix = text.match(/^\s+shard: \[([^\]]*)\]\s*$/mu)?.[1];
      assert.ok(matrix, `${name} has no shard matrix`);
      const specs = matrix.split(',').map((s) => s.trim().replace(/^["']|["']$/gu, ''));
      assert.deepEqual(specs, Array.from({ length: SHARD_COUNT }, (_, i) => `${i + 1}/${SHARD_COUNT}`));
      assert.match(text, /run: npm run test:shard -- \$\{\{ matrix\.shard \}\}/u);
      assert.doesNotMatch(text, /run: npm test\s*$/mu, `${name} still runs the whole suite in one job`);
      assert.match(text, /^ {2}verify:\n(?:.*\n)*? {4}needs: \[test, gates\]/mu, `${name}: verify must need the test shards and the gates`);
      assert.match(text, /^ {4}if: \$\{\{ always\(\) \}\}/mu, `${name}: verify must run even when a shard fails`);
    });
  }
});

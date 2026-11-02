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
const { SHARD_COUNT, PROFILES, TIERS, assignShards, filesForTier, listTestFiles, loadTimings, testArgs, weightsFor } = shardModule;

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
  const list = (spec, profile, tier) => spawnSync(process.execPath, [join(ROOT, 'tools', 'test-shard.mjs'), spec, '--list', '--profile', profile, ...(tier ? ['--tier', tier] : [])], {
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

  it('shards use the shared node --test flags (pinned in test-tiers.test.mjs)', () => {
    // The exact flags are pinned by the tier guard; here the shard runner must use that same
    // shared list, so shards, fast tier, heavy tier and the whole suite invoke node --test alike.
    // A shard that stalls must fail with the hung test's name instead of sitting until the job
    // timeout (run 41412939749: shard 2 printed nothing for 82 min), and a file whose tests are
    // done must not hold the runner open on a lingering handle.
    assert.ok(testArgs().includes('--test-concurrency=1'));
    assert.ok(testArgs().includes('--test-timeout=900000'));
    assert.ok(testArgs().includes('--test-force-exit'));
  });

  it('--tier shards exactly that tier, once each', () => {
    for (const tier of TIERS) {
      const lines = [];
      for (let i = 1; i <= SHARD_COUNT; i += 1) {
        const result = list(`${i}/${SHARD_COUNT}`, PROFILES[0], tier);
        assert.equal(result.status, 0, result.stderr);
        lines.push(...result.stdout.split('\n').filter(Boolean));
      }
      assert.deepEqual([...lines].sort(), [...filesForTier(tier, ROOT)].sort());
    }
  });

  it('rejects an unknown --tier', () => {
    assert.notEqual(list(`1/${SHARD_COUNT}`, PROFILES[0], 'smoke').status, 0, 'an unknown tier was accepted');
  });
});

describe('test shards: the workflows split fast and heavy', () => {
  for (const name of ['ci.yml', 'ci-linux.yml']) {
    it(`${name} runs the fast tier unsharded and gates "verify" on it`, () => {
      const text = readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');
      assert.doesNotMatch(text, /test:shard/u, `${name} still shards the fast tier`);
      assert.match(text, /run: npm test\s*$/mu, `${name} does not run the fast tier`);
      const warm = text.indexOf('run: node bin/litclaude-ai.js motion-runtime install');
      assert.ok(warm > -1 && warm < text.indexOf('run: npm test'),
        `${name}: the fast tier must pre-warm the motion runtime before its tests, or render tests skip`);
      assert.match(text, /^ {2}verify:\n(?:.*\n)*? {4}needs: \[test, gates\]/mu, `${name}: verify must need the fast tier and the gates`);
      assert.match(text, /^ {4}if: \$\{\{ always\(\) \}\}/mu, `${name}: verify must run even when the tests fail`);
    });
  }

  it(`ci-heavy.yml runs the heavy tier as shards 1/${SHARD_COUNT} to ${SHARD_COUNT}/${SHARD_COUNT}, each once, and gates "verify" on them`, () => {
    const text = readFileSync(join(ROOT, '.github', 'workflows', 'ci-heavy.yml'), 'utf8');
    const matrix = text.match(/^\s+shard: \[([^\]]*)\]\s*$/mu)?.[1];
    assert.ok(matrix, 'ci-heavy.yml has no shard matrix');
    const specs = matrix.split(',').map((s) => s.trim().replace(/^["']|["']$/gu, ''));
    assert.deepEqual(specs, Array.from({ length: SHARD_COUNT }, (_, i) => `${i + 1}/${SHARD_COUNT}`));
    assert.match(text, /run: npm run test:shard -- --tier heavy \$\{\{ matrix\.shard \}\}/u);
    const warm = text.indexOf('run: node bin/litclaude-ai.js motion-runtime install');
    assert.ok(warm > -1 && warm < text.indexOf('run: npm run test:shard'),
      'ci-heavy.yml: a shard must pre-warm the motion runtime before its tests, or the render tests skip');
    assert.match(text, /^ {2}verify:\n(?:.*\n)*? {4}needs: \[test\]/mu, 'ci-heavy.yml: verify must need the heavy shards');
    assert.match(text, /^ {4}if: \$\{\{ always\(\) \}\}/mu, 'ci-heavy.yml: verify must run even when a shard fails');
  });

  it('ci-heavy.yml runs when heavy areas change, on demand, weekly, and on every main push', () => {
    const text = readFileSync(join(ROOT, '.github', 'workflows', 'ci-heavy.yml'), 'utf8');
    assert.match(text, /^on:\n(?:.*\n)*? {4}branches: \[main\]/mu, 'ci-heavy.yml: every main push needs a heavy run for release safety');
    assert.match(text, /pull_request:/u, 'ci-heavy.yml: PRs touching heavy areas need a heavy run');
    assert.match(text, /^\s+paths:/mu, 'ci-heavy.yml: PR pushes need a paths filter, or every doc edit pays for renders');
    for (const path of ['tools/test-tier.mjs', 'tools/test-tiers.json', 'tools/test-shard.mjs', 'package.json']) {
      assert.ok(text.includes(path), `ci-heavy.yml paths filter misses ${path}`);
    }
    assert.match(text, /workflow_dispatch:/u, 'ci-heavy.yml: the heavy tier needs a hand-run trigger');
    assert.match(text, /schedule:/u, 'ci-heavy.yml: the heavy tier needs a weekly schedule');
    assert.match(text, /cron:/u, 'ci-heavy.yml: the weekly schedule needs a cron');
  });
});

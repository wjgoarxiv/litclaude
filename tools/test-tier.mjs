#!/usr/bin/env node
// tools/test-tier.mjs — run one test tier: `node tools/test-tier.mjs <fast|heavy|all>`.
//
// Everyday work runs the fast tier (`npm test`): everything except the render/Chrome/ffmpeg/motion
// files listed in tools/test-tiers.json, which hold ~93% of the suite's macOS minutes. The heavy
// tier (`npm run test:heavy`) runs when those areas change; the release checklist runs both
// (`npm run test:all`). Flags come from tools/test-shard.mjs, so every runner invokes
// `node --test` the same way. `--list` prints the tier's files instead of running them.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { filesForTier, testArgs } = await import('./test-shard.mjs');

export function resolveTierFiles(tier, root = ROOT) {
  return filesForTier(tier, root);
}

function main(argv) {
  const list = argv.includes('--list');
  const tier = argv.find((arg) => !arg.startsWith('--')) ?? '(none)';
  const files = resolveTierFiles(tier);
  if (list) {
    process.stdout.write(`${files.join('\n')}\n`);
    return 0;
  }
  process.stdout.write(`test tier ${tier}: ${files.length} file(s)\n`);
  const result = spawnSync(process.execPath, [...testArgs(), ...files], { cwd: ROOT, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`test-tier: ${error.message}\n`);
    process.exitCode = 1;
  }
}

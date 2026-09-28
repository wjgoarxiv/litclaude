#!/usr/bin/env node
// tools/readme-for-npm.mjs — swap the npm package README in for a pack or publish.
//
// The repository README is the GitHub page: relative asset paths, the full guide.
// The npm page is a shorter card whose media are jsDelivr URLs pinned to the package
// version. npm reads README.md from the working tree, so the card has to sit there
// while npm packs or publishes, and the GitHub page has to come back afterwards.
//
//   apply    back up README.md and README_ko-KR.md under tmp/, copy the npm files over them
//   restore  put the backed-up originals back, byte for byte
//   check    assert the npm README invariants
//
// apply and restore nest: a publish script may call apply before `npm publish`, and npm's
// own prepack/postpack call them again inside it. Only the outermost restore writes the
// originals back, so the card stays in place while `npm publish` re-reads README.md.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PAIRS = Object.freeze([
  Object.freeze({ npm: 'README_npm.md', target: 'README.md', guide: 'https://github.com/wjgoarxiv/litclaude#readme' }),
  Object.freeze({ npm: 'README_npm_ko-KR.md', target: 'README_ko-KR.md', guide: 'https://github.com/wjgoarxiv/litclaude/blob/main/README_ko-KR.md' }),
]);
export const STATE_DIR = join('tmp', 'readme-for-npm');
export const MAX_README_BYTES = 65_536;
// The README motion rule: no inline medium above 2.5 MiB.
export const MAX_MEDIA_BYTES = 2_621_440;
const CDN_PREFIX = 'https://cdn.jsdelivr.net/npm/@litfamily/litclaude@';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const statePath = (root) => join(root, STATE_DIR, 'state.json');

function readState(root) {
  if (!existsSync(statePath(root))) return null;
  return JSON.parse(readFileSync(statePath(root), 'utf8'));
}

function writeState(root, state) {
  writeFileSync(statePath(root), `${JSON.stringify(state, null, 2)}\n`);
}

export function apply(root) {
  const state = readState(root);
  if (state) {
    for (const pair of PAIRS) {
      if (!readFileSync(join(root, pair.target)).equals(readFileSync(join(root, pair.npm)))) {
        throw new Error(`README_SWAP_STATE_STALE: ${STATE_DIR} exists but ${pair.target} is not the npm README; run restore first`);
      }
    }
    writeState(root, { ...state, depth: state.depth + 1 });
    return { action: 'nested', depth: state.depth + 1 };
  }
  mkdirSync(join(root, STATE_DIR), { recursive: true });
  const originals = {};
  for (const pair of PAIRS) {
    copyFileSync(join(root, pair.target), join(root, STATE_DIR, pair.target));
    originals[pair.target] = sha256(readFileSync(join(root, pair.target)));
  }
  writeState(root, { depth: 1, originals });
  for (const pair of PAIRS) copyFileSync(join(root, pair.npm), join(root, pair.target));
  return { action: 'applied', depth: 1 };
}

export function restore(root) {
  const state = readState(root);
  if (!state) return { action: 'none', depth: 0 };
  if (state.depth > 1) {
    writeState(root, { ...state, depth: state.depth - 1 });
    return { action: 'nested', depth: state.depth - 1 };
  }
  for (const pair of PAIRS) {
    const backup = join(root, STATE_DIR, pair.target);
    if (sha256(readFileSync(backup)) !== state.originals[pair.target]) {
      throw new Error(`README_SWAP_BACKUP_CHANGED: ${backup} no longer matches the saved original`);
    }
    copyFileSync(backup, join(root, pair.target));
  }
  rmSync(join(root, STATE_DIR), { recursive: true, force: true });
  try {
    rmdirSync(join(root, dirname(STATE_DIR)));
  } catch {
    // tmp/ holds something else; leave it.
  }
  return { action: 'restored', depth: 0 };
}

function references(text) {
  return [
    ...[...text.matchAll(/\b(?:src|srcset|href)="([^"]+)"/gu)].map((match) => match[1]),
    ...[...text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)/gu)].map((match) => match[1]),
  ];
}

function heroIdentity(text) {
  return [
    /<h1 align="center">([^<]+)<\/h1>/u.exec(text)?.[1],
    /<p align="center"><strong>([^<]+)<\/strong><\/p>/u.exec(text)?.[1],
  ];
}

function packageCovers(files, path) {
  return files.some((entry) => !entry.startsWith('!') && (entry === path || path.startsWith(`${entry.replace(/\/$/u, '')}/`)));
}

export function check(root) {
  const problems = [];
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const pinned = `${CDN_PREFIX}${pkg.version}/`;
  const state = readState(root);
  for (const pair of PAIRS) {
    const text = readFileSync(join(root, pair.npm), 'utf8');
    const githubPath = state ? join(root, STATE_DIR, pair.target) : join(root, pair.target);
    const github = readFileSync(githubPath, 'utf8');
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_README_BYTES) problems.push(`${pair.npm}: ${bytes} bytes exceeds ${MAX_README_BYTES}`);
    if (bytes * 2 > Buffer.byteLength(github)) problems.push(`${pair.npm}: not visibly shorter than the GitHub README`);
    if (!text.includes(pair.guide)) problems.push(`${pair.npm}: missing the GitHub full-guide link ${pair.guide}`);
    const [name, tagline] = heroIdentity(text);
    const [githubName, githubTagline] = heroIdentity(github);
    if (!name || name !== githubName || tagline !== githubTagline) problems.push(`${pair.npm}: name and tagline must match the GitHub README`);
    let pins = 0;
    for (const reference of references(text)) {
      if (reference.startsWith('#')) continue;
      if (!reference.startsWith('https://')) {
        problems.push(`${pair.npm}: relative or non-https target ${reference}`);
        continue;
      }
      if (!reference.startsWith(CDN_PREFIX)) continue;
      if (!reference.startsWith(pinned)) {
        problems.push(`${pair.npm}: CDN URL is not pinned to ${pkg.version}: ${reference}`);
        continue;
      }
      pins += 1;
      const packagePath = decodeURIComponent(reference.slice(pinned.length));
      const onDisk = join(root, packagePath);
      if (!existsSync(onDisk)) problems.push(`${pair.npm}: pinned target missing on disk: ${packagePath}`);
      else if (/\.(?:webp|png|gif|mp4|svg)$/iu.test(packagePath) && statSync(onDisk).size > MAX_MEDIA_BYTES) {
        problems.push(`${pair.npm}: ${packagePath} exceeds ${MAX_MEDIA_BYTES} bytes`);
      }
      if (!packageCovers(pkg.files ?? [], packagePath)) problems.push(`${pair.npm}: pinned target is not packed: ${packagePath}`);
    }
    if (pins === 0) problems.push(`${pair.npm}: no media pinned to ${pinned}`);
  }
  return problems;
}

function main(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const [command] = argv;
  if (command === 'apply' || command === 'restore') {
    const result = command === 'apply' ? apply(root) : restore(root);
    // stderr, so a prepack run never lands inside `npm pack --json` or `npm publish --json` output.
    process.stderr.write(`readme-for-npm ${command}: ${result.action} (depth ${result.depth})\n`);
    return 0;
  }
  if (command === 'check') {
    const problems = check(root);
    if (problems.length > 0) {
      process.stderr.write(`readme-for-npm check FAILED:\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n`);
      return 1;
    }
    process.stdout.write('readme-for-npm check OK\n');
    return 0;
  }
  process.stderr.write('usage: node tools/readme-for-npm.mjs <apply|restore|check>\n');
  return 64;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}

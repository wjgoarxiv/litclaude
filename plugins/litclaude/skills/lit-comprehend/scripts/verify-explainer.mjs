#!/usr/bin/env node
// Mechanical verification for a `lit-comprehend` explainer artifact.
//
//   node verify-explainer.mjs <artifact.html|artifact.md> [--repo <dir>] [--json]
//
// Prose can promise an artifact is accurate; only a checker can show it. The
// failures that matter most here are the ones that make a reader confidently
// wrong: a code block quoting a file that never contained those lines, a path
// that does not exist, a page that silently needs the network, or newlines
// collapsed by CSS so the code reads as one line.
//
// Exit 0 when no FAIL findings remain. WARN findings never fail the run.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, basename, extname, isAbsolute } from 'node:path';

const argv = process.argv.slice(2);
const jsonOut = argv.includes('--json');
const artifactArg = argv.find((a) => !a.startsWith('--'));
const repoIdx = argv.indexOf('--repo');
const repoRoot = resolve(repoIdx >= 0 && argv[repoIdx + 1] ? argv[repoIdx + 1] : '.');

if (!artifactArg) {
  console.error('usage: verify-explainer.mjs <artifact> [--repo <dir>] [--json]');
  process.exit(2);
}
const artifactPath = resolve(artifactArg);

const findings = [];
const fail = (check, detail) => findings.push({ level: 'FAIL', check, detail });
const warn = (check, detail) => findings.push({ level: 'WARN', check, detail });
const checksRun = new Set();
const ran = (name) => { checksRun.add(name); };

// ---------------------------------------------------------------- load

if (!existsSync(artifactPath)) {
  fail('artifact-exists', `no file at ${artifactPath}`);
  report();
}
const fileText0 = readFileSync(artifactPath, 'utf8');
const isHtml = ['.html', '.htm'].includes(extname(artifactPath).toLowerCase());

// Scan the document, not its commentary. A comment that names `fetch(` or shows
// example quiz markup is documentation about the rules, and flagging it would
// train authors to delete the explanations that keep the scaffold usable.
const raw = fileText0
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (m, body) =>
    m.replace(body, body.replace(/^[ \t]*\/\/.*$/gm, '')));

ran('artifact-exists');
if (raw.trim().length < 400) fail('artifact-nonempty', `only ${raw.length} bytes — that is not an explainer`);

// ------------------------------------------------- naming and location

ran('filename-dated');
if (!/^\d{4}-\d{2}-\d{2}-/.test(basename(artifactPath))) {
  fail('filename-dated', `basename "${basename(artifactPath)}" must start with YYYY-MM-DD- so the directory stays time-sorted`);
}

ran('outside-repo');
const rel = relative(repoRoot, artifactPath);
if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
  fail('outside-repo', `artifact sits inside the repo at ${rel} — it will end up in a diff or a commit; write it under ~/.litclaude/lit-comprehend/ instead`);
}

// ------------------------------------------------------ self-contained

ran('self-contained');
const externalPatterns = [
  [/<script[^>]+\bsrc\s*=\s*["']?(?!data:)[^"'>]*\/\//i, '<script src> pointing off-host'],
  [/<link[^>]+\bhref\s*=\s*["']?[^"'>]*\/\/[^"'>]*["']?[^>]*\brel\s*=\s*["']?stylesheet/i, 'external stylesheet <link>'],
  [/<link[^>]+\brel\s*=\s*["']?stylesheet[^>]*\bhref\s*=\s*["']?[^"'>]*\/\//i, 'external stylesheet <link>'],
  [/<img[^>]+\bsrc\s*=\s*["']?(?!data:)[^"'>]*\/\//i, 'remote <img src>'],
  [/<iframe[^>]+\bsrc\s*=\s*["']?(?!data:)[^"'>]*\/\//i, 'remote <iframe>'],
  [/@import\s+(url\()?["']?[^"')]*\/\//i, 'remote @import'],
  [/\bfetch\s*\(/, 'fetch() call'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bimportScripts\s*\(/, 'importScripts()'],
  [/<script[^>]+\btype\s*=\s*["']?module["']?[^>]*\bsrc=/i, 'module script src'],
];
for (const [re, what] of externalPatterns) {
  if (re.test(raw)) fail('self-contained', `${what} found — the artifact must open with no network at all`);
}

// -------------------------------------------------- canonical sections

const SECTIONS = ['한눈에', '이미 알고 있던 것', '직관', '바뀐 것', '퀴즈', '다음'];
const OPTIONAL = ['직접 만져보기'];
ran('sections');
const headings = [...raw.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)]
  .map(([, , contents]) => contents.replace(/<[^>]*>/g, '').replace(/\s+/gu, ' ').trim());
for (const s of SECTIONS) {
  if (!headings.includes(s)) {
    fail('sections', `canonical heading "${s}" is missing — heading text is shared across LitFamily harnesses`);
  }
}
if (!OPTIONAL.some((s) => headings.includes(s))) {
  warn('sections', 'no 직접 만져보기 (micro-world) section — expected unless the change is purely structural');
}

// ---------------------------------------------------- code block hygiene

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

const stripTags = (s) => s.replace(/<[^>]*>/g, '');

const preBlocks = [...raw.matchAll(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/gi)]
  .map((m) => ({ attrs: m[1], inner: m[2] }));

if (isHtml) {
  ran('newlines-preserved');
  // Multi-line code rendered outside <pre> collapses unless the CSS says otherwise.
  const cssHasPreWrap = /white-space\s*:\s*pre(-wrap|-line)?/i.test(raw);
  const codeDivs = [...raw.matchAll(/<div[^>]*class\s*=\s*["'][^"']*\bcode\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)];
  for (const d of codeDivs) {
    if (d[1].includes('\n') && !cssHasPreWrap) {
      fail('newlines-preserved', 'a multi-line code container is not <pre> and no white-space:pre-wrap rule exists — the browser will collapse it to one line');
    }
  }
  if (preBlocks.length === 0) warn('newlines-preserved', 'no <pre> code blocks found at all');
}

// -------------------------------------------- quoted code really exists

ran('quotes-real');
let quotedBlocks = 0;
for (const blk of preBlocks) {
  const srcMatch = blk.attrs.match(/\bdata-src\s*=\s*["']([^"']+)["']/i);
  if (!srcMatch) continue;
  quotedBlocks++;
  // A data-src may carry a line anchor: "path/to/file.mjs:120-148"
  const srcRaw = srcMatch[1].trim();
  const srcPath = srcRaw.replace(/:\d+(-\d+)?$/, '');
  const abs = isAbsolute(srcPath) ? srcPath : resolve(repoRoot, srcPath);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    fail('quotes-real', `code block cites ${srcRaw} but no such file exists — the artifact is describing code that is not there`);
    continue;
  }
  const fileText = readFileSync(abs, 'utf8');
  // Deleted lines legitimately will not be in the current file; drop them.
  const innerNoDel = blk.inner.replace(/<span[^>]*class\s*=\s*["'][^"']*\bdel\b[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '');
  const lines = decode(stripTags(innerNoDel))
    .split('\n')
    .map((l) => l.replace(/^\s*[+-]\s?/, '').trim())
    .filter((l) => l.length >= 8)
    .filter((l) => !/^(\/\/|#|\/\*|\*)?\s*(…|\.\.\.)\s*$/.test(l))
    .filter((l) => !/[…]/.test(l));
  if (lines.length === 0) continue;
  const hits = lines.filter((l) => fileText.includes(l));
  const ratio = hits.length / lines.length;
  if (ratio < 0.6) {
    const missed = lines.filter((l) => !fileText.includes(l)).slice(0, 3);
    fail('quotes-real',
      `only ${hits.length}/${lines.length} quoted lines are present in ${srcPath} — phantom quote. e.g. ${missed.map((m) => JSON.stringify(m.slice(0, 60))).join(', ')}`);
  }
}
// An artifact that quotes code but attributes none of it has opted out of the
// one check that catches a confidently-wrong explanation. Observed in practice:
// runs skip data-src unless it is required, and the phantom-quote check then
// silently grades nothing.
if (isHtml && quotedBlocks === 0) {
  if (preBlocks.length > 0) {
    fail('quotes-real', `${preBlocks.length} code block(s) carry no data-src attribute — attribute each excerpt to the file it came from so the quote can be checked against that file`);
  } else {
    warn('quotes-real', 'no code excerpts at all — a walkthrough of a code change normally quotes the code it is explaining');
  }
}

// ------------------------------------------------- referenced repo paths

ran('paths-exist');
const codeSpans = [...raw.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/gi)].map((m) => decode(stripTags(m[1])).trim());
const mdTicks = isHtml ? [] : [...raw.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());
const EXT = /\.(mjs|cjs|js|ts|tsx|jsx|md|json|jsonl|py|ya?ml|html|sh|toml|txt)$/i;
const seenPaths = new Set();
for (const tok of [...codeSpans, ...mdTicks]) {
  const t = tok.replace(/:\d+(-\d+)?$/, '');
  if (!t.includes('/') || !EXT.test(t)) continue;
  if (/^(https?:|~|\/|\.{1,2}\/\.\.)/.test(t)) continue;
  if (/[\s()<>"']/.test(t)) continue;
  if (seenPaths.has(t)) continue;
  seenPaths.add(t);
  if (!existsSync(resolve(repoRoot, t))) {
    warn('paths-exist', `referenced path ${t} does not exist under ${repoRoot} (fine if the change deleted it — otherwise the artifact is wrong)`);
  }
}

// ------------------------------------------------------------- diagrams

ran('no-ascii-art');
const asciiArtRe = /[┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬▲▼◄►]/;
const bodyOutsidePre = raw.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, '');
if (asciiArtRe.test(bodyOutsidePre)) {
  fail('no-ascii-art', 'box-drawing characters found outside code blocks — diagrams must be HTML/CSS so they survive wrapping and carry emphasis');
}
const plainAscii = [...bodyOutsidePre.matchAll(/^\s*\+[-+]{4,}\+\s*$/gm)];
if (plainAscii.length) fail('no-ascii-art', 'ASCII box diagram (+----+) found outside code blocks');

// ----------------------------------------------------------------- quiz

if (isHtml) {
  ran('quiz');
  const qBlocks = [...raw.matchAll(/<div[^>]*class\s*=\s*["'][^"']*\bquiz-q\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class\s*=\s*["'][^"']*\bquiz-q\b|<\/div>\s*<\/div>|<h2|<section|$)/gi)];
  // Fall back to a simpler split when the greedy structure above misfires.
  const chunks = raw.split(/<div[^>]*class\s*=\s*["'][^"']*\bquiz-q\b/i).slice(1);
  const questions = chunks.map((c) => {
    const answerMatch = c.match(/^[^>]*\bdata-answer\s*=\s*["'](\d+)["']/i);
    const opts = [...c.matchAll(/<button[^>]*class\s*=\s*["'][^"']*\bopt\b[^"']*["'][^>]*\bdata-i\s*=\s*["'](\d+)["'][^>]*>([\s\S]*?)<\/button>/gi)];
    const fbs = [...c.matchAll(/<div[^>]*class\s*=\s*["'][^"']*\bfb\b[^"']*["'][^>]*\bdata-i\s*=\s*["'](\d+)["'][^>]*>([\s\S]*?)<\/div>/gi)];
    return {
      answer: answerMatch ? parseInt(answerMatch[1], 10) : null,
      opts: opts.map((o) => ({ i: parseInt(o[1], 10), text: decode(stripTags(o[2])).trim() })),
      fbIdx: new Set(fbs.map((f) => parseInt(f[1], 10))),
    };
  });

  if (questions.length < 3) {
    fail('quiz', `only ${questions.length} quiz questions found — a comprehension check needs at least 3 (5 for a normal session)`);
  }
  questions.forEach((q, n) => {
    const label = `Q${n + 1}`;
    if (q.answer === null) { fail('quiz', `${label} has no data-answer attribute`); return; }
    if (q.opts.length < 3) fail('quiz', `${label} has ${q.opts.length} options — need at least 3`);
    if (!q.opts.some((o) => o.i === q.answer)) fail('quiz', `${label} data-answer=${q.answer} matches no option`);
    for (const o of q.opts) {
      if (!q.fbIdx.has(o.i)) {
        fail('quiz', `${label} option ${o.i} has no feedback block — every option teaches, including the correct one`);
      }
    }
  });

  // Positional tell: readers learn the slot before they learn the material.
  const answers = questions.map((q) => q.answer).filter((a) => a !== null);
  if (answers.length >= 3) {
    if (new Set(answers).size === 1) {
      fail('quiz', `every correct answer sits in position ${answers[0]} — vary it`);
    }
    for (let i = 0; i + 2 < answers.length; i++) {
      if (answers[i] === answers[i + 1] && answers[i + 1] === answers[i + 2]) {
        fail('quiz', `positions ${i + 1}-${i + 3} all have the answer in slot ${answers[i]} — vary it`);
      }
    }
  }
  // Length tell: "the longest option is the right one" is a learnable shortcut.
  let longestIsAnswer = 0, comparable = 0;
  for (const q of questions) {
    if (q.answer === null || q.opts.length < 2) continue;
    comparable++;
    const lens = q.opts.map((o) => o.text.length);
    const max = Math.max(...lens);
    const ansOpt = q.opts.find((o) => o.i === q.answer);
    if (ansOpt && ansOpt.text.length === max) longestIsAnswer++;
  }
  if (comparable >= 3 && longestIsAnswer / comparable > 0.6) {
    warn('quiz', `the correct option is the longest in ${longestIsAnswer}/${comparable} questions — readers pick up on that; even out the option lengths and move detail into the feedback`);
  }
  if (qBlocks.length === 0 && chunks.length === 0) {
    fail('quiz', 'no .quiz-q blocks found — use the scaffold markup so the quiz is interactive and checkable');
  }
}

// --------------------------------------------------------------- report

function report() {
  const fails = findings.filter((f) => f.level === 'FAIL');
  const warns = findings.filter((f) => f.level === 'WARN');
  if (jsonOut) {
    console.log(JSON.stringify({
      artifact: artifactPath, repo: repoRoot,
      checks: [...checksRun].sort(), failures: fails, warnings: warns,
      verdict: fails.length ? 'FAIL' : 'PASS',
    }, null, 2));
  } else {
    console.log(`lit-comprehend verify — ${artifactPath}`);
    console.log(`  checks run: ${[...checksRun].sort().join(', ')}`);
    for (const f of fails) console.log(`  FAIL [${f.check}] ${f.detail}`);
    for (const w of warns) console.log(`  WARN [${w.check}] ${w.detail}`);
    console.log(fails.length
      ? `  VERDICT: FAIL — ${fails.length} blocking finding(s), ${warns.length} warning(s)`
      : `  VERDICT: PASS — ${checksRun.size} checks, 0 blocking findings, ${warns.length} warning(s)`);
  }
  process.exit(fails.length ? 1 : 0);
}

report();

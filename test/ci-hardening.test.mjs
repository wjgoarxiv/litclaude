// test/ci-hardening.test.mjs — T06 DEC-E hardening gates.
// node:test — no external deps. Shells out with spawnSync.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CI_YML = resolve(ROOT, '.github', 'workflows', 'ci.yml');

// Forbidden tokens — assembled from fragments to avoid self-tripping.
const FORBIDDEN = [
  ['npm', ' ', 'publish'].join(''),
  ['NPM', '_TOKEN'].join(''),
  ['NODE', '_AUTH', '_TOKEN'].join(''),
  ['git', ' push'].join(''),
  ['git', ' tag'].join(''),
  ['--access', ' public'].join(''),
  ['id', '-token'].join(''),
];

function run(script) {
  return spawnSync('npm', ['run', script], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  });
}

describe('ci-hardening: check:version', () => {
  it('exits 0 (package.json version === plugin.json version)', () => {
    const result = run('check:version');
    assert.equal(result.status, 0,
      `check:version exited ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  });
});

describe('ci-hardening: assert:ci', () => {
  it('exits 0 against the new ci.yml', () => {
    const result = run('assert:ci');
    assert.equal(result.status, 0,
      `assert:ci exited ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  });
});

describe('ci-hardening: ci.yml structure', () => {
  it('ci.yml exists', () => {
    assert.ok(existsSync(CI_YML), `ci.yml not found at ${CI_YML}`);
  });

  it('contains permissions: and contents: read', () => {
    const text = readFileSync(CI_YML, 'utf8');
    assert.ok(text.includes('permissions:'), 'missing permissions:');
    assert.ok(text.includes('contents: read'), 'missing contents: read');
  });

  it('contains none of the forbidden tokens (case-insensitive)', () => {
    const text = readFileSync(CI_YML, 'utf8').toLowerCase();
    const found = FORBIDDEN.filter(t => text.includes(t.toLowerCase()));
    assert.deepEqual(found, [],
      `ci.yml contains forbidden token(s): ${found.join(', ')}`);
  });

  it('runs the zero-dependency package without lockfile-only cache or install steps', () => {
    const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.deepEqual(packageJson.dependencies ?? {}, {});
    assert.deepEqual(packageJson.devDependencies ?? {}, {});
    assert.equal(existsSync(join(ROOT, 'package-lock.json')), false);

    const text = readFileSync(CI_YML, 'utf8');
    assert.doesNotMatch(text, /^\s*cache:\s*["']?npm["']?\s*$/mu);
    assert.doesNotMatch(text, /^\s*run:\s*npm\s+(?:ci|install)\b/mu);
  });
});

describe('ci-hardening: every local gate is actually enforced in CI', () => {
  // A gate that exists in package.json but not in ci.yml is a gate nobody runs on a PR.
  // check:skill-resources is the specific one that was missing, and it is the ONLY
  // detector of an unpinned resource: doctor verifies what the manifest lists, so a file
  // added without regenerating is invisible to it. This list is the regression pin.
  const REQUIRED_CI_SCRIPTS = [
    'npm test',
    'npm run validate:plugin',
    'npm run doctor',
    'npm run check:skill-resources',
    'npm run check:runtime-closures',
    'npm run check:version',
    'npm run assert:ci',
    'npm run scan:legacy-tokens',
    'npm run pack:payload-guard',
  ];

  it('ci.yml runs every required gate', () => {
    const text = readFileSync(CI_YML, 'utf8');
    const missing = REQUIRED_CI_SCRIPTS.filter((script) => !text.includes(script));
    assert.deepEqual(missing, [], `ci.yml does not run: ${missing.join(', ')}`);
  });
});

describe('ci-hardening: check:skill-resources detects unpinned drift', () => {
  it('exits 0 on the current tree', () => {
    const result = run('check:skill-resources');
    assert.equal(result.status, 0, `check:skill-resources exited ${result.status}\n${result.stdout}${result.stderr}`);
  });

  // Negative control for the gate itself, run in an ISOLATED workspace.
  //
  // The first version of this test mutated plugins/litclaude/lib/strict-json.mjs in the real
  // tree and restored it in a finally block. That is a race: `node --test` runs test FILES
  // concurrently, three other suites shell out to `doctor` / `check:skill-resources` /
  // `pack:payload-guard`, and while the file was mutated those gates FAIL. A suite that
  // happened to overlap the window died outside the assertion counter — a nonzero exit with
  // `# fail 0`. A test proving the integrity gate detects drift must not create real drift.
  //
  // The generator resolves PLUGIN_ROOT relative to cwd, so a temp workspace is enough.
  const buildWorkspace = () => {
    const dir = mkdtempSync(join(tmpdir(), 'litclaude-drift-'));
    const write = (rel, body) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    };
    write('tools/gen-canonical-skill-resources.mjs', readFileSync(join(ROOT, 'tools', 'gen-canonical-skill-resources.mjs')));
    write('plugins/litclaude/bundled-rules/windows-git-bash.md', '# fixture\n');
    write('plugins/litclaude/bundled-rules/lit-humanizer.md', readFileSync(join(ROOT, 'plugins', 'litclaude', 'bundled-rules', 'lit-humanizer.md')));
    write('plugins/litclaude/lib/added-comment-lines.mjs', 'export const extract = () => [];\n');
    write('plugins/litclaude/lib/canonical-frontend-commitments.mjs', 'export const commitments = {};\n');
    write('plugins/litclaude/lib/canonical-frontend-corpus.mjs', 'export const verify = () => true;\n');
    write('plugins/litclaude/lib/canonical-runtime-commitments.mjs', 'export const commitments = {};\n');
    write('plugins/litclaude/lib/canonical-runtime-closures.mjs', 'export const verify = () => true;\n');
    write('plugins/litclaude/lib/deliverable-hedge-guard.mjs', 'export const guard = () => true;\n');
    write('plugins/litclaude/lib/durable-plan.mjs', 'export const resolve = () => undefined;\n');
    write('plugins/litclaude/lib/immutable-expected-file-map.mjs', 'export const immutable = () => true;\n');
    write('plugins/litclaude/lib/secure-path-read.mjs', 'export const read = () => true;\n');
    write('plugins/litclaude/lib/office-runtime.mjs', 'export const status = {};\n');
    write('plugins/litclaude/lib/office-runtime-lock/package.json', '{}\n');
    write('plugins/litclaude/lib/office-runtime-lock/package-lock.json', '{}\n');
    write('plugins/litclaude/lib/office-runtime-lock/requirements.lock', '# fixture\n');
    write('plugins/litclaude/lib/office_runtime_bootstrap.py', '# fixture\n');
    write('plugins/litclaude/lib/office_data.py', '# fixture\n');
    write('plugins/litclaude/lib/ooxml_integrity.py', '# fixture\n');
    write('plugins/litclaude/lib/render_pages.py', '# fixture\n');
    write('plugins/litclaude/lib/owner-lock.mjs', 'export const lock = {};\n');
    write('plugins/litclaude/lib/lit-mark.mjs', 'export const standard = [];\n');
    write('plugins/litclaude/lib/rename-aliases.mjs', 'export const renameAliases = {};\n');
    write('plugins/litclaude/lib/secret-shapes.mjs', 'export const containsSecret = () => false;\n');
    write('plugins/litclaude/lib/plan-task-rows.mjs', 'export const parse = () => [];\n');
    write('plugins/litclaude/lib/rules/engine.mjs', 'export const rules = [];\n');
    write('plugins/litclaude/lib/strict-json.mjs', 'export const parse = JSON.parse;\n');
    write('plugins/litclaude/lib/wikify-knowledge-cli.mjs', 'export const run = () => true;\n');
    write('plugins/litclaude/lib/wikify-knowledge.mjs', 'export const capture = () => true;\n');
    write('plugins/litclaude/scripts/scaffold-plan.mjs', 'export const scaffold = {};\n');
    write('plugins/litclaude/skills/frontend-ui-ux/SKILL.md', '# fixture\n');
    write('plugins/litclaude/skills/readme-studio/SKILL.md', '# fixture\n');
    write('plugins/litclaude/skills/autoconference/SKILL.md', '# fixture\n');
    write('plugins/litclaude/skills/autoresearch/SKILL.md', '# fixture\n');
    write('plugins/litclaude/skills/browser-drive/scripts/capability-probe.mjs', 'export const probe = {};\n');
    write('plugins/litclaude/skills/lit-comprehend/SKILL.md', '# fixture\n');
    write('plugins/litclaude/skills/lit-diagram-drawer/SKILL.md', '# fixture\n');
    write('plugins/litclaude/skills/lit-docx/SKILL.md', '# fixture\n');
    write('plugins/litclaude/skills/lit-pptx/SKILL.md', '# fixture\n');
    write('plugins/litclaude/skills/lit-comprehend/scripts/verify-explainer.mjs', 'export const verify = () => true;\n');
    write('plugins/litclaude/skills/litresearch/ATTRIBUTION.md', '# fixture\n');
    write('plugins/litclaude/skills/litwork/SKILL.md', '# fixture\n');
    write('plugins/litclaude/skills/lit-team/SKILL.md', '# fixture\n');
    write('plugins/litclaude/skills/lit-typographic-motion/SKILL.md', '# fixture\n');
    write('plugins/litclaude/skills/lit-code/SKILL.md', '# fixture\n');
    write('plugins/litclaude/skills/debugging/SKILL.md', '# fixture\n');
    write('plugins/litclaude/skills/lit-team/scripts/team.mjs', 'export const team = {};\n');
    write('plugins/litclaude/skills/visual-qa/SKILL.md', '# fixture\n');
    write('plugins/litclaude/skills/wikify/SKILL.md', '# fixture\n');
    cpSync(join(ROOT, 'plugins', 'litclaude', 'skills', 'lit-humanizer'), join(dir, 'plugins', 'litclaude', 'skills', 'lit-humanizer'), { recursive: true });
    write('plugins/litclaude/vendor/canonical-runtime-closures.json', '{"fixture":true}\n');
    write('plugins/litclaude/lib/canonical-skill-resources.mjs', '');
    return dir;
  };

  const gen = (dir, ...args) =>
    spawnSync(process.execPath, [join(dir, 'tools', 'gen-canonical-skill-resources.mjs'), ...args], {
      cwd: dir,
      encoding: 'utf8',
    });

  // The fixture must carry every file the generator pins, or the isolated run exercises a
  // different runtime shape than the package: a pinned-but-absent helper makes seeding fail
  // (or, worse, a future fixture that papers over it would prove nothing about the real set).
  it('mirrors every generator-pinned file in the isolated fixture', () => {
    const source = readFileSync(join(ROOT, 'tools', 'gen-canonical-skill-resources.mjs'), 'utf8');
    const block = source.match(/const PINNED_FILES = \[([^\]]*)\]/u)?.[1];
    assert.ok(block, 'PINNED_FILES must be present in the generator');
    const pinned = [...block.matchAll(/"([^"]+)"/gu)].map(([, rel]) => rel);
    assert.ok(pinned.includes('lib/secret-shapes.mjs'),
      'sanity: the generator pins the shared secret-shapes helper');
    const dir = buildWorkspace();
    try {
      const missing = pinned.filter((rel) => !existsSync(join(dir, 'plugins', 'litclaude', rel)));
      assert.deepEqual(missing, [],
        `isolated fixture is missing generator-pinned file(s): ${missing.join(', ')}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects BOTH drift kinds, without touching the real tree', () => {
    const dir = buildWorkspace();
    try {
      assert.equal(gen(dir).status, 0, 'seeding the manifest must succeed');
      assert.equal(gen(dir, '--check').status, 0, 'a freshly generated manifest is clean');

      // (1) a pinned resource CHANGED
      writeFileSync(join(dir, 'plugins/litclaude/lib/strict-json.mjs'), 'export const parse = () => 1;\n');
      const changed = gen(dir, '--check');
      assert.notEqual(changed.status, 0, 'a changed pinned resource must fail');
      assert.match(`${changed.stdout}${changed.stderr}`, /DRIFT/u);
      assert.match(`${changed.stdout}${changed.stderr}`, /changed\s+lib\/strict-json\.mjs/u);

      // (2) a resource ADDED but never pinned — the case doctor structurally cannot see
      assert.equal(gen(dir).status, 0);
      writeFileSync(join(dir, 'plugins/litclaude/skills/visual-qa/unpinned.mjs'), '// new\n');
      const unpinned = gen(dir, '--check');
      assert.notEqual(unpinned.status, 0, 'an unpinned resource must fail');
      assert.match(`${unpinned.stdout}${unpinned.stderr}`, /unpinned\s+skills\/visual-qa\/unpinned\.mjs/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves the real tree untouched', () => {
    assert.equal(run('check:skill-resources').status, 0);
  });
});

describe('ci-hardening: pack:payload-guard', () => {
  it('exits 0 (no forbidden paths in npm pack output)', () => {
    const result = run('pack:payload-guard');
    assert.equal(result.status, 0,
      `pack:payload-guard exited ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  });

  it('rejects a rogue packed path through the executable CLI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'litclaude-pack-cli-negative-'));
    try {
      mkdirSync(join(dir, 'tools'), { recursive: true });
      cpSync(join(ROOT, 'plugins'), join(dir, 'plugins'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
        name: 'litclaude-pack-cli-negative',
        version: '1.0.0',
        type: 'module',
        files: ['plugins'],
      })}\n`);
      cpSync(join(ROOT, 'tools', 'check-pack-payload.mjs'), join(dir, 'tools', 'check-pack-payload.mjs'));
      const rogue = join(dir, 'plugins', 'litclaude', 'vendor', 'rogue', 'HANDOFF.md');
      mkdirSync(dirname(rogue), { recursive: true });
      writeFileSync(rogue, 'rogue packed path\n');

      const result = spawnSync(process.execPath, [join(dir, 'tools', 'check-pack-payload.mjs')], {
        cwd: dir,
        encoding: 'utf8',
      });
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /plugins\/litclaude\/vendor\/rogue\/HANDOFF\.md/u);
      assert.match(result.stderr, /forbidden file\(s\) found/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('omits planted nested local state from the actual machine-readable dry pack', () => {
    const dir = mkdtempSync(join(tmpdir(), 'litclaude-pack-nested-state-'));
    const planted = [
      'plugins/litclaude/skills/wikify/.litclaude/claims.jsonl',
      'plugins/litclaude/vendor/llm-wikify/.litclaude/settings.json',
      'plugins/litclaude/.claude-plugin/.litclaude/marker.txt',
    ];
    try {
      cpSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
      cpSync(join(ROOT, 'plugins'), join(dir, 'plugins'), { recursive: true });
      for (const relativePath of planted) {
        const path = join(dir, relativePath);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, 'planted local state\n');
      }

      const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
        cwd: dir,
        encoding: 'utf8',
        shell: false,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const report = JSON.parse(result.stdout);
      const files = report[0].files.map(({ path }) => path);
      assert.deepEqual(files.filter((path) => planted.includes(path)), []);
      assert.equal(files.includes('plugins/litclaude/.claude-plugin/plugin.json'), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ci-hardening: pack guard path-shape coverage', () => {
  // The guard used to match SINGULAR forms only and printed "none forbidden" while real
  // leaks shipped. Each path below is a shape that previously slipped through.
  const MUST_BLOCK = [
    'plugins/litclaude/skills/visual-qa/scripts/tests/leak_helper.py',
    'plugins/litclaude/skills/visual-qa/fixture/sample.json',
    'scripts/scratch-notes.txt',
    'plugins/litclaude/__tests__/a.mjs',
    'plugins/litclaude/skills/x/testing/helper.mjs',
    'plugins/litclaude/lib/a.spec.mjs',
    'plugins/litclaude/skills/x/spec/internal.md',
    'tmp/scratch.md',
    '.DS_Store',
    'test/a.mjs',
    'plugins/litclaude/lib/a.test.mjs',
    'plugins/litclaude/.claude/skills/private/SKILL.md',
  ];

  // Deliberate exceptions — these ship by design and must NOT be blocked.
  const MUST_SHIP = [
    'plugins/litclaude/vendor/handoff/templates/HANDOFF.md',
    'plugins/litclaude/vendor/scientific-visualization/tests/test_style_presets.py',
    'plugins/litclaude/vendor/scientific-visualization/tests/test_figure_export.py',
    'plugins/litclaude/lib/rules/glob.mjs',
    'plugins/litclaude/skills/litwork/SKILL.md',
    'docs/rules.md',
    'docs/assets/cover-motion-still.webp',
    'docs/assets/litclaude-ignition-1600.webp',
    'docs/assets/litclaude-continuity-1600.webp',
    'docs/assets/litfamily-machines.png',
    'docs/assets/readme/ascii-readme.svg',
    'docs/assets/readme/lucide-book-open.svg',
    'docs/assets/readme/lucide-play.svg',
    'docs/assets/readme/lucide-shield-check.svg',
    'docs/assets/readme/ignition-film.mp4',
    'docs/assets/readme/ignition-poster.png',
    'docs/assets/readme/ignition-readme.gif',
    'docs/assets/readme/Lucide-LICENSE.txt',
    'docs/assets/readme/JetBrainsMono-OFL.txt',
    'scripts/scaffold-plan.mjs',
  ];

  it('blocks every previously-slipping path shape', async () => {
    const { findOffenders } = await import('../tools/check-pack-payload.mjs');
    const missed = MUST_BLOCK.filter((p) => findOffenders([p]).length === 0);
    assert.deepEqual(missed, [], `pack guard would ship: ${missed.join(', ')}`);
  });

  it('does not block legitimate payload or the approved exceptions', async () => {
    const { findOffenders } = await import('../tools/check-pack-payload.mjs');
    const blocked = MUST_SHIP.filter((p) => findOffenders([p]).length > 0);
    assert.deepEqual(blocked, [], `pack guard would wrongly reject: ${blocked.join(', ')}`);
  });

  it('keeps the allowlist to exact paths so it cannot widen', async () => {
    const { APPROVED_PAYLOAD_PATHS, findOffenders } = await import('../tools/check-pack-payload.mjs');
    for (const approved of APPROVED_PAYLOAD_PATHS) {
      assert.doesNotMatch(approved, /[*?]/u, `${approved} must be an exact path, not a glob`);
    }
    // A sibling of an approved path is NOT covered by it.
    assert.equal(findOffenders(['plugins/litclaude/vendor/scientific-visualization/tests/sneaky.py']).length, 1);
  });

  it('rejects every file beneath an unpinned top-level skill directory', async () => {
    const { findUnpinnedSkillPaths } = await import('../tools/check-pack-payload.mjs');
    assert.deepEqual(findUnpinnedSkillPaths([
      'plugins/litclaude/skills/x/SKILL.md',
      'plugins/litclaude/skills/x/scripts/helper.mjs',
      'plugins/litclaude/skills/litwork/SKILL.md',
    ]), [
      'plugins/litclaude/skills/x/SKILL.md',
      'plugins/litclaude/skills/x/scripts/helper.mjs',
    ]);
  });
});

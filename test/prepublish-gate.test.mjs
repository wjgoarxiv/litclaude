import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);
const packageMetadata = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

function createFixture(testScript) {
  const directory = mkdtempSync(join(tmpdir(), "litclaude-prepublish-gate-"));
  const gateScript = new URL("../scripts/prepublish-test-gate.mjs", import.meta.url);
  const scriptsDirectory = join(directory, "scripts");
  mkdirSync(scriptsDirectory);
  writeFileSync(join(scriptsDirectory, "prepublish-test-gate.mjs"), readFileSync(gateScript, "utf8"));
  writeFileSync(join(directory, "package.json"), JSON.stringify({
    name: "litclaude-prepublish-gate-fixture",
    version: packageMetadata.version,
    scripts: {
      prepublishOnly: packageMetadata.scripts.prepublishOnly,
      test: testScript,
    },
  }));
  writeFileSync(join(directory, ".npmrc"), "registry=http://127.0.0.1:9/\noffline=true\n");
  writeFileSync(join(directory, ".global.npmrc"), "registry=http://127.0.0.1:9/\noffline=true\n");
  return directory;
}

function runNpm(args, directory) {
  const env = {
    ...process.env,
    npm_config_audit: "false",
    npm_config_cache: join(directory, "npm-cache"),
    npm_config_fund: "false",
    npm_config_globalconfig: join(directory, ".global.npmrc"),
    npm_config_offline: "true",
    npm_config_registry: "http://127.0.0.1:9/",
    npm_config_update_notifier: "false",
    npm_config_userconfig: join(directory, ".npmrc"),
  };
  const npmExecPath = process.env.npm_execpath;
  return npmExecPath
    ? spawnSync(process.execPath, [npmExecPath, ...args], {
      cwd: directory,
      encoding: "utf8",
      env,
      timeout: 30_000,
    })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
      cwd: directory,
      encoding: "utf8",
      env,
      shell: process.platform === "win32",
      timeout: 30_000,
    });
}

function publishDryRun(directory) {
  return runNpm([
    "publish",
    "--dry-run",
    "--offline",
    "--registry=http://127.0.0.1:9/",
    "--loglevel=error",
  ], directory);
}

function outputOf(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function assertPublishRefused(result, expectedOutput) {
  assert.equal(result.error, undefined, `npm must be runnable: ${result.error?.message}`);
  assert.equal(result.signal, null, "the publish probe must exit normally");
  assert.notEqual(result.status, 0, "npm publish must refuse the fixture package");
  const output = outputOf(result);
  assert.match(output, expectedOutput);
  assert.doesNotMatch(output, /ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH/u);
}

test("npm publish refuses when the test suite fails", (t) => {
  assert.equal(packageMetadata.scripts.prepublishOnly, "node scripts/prepublish-test-gate.mjs");
  const marker = "LITCLAUDE_FIXTURE_TEST_FAILURE";
  const directory = createFixture("node fail.mjs");
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  writeFileSync(
    join(directory, "fail.mjs"),
    `process.stderr.write(${JSON.stringify(marker)}); process.exitCode = 23;\n`,
  );

  assertPublishRefused(publishDryRun(directory), new RegExp(marker, "u"));
});

test("npm publish refuses when the test command cannot start", (t) => {
  assert.equal(packageMetadata.scripts.prepublishOnly, "node scripts/prepublish-test-gate.mjs");
  const missingCommand = "litclaude_missing_test_runner_sentinel";
  const directory = createFixture(missingCommand);
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  assertPublishRefused(publishDryRun(directory), new RegExp(missingCommand, "u"));
});

test("npm publish dry-run clears inherited dry-run before the test suite packs", (t) => {
  const directory = createFixture("node pack-from-test.mjs");
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  writeFileSync(join(directory, "pack-from-test.mjs"), [
    'import { spawnSync } from "node:child_process";',
    'import { existsSync } from "node:fs";',
    'import { join } from "node:path";',
    'const npmExecPath = process.env.npm_execpath;',
    'const args = ["pack", "--ignore-scripts", "--json"];',
    'const result = npmExecPath',
    '  ? spawnSync(process.execPath, [npmExecPath, ...args], { cwd: process.cwd(), encoding: "utf8" })',
    '  : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, { cwd: process.cwd(), encoding: "utf8", shell: process.platform === "win32" });',
    'if (result.error || result.signal !== null || result.status !== 0) {',
    '  process.stderr.write(`NESTED_PACK_FAILED: ${result.error?.message ?? result.signal ?? result.status}\\n`);',
    '  process.exitCode = 1;',
    '} else {',
    '  const filename = JSON.parse(result.stdout)[0]?.filename;',
    '  if (!filename || !existsSync(join(process.cwd(), filename))) {',
    '    process.stderr.write(`NESTED_PACK_MISSING: ${filename ?? "unknown"}\\n`);',
    '    process.exitCode = 1;',
    '  } else {',
    '    process.stdout.write(`NESTED_PACK_CREATED: ${filename}\\n`);',
    '  }',
    '}',
  ].join("\n"));

  const result = publishDryRun(directory);
  assert.equal(result.error, undefined, `npm publish must be runnable: ${result.error?.message}`);
  assert.equal(result.status, 0, outputOf(result));
  const expectedArchive = `litclaude-prepublish-gate-fixture-${packageMetadata.version}.tgz`;
  assert.ok(outputOf(result).includes(`NESTED_PACK_CREATED: ${expectedArchive}`));
  assert.doesNotMatch(outputOf(result), /NESTED_PACK_(?:FAILED|MISSING)/u);
});

test("npm pack and install do not run the publish-only test gate", (t) => {
  assert.equal(packageMetadata.scripts.prepublishOnly, "node scripts/prepublish-test-gate.mjs");
  const marker = "LITCLAUDE_PACK_OR_INSTALL_MUST_NOT_RUN_TESTS";
  const directory = createFixture("node fail.mjs");
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  writeFileSync(
    join(directory, "fail.mjs"),
    `process.stderr.write(${JSON.stringify(marker)}); process.exitCode = 23;\n`,
  );

  const packed = runNpm(["pack", "--dry-run", "--offline", "--loglevel=error"], directory);
  assert.equal(packed.error, undefined, `npm pack must be runnable: ${packed.error?.message}`);
  assert.equal(packed.status, 0, outputOf(packed));
  assert.doesNotMatch(outputOf(packed), new RegExp(marker, "u"));

  const consumer = join(directory, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({
    name: "litclaude-prepublish-consumer",
    version: packageMetadata.version,
  }));
  const installed = runNpm([
    "install",
    "--prefix",
    consumer,
    directory,
    "--offline",
    "--registry=http://127.0.0.1:9/",
    "--loglevel=error",
  ], consumer);
  assert.equal(installed.error, undefined, `npm install must be runnable: ${installed.error?.message}`);
  assert.equal(installed.status, 0, outputOf(installed));
  assert.doesNotMatch(outputOf(installed), new RegExp(marker, "u"));
});

const SHA = "a".repeat(40);
const ciEnv = { GITHUB_ACTIONS: "true", GITHUB_SHA: SHA, GITHUB_REPOSITORY: "wjgoarxiv/litclaude", GITHUB_TOKEN: "t" };
const cleanGit = (args) => (args[0] === "rev-parse" ? SHA : "");
const answer = (body, status = 200) => async () => ({ ok: status === 200, status, json: async () => body });
const greenRun = { workflow_runs: [{ id: 7, head_sha: SHA, conclusion: "success" }] };

test("a CI publish passes the gate only when ci.yml passed on the same clean commit", async () => {
  const { ciVerdict } = await import("../scripts/prepublish-test-gate.mjs");
  let asked = "";
  const fetchImpl = async (url, init) => {
    asked = url;
    assert.equal(init.headers.authorization, "Bearer t");
    return answer(greenRun)();
  };
  const verdict = await ciVerdict({ env: ciEnv, fetchImpl, git: cleanGit });
  assert.equal(verdict.ok, true, verdict.reason);
  assert.match(asked, /\/repos\/wjgoarxiv\/litclaude\/actions\/workflows\/ci\.yml\/runs\?head_sha=a{40}&status=success&event=push/u);
});

test("a CI publish is refused without a green ci.yml run for that commit", async () => {
  const { ciVerdict } = await import("../scripts/prepublish-test-gate.mjs");
  const refusals = [
    [{ env: ciEnv, fetchImpl: answer({ workflow_runs: [] }), git: cleanGit }, /no successful ci\.yml/u],
    [{ env: ciEnv, fetchImpl: answer({ workflow_runs: [{ id: 7, head_sha: "b".repeat(40), conclusion: "success" }] }), git: cleanGit }, /no successful/u],
    [{ env: ciEnv, fetchImpl: answer({ workflow_runs: [{ id: 7, head_sha: SHA, conclusion: "failure" }] }), git: cleanGit }, /no successful/u],
    [{ env: ciEnv, fetchImpl: answer({}, 403), git: cleanGit }, /answered 403/u],
    [{ env: ciEnv, fetchImpl: async () => { throw new Error("offline"); }, git: cleanGit }, /unreachable: offline/u],
    [{ env: ciEnv, fetchImpl: answer(greenRun), git: (args) => (args[0] === "rev-parse" ? "c".repeat(40) : "") }, /checkout is not/u],
    [{ env: ciEnv, fetchImpl: answer(greenRun), git: (args) => (args[0] === "rev-parse" ? SHA : " M lib/x.mjs") }, /local changes/u],
    [{ env: { ...ciEnv, GITHUB_ACTIONS: undefined }, fetchImpl: answer(greenRun), git: cleanGit }, /not a GitHub Actions run/u],
    [{ env: { ...ciEnv, GITHUB_REPOSITORY: "x/y?z=1" }, fetchImpl: answer(greenRun), git: cleanGit }, /not a GitHub Actions run/u],
  ];
  for (const [input, reason] of refusals) {
    const verdict = await ciVerdict(input);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, reason);
  }
});

test("npm publish outside the CI publish still runs the full suite", (t) => {
  const marker = "LITCLAUDE_FIXTURE_SUITE_RAN";
  const directory = createFixture("node fail.mjs");
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  writeFileSync(join(directory, "fail.mjs"), `process.stderr.write(${JSON.stringify(marker)}); process.exitCode = 23;\n`);
  const previous = process.env.LITCLAUDE_PUBLISH_FROM_CI;
  delete process.env.LITCLAUDE_PUBLISH_FROM_CI;
  try {
    assertPublishRefused(publishDryRun(directory), new RegExp(marker, "u"));
  } finally {
    if (previous !== undefined) process.env.LITCLAUDE_PUBLISH_FROM_CI = previous;
  }
});

test("a CI publish outside GitHub Actions is refused instead of skipping the suite", (t) => {
  const directory = createFixture("node fail.mjs");
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  writeFileSync(join(directory, "fail.mjs"), "process.exitCode = 0;\n");
  const saved = { from: process.env.LITCLAUDE_PUBLISH_FROM_CI, actions: process.env.GITHUB_ACTIONS };
  process.env.LITCLAUDE_PUBLISH_FROM_CI = "1";
  delete process.env.GITHUB_ACTIONS;
  try {
    assertPublishRefused(publishDryRun(directory), /prepublish test gate refused: not a GitHub Actions run/u);
  } finally {
    if (saved.from === undefined) delete process.env.LITCLAUDE_PUBLISH_FROM_CI; else process.env.LITCLAUDE_PUBLISH_FROM_CI = saved.from;
    if (saved.actions !== undefined) process.env.GITHUB_ACTIONS = saved.actions;
  }
});

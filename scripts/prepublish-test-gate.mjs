import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// publish.yml sets LITCLAUDE_PUBLISH_FROM_CI. There the suite has already run in ci.yml, so the gate
// only proves that ci.yml passed on this exact, unmodified commit and refuses the publish otherwise.
// Everywhere else (a local npm publish, ci.yml itself) the full suite runs as before.
export async function ciVerdict({ env, fetchImpl = fetch, git = runGit }) {
  const sha = env.GITHUB_SHA ?? "";
  const repository = env.GITHUB_REPOSITORY ?? "";
  if (env.GITHUB_ACTIONS !== "true" || !/^[0-9a-f]{40}$/u.test(sha) || !/^[\w.-]+\/[\w.-]+$/u.test(repository)) {
    return { ok: false, reason: "not a GitHub Actions run with a commit and repository" };
  }
  if (git(["rev-parse", "HEAD"]) !== sha) return { ok: false, reason: `checkout is not ${sha}` };
  if (git(["status", "--porcelain"]) !== "") return { ok: false, reason: "checkout has local changes" };
  const url = `https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs`
    + `?head_sha=${sha}&status=success&event=push&per_page=1`;
  const headers = { accept: "application/vnd.github+json" };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  let body;
  try {
    const response = await fetchImpl(url, { headers });
    if (!response.ok) return { ok: false, reason: `GitHub API answered ${response.status}` };
    body = await response.json();
  } catch (error) {
    return { ok: false, reason: `GitHub API unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
  const run = Array.isArray(body?.workflow_runs) ? body.workflow_runs[0] : undefined;
  if (run?.head_sha !== sha || run?.conclusion !== "success") {
    return { ok: false, reason: `no successful ci.yml push run for ${sha}` };
  }
  return { ok: true, reason: `ci.yml run ${run.id} passed on ${sha}` };
}

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function runSuite() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_dry_run"),
  );
  const npmExecPath = process.env.npm_execpath;
  const result = npmExecPath
    ? spawnSync(process.execPath, [npmExecPath, "test"], { env, stdio: "inherit" })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["test"], {
        env,
        shell: process.platform === "win32",
        stdio: "inherit",
      });

  if (result.error) {
    console.error(`prepublish test gate could not start npm test: ${result.error.message}`);
    process.exitCode = 1;
  } else if (result.signal) {
    console.error(`prepublish test gate interrupted by ${result.signal}`);
    process.exitCode = 1;
  } else if (Number.isInteger(result.status)) {
    process.exitCode = result.status;
  } else {
    console.error("prepublish test gate received a non-integer npm test exit status");
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.LITCLAUDE_PUBLISH_FROM_CI === "1") {
    const verdict = await ciVerdict({ env: process.env });
    if (verdict.ok) {
      console.log(`prepublish test gate: ${verdict.reason}; the suite is not run again`);
    } else {
      console.error(`prepublish test gate refused: ${verdict.reason}`);
      process.exitCode = 1;
    }
  } else {
    runSuite();
  }
}

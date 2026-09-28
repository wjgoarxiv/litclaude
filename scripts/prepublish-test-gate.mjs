import { spawnSync } from "node:child_process";

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

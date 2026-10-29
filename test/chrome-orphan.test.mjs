// Headless Chrome dies with the process that launched it. A probe or render killed mid-run used to
// leave Chrome alive under PID 1; both launchers now tie it to their parent. A fake `chrome` that
// records its PID and sleeps stands in for the browser, so no real Chrome is needed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const skills = join(root, "plugins", "litclaude", "skills");
const posix = process.platform !== "win32";
const cleanups = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
const until = async (check, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
};

const fakeChrome = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "chrome-orphan-")));
  const pidFile = join(dir, "chrome.pid");
  const chrome = join(dir, "chrome");
  writeFileSync(chrome, `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 60\n`);
  chmodSync(chrome, 0o755);
  cleanups.push(() => {
    if (existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, "utf8"));
      if (pid > 1 && alive(pid)) process.kill(pid, "SIGKILL");
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, chrome, pidFile };
};

// Starts `source` in a child node, waits for the fake Chrome, kills the child, and returns the PID.
const launchAndKill = async (source, signal) => {
  const { dir, chrome, pidFile } = fakeChrome();
  const child = spawn(process.execPath, ["--input-type=module", "-e", source, chrome, dir], { stdio: "ignore" });
  cleanups.push(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  assert.ok(await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "", 10_000), "the fake Chrome never started");
  const pid = Number(readFileSync(pidFile, "utf8"));
  assert.ok(alive(pid));
  child.kill(signal);
  return pid;
};

const motionChrome = pathToFileURL(join(skills, "lit-typographic-motion", "engine", "node", "chrome.mjs")).href;
const motionSource = `
const { ChromeSession } = await import(${JSON.stringify(motionChrome)});
const [chrome, dir] = process.argv.slice(1);
await ChromeSession.launch({ chrome, flags: [], profileDir: dir + "/profile", routes: [], timeoutMs: 60000 });
`;
const schematicRender = pathToFileURL(join(skills, "lit-schematic", "scripts", "render.mjs")).href;
const schematicSource = `
const { renderPng } = await import(${JSON.stringify(schematicRender)});
const [chrome, dir] = process.argv.slice(1);
renderPng({ chrome, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10mm" height="10mm"/>', out: dir + "/out.png", verify: false });
`;

for (const [name, source] of [["lit-typographic-motion ChromeSession", motionSource], ["lit-schematic render", schematicSource]]) {
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    test(`${name}: Chrome dies when its launcher gets ${signal}`, { skip: !posix && "process groups are POSIX" }, async () => {
      const pid = await launchAndKill(source, signal);
      assert.ok(await until(() => !alive(pid), 5000), `Chrome PID ${pid} outlived its launcher`);
    });
  }
}

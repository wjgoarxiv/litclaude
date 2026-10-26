// LC-3, LC-6 and LC-7 (1.0.40 security review): lit-typographic-motion's asset fetch checks every
// redirect hop and counts bodies on the stream, and the stage's /lit/three/ route serves only real
// files inside the vendored folder.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { fetchAssets } from "../plugins/litclaude/skills/lit-typographic-motion/engine/node/assets.mjs";
import { stageRouter } from "../plugins/litclaude/skills/lit-typographic-motion/engine/node/stage-serve.mjs";

const cleanups = [];
afterEach(() => {
  while (cleanups.length) rmSync(cleanups.pop(), { recursive: true, force: true });
});
const scratch = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "motion-fetch-")));
  cleanups.push(dir);
  return dir;
};

// A fetch stub keyed by URL; `redirect` answers 302 to the given location.
const respond = (body, { status = 200, headers = {} } = {}) => new Response(body, { status, headers });
const redirect = (location) => () => respond(null, { status: 302, headers: { location } });
const stub = (routes, seen = []) => async (url, init) => {
  seen.push({ url, redirect: init?.redirect });
  const answer = routes[url];
  return answer ? answer() : respond("missing", { status: 404 });
};
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
// A 64 MiB body that declares no length; `pulled` counts the MiB the reader asked for.
const oversized = () => {
  const counter = { pulled: 0 };
  const body = new ReadableStream({
    pull(controller) {
      counter.pulled += 1;
      if (counter.pulled > 64) controller.close();
      else controller.enqueue(new Uint8Array(1024 * 1024));
    },
  }, { highWaterMark: 0 });
  return { counter, body };
};

test("LC-3: motion assets follow no redirect into the local network and cap an undeclared body", async () => {
  const out = scratch();
  const seen = [];
  const fetchImpl = stub({
    "https://api.github.com/repos/acme/tidewell": () => respond(JSON.stringify({ name: "tidewell", owner: { avatar_url: "https://avatars.example.com/u/1" } })),
    "https://api.github.com/repos/acme/tidewell/readme": redirect("http://169.254.169.254/latest/meta-data"),
    "https://avatars.example.com/u/1": redirect("https://127.0.0.1/secret.png"),
  }, seen);
  await assert.rejects(fetchAssets({ out, url: "https://github.com/acme/tidewell", fetchImpl, lookup: publicLookup }), (error) => error.code === 22);
  assert.equal(existsSync(join(out, "product", "README.md")), false, "the metadata body is never written");
  assert.ok(seen.length >= 3 && seen.every((call) => call.redirect === "manual"), "every hop is fetched with redirect: manual");
  assert.equal(seen.some((call) => /169\.254|127\.0\.0\.1/u.test(call.url)), false, "no private hop is requested");
  const big = scratch();
  const { counter, body } = oversized();
  const huge = async () => new Response(body, { status: 200 });
  await assert.rejects(fetchAssets({ out: big, url: "https://example.com", fetchImpl: huge, lookup: publicLookup }), (error) => error.code === 22);
  assert.ok(counter.pulled <= 4, `the 2 MiB page cap stopped the read after ${counter.pulled} MiB`);
});

test("LC-6: /lit/three/ serves only real files inside the vendored folder", () => {
  const base = scratch();
  const stageDir = join(base, "stage");
  const threeDir = join(base, "three");
  mkdirSync(stageDir);
  mkdirSync(join(threeDir, "addons"), { recursive: true });
  writeFileSync(join(threeDir, "three.module.js"), "export {};");
  writeFileSync(join(base, "secret.js"), "SECRET");
  symlinkSync(join(base, "secret.js"), join(threeDir, "addons", "escape.js"));
  writeFileSync(join(threeDir, "addons\\..\\x.js"), "a name a Windows host reads as a path");
  const { route } = stageRouter({ stageDir, faces: [], threeDir });
  assert.equal(route("http://lit.stage/lit/three/three.module.js").kind, "file");
  assert.equal(route("http://lit.stage/lit/three/addons/escape.js").kind, "missing", "a link out of the folder is refused");
  assert.equal(route("http://lit.stage/lit/three/addons%5C..%5Cx.js").kind, "missing", "a backslash is refused");
});

// LC-2, LC-7 and LC-9 (pre-release security review): a lit-hijack capture fetches https only and checks
// every redirect hop, so a public page cannot bounce it into loopback, the metadata address or the
// local network; the size cap is counted on the stream; and a reuse prohibition counts on any line.
import assert from "node:assert/strict";
import { test } from "node:test";

import { decideLicence, fetchBytes } from "../plugins/litclaude/skills/lit-hijack/scripts/hijack.mjs";

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

test("LC-2: a lit-hijack capture follows no redirect into loopback, link-local or private hosts, and https only", async () => {
  for (const target of ["https://127.0.0.1/latest/meta-data", "https://169.254.169.254/latest/meta-data", "https://10.0.0.8/", "https://[::1]/", "https://[::ffff:7f00:1]/", "https://localhost/x", "http://example.com/plain"]) {
    const seen = [];
    const fetchImpl = stub({ "https://example.com/article": redirect(target), [target]: () => respond("METADATA-PAYLOAD") }, seen);
    await assert.rejects(fetchBytes("https://example.com/article", { fetchImpl, lookup: publicLookup }), /refus|https/u, target);
    assert.ok(seen.every((call) => call.redirect === "manual"), "every hop is fetched with redirect: manual");
    assert.equal(seen.some((call) => call.url === target), false, `${target} is never requested`);
  }
  await assert.rejects(fetchBytes("http://example.com/article", { fetchImpl: stub({}), lookup: publicLookup }), /https/u);
  const privateDns = async () => [{ address: "192.168.1.4", family: 4 }];
  await assert.rejects(fetchBytes("https://intranet.example/x", { fetchImpl: stub({ "https://intranet.example/x": () => respond("x") }), lookup: privateDns }), /refus/u);
  const fine = await fetchBytes("https://example.com/a", { fetchImpl: stub({ "https://example.com/a": redirect("/b"), "https://example.com/b": () => respond("hello", { headers: { "content-type": "text/plain" } }) }), lookup: publicLookup });
  assert.equal(fine.buffer.toString(), "hello");
  assert.equal(fine.finalUrl, "https://example.com/b");
});

test("LC-7: the size cap is counted on the stream, so an undeclared huge body aborts instead of buffering", async () => {
  const { counter, body } = oversized();
  const fetchImpl = async () => new Response(body, { status: 200 });
  await assert.rejects(fetchBytes("https://example.com/big", { fetchImpl, lookup: publicLookup, limit: 4 * 1024 * 1024 }), /larger than/u);
  assert.ok(counter.pulled <= 6, `stopped after ${counter.pulled} MiB, not 64`);
});

test("LC-9: a prohibition counts on any line, and outranks a permissive identifier", () => {
  assert.equal(decideLicence("NOASSERTION", { text: "Intro.\nYou must not adapt this code.\n" }).decision, "needs-review");
  assert.equal(decideLicence("MIT", { text: "Permission is hereby granted, free of charge (MIT).\n\nDo not redistribute this guide.\n" }).decision, "needs-review");
});

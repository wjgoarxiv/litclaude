// Residual risk after the fetch hardening: the hop check resolved a name and fetch then resolved it again, so a host
// that answered with a public address for the check and a private one for the connection (DNS
// rebinding) got through. lit-hijack now connects to the address the check approved (the motion asset fetch
// moved to the video-covers extras plugin with lit-typographic-motion). The request is faked at node:https's level and calls the lookup it was handed, the
// way net.connect does, with and without `all`.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { test } from "node:test";

import { fetchBytes } from "../plugins/litclaude/skills/lit-hijack/scripts/hijack.mjs";

const PUBLIC = "93.184.216.34";
// Public for the first question about a name, loopback for every later one.
const rebinding = () => {
  const asked = new Map();
  const lookup = async (host) => {
    const n = asked.get(host) ?? 0;
    asked.set(host, n + 1);
    return [{ address: n === 0 ? PUBLIC : "127.0.0.1", family: 4 }];
  };
  return { lookup, asked };
};
const fakeRequest = (connected, body) => (href, options, onResponse) => {
  const req = new EventEmitter();
  req.end = () => {
    const host = new URL(href).hostname;
    options.lookup(host, { all: true }, (_error, list) => {
      connected.push(...list.map(({ address }) => address));
      options.lookup(host, {}, (_error, address) => {
        connected.push(address);
        const res = Readable.from([Buffer.from(body)]);
        res.statusCode = 200;
        res.headers = { "content-type": "text/html" };
        onResponse(res);
      });
    });
  };
  return req;
};

test("lit-hijack connects to the address its hop check approved, not to a second answer", async () => {
  const { lookup, asked } = rebinding();
  const connected = [];
  const { buffer } = await fetchBytes("https://rebind.example/page", { lookup, request: fakeRequest(connected, "hello") });
  assert.equal(buffer.toString("utf8"), "hello");
  assert.ok(connected.length >= 2);
  assert.deepEqual([...new Set(connected)], [PUBLIC], "the socket never reaches the rebound address");
  assert.equal(asked.get("rebind.example"), 1, "the name is resolved once, by the check");
});

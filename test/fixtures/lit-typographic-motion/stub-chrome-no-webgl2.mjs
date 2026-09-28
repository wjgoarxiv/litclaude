#!/usr/bin/env node
// A stand-in for Chrome that speaks just enough of the DevTools pipe protocol (fd 3 in, fd 4 out)
// to launch, open a page and report that canvas.getContext('webgl2') returned null. It lets the
// suite prove exit 11 (Chrome runs, no WebGL2) on any host.
// Sockets, not fs streams: a pending fs read on the pipe would hold process.exit() open.
import { writeFileSync } from "node:fs";
import { Socket } from "node:net";

// STUB_CHROME_ARGV_OUT=<file> records the arguments this launch received, for the keychain-flag check.
if (process.env.STUB_CHROME_ARGV_OUT) writeFileSync(process.env.STUB_CHROME_ARGV_OUT, JSON.stringify(process.argv.slice(2)), { flag: "a" });

const input = new Socket({ fd: 3, readable: true, writable: false });
const output = new Socket({ fd: 4, readable: false, writable: true });
let buffer = "";
const reply = (id, result, sessionId) => output.write(`${JSON.stringify({ id, result, ...(sessionId ? { sessionId } : {}) })}\0`);
input.on("data", (chunk) => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const msg = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (msg.method === "Target.createTarget") reply(msg.id, { targetId: "stub-target" });
    else if (msg.method === "Target.attachToTarget") reply(msg.id, { sessionId: "stub-session" });
    else if (msg.method === "Runtime.evaluate") reply(msg.id, { result: { type: "object", value: { webgl2: false, renderer: null } } }, msg.sessionId);
    else if (msg.method === "Browser.close") {
      reply(msg.id, {});
      // STUB_CHROME_LINGER=1 acknowledges the close and stays alive, like a hung browser.
      if (process.env.STUB_CHROME_LINGER !== "1") setTimeout(() => process.exit(0), 10);
    } else reply(msg.id, msg.method === "Browser.getVersion" ? { product: "StubChrome/0" } : {}, msg.sessionId);
  }
});
input.on("end", () => setTimeout(() => process.exit(0), process.env.STUB_CHROME_LINGER === "1" ? 20000 : 0));

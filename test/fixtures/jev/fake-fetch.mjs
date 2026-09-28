// Test-only preload for the prompt hook: replaces fetch so no request ever leaves the machine.
// JEV_FAKE_RESPONSE holds {status, body}, {hang: true}, or {stall: true}; the last ignores the
// abort signal and holds the event loop open, like a DNS lookup that cannot be cancelled. Each
// call is appended to JEV_FAKE_LOG.
import { appendFileSync } from "node:fs";

globalThis.fetch = async (url, init = {}) => {
  if (process.env.JEV_FAKE_LOG) {
    appendFileSync(process.env.JEV_FAKE_LOG, `${JSON.stringify({
      url: String(url),
      method: init.method,
      bearerMatchesEnvKey: init.headers?.authorization === `Bearer ${process.env.TYPESAFE_API_KEY}`,
      body: init.body,
    })}\n`);
  }
  const response = JSON.parse(process.env.JEV_FAKE_RESPONSE ?? "{\"status\":500,\"body\":\"\"}");
  if (response.hang) return new Promise(() => {});
  if (response.stall) return new Promise(() => setInterval(() => {}, 1000));
  return { status: response.status, text: async () => response.body };
};

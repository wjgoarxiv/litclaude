// Claude Code refuses an AbovePrompt tree whose Client props hold `undefined` ("ui.render hook
// skipped: returned the wrong shape"). Seen live behind the folder-trust dialog of a fresh project:
// a skill fired before session.start had read the accent, so the first card went out with
// `accent: undefined` and was dropped.
import assert from "node:assert/strict";
import test from "node:test";

import { register } from "../plugins/litclaude/hooks/lit-mod.mjs";

const holes = (value, path, out = []) => {
  if (value === undefined) out.push(path);
  else if (Array.isArray(value)) value.forEach((item, index) => holes(item, `${path}[${index}]`, out));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) holes(item, `${path}.${key}`, out);
  return out;
};

test("a card drawn before session.start carries no undefined in its Client props", async () => {
  const hooks = [];
  register((event, matcher, hook) => {
    hooks.push(typeof matcher === "function" ? { event, matcher: {}, hook: matcher } : { event, matcher, hook });
    return { catch: () => undefined };
  }, { glyphs: "basic", motion: "full" });
  const clients = [];
  const elements = {
    Box: ({ children = [] }) => ({ kind: "box", children }),
    Text: (props) => ({ kind: "text", text: props.children, props }),
    Client: (props) => {
      clients.push(props);
      return { kind: "client", props };
    },
  };
  const $ = {
    fs: { stat: async () => null, read: async () => { throw new Error("ENOENT"); } },
    session: { cwd: async () => "/nowhere/project", id: async () => "props-0001", usage: async () => null, surfaces: async () => ["terminal"] },
    agent: { list: async () => [] },
    clock: { now: async () => 10_000_000, after: () => undefined, every: () => () => undefined },
    env: { get: async () => undefined },
    settings: { read: async () => null },
    command: { register: async () => undefined },
    ui: { invalidate: () => undefined, toast: () => undefined, resolve: () => elements, notify: async () => ({}) },
  };
  const fire = async (event, e, matcher = {}) => {
    const chain = hooks.filter((entry) => entry.event === event && Object.entries(matcher).every(([key, value]) => entry.matcher[key] === value));
    const step = async (index, input) => (index < chain.length ? chain[index].hook($, input, (next) => step(index + 1, next)) : undefined);
    return step(0, e);
  };
  await fire("tool.call", { tool: "Skill", skill: "litclaude:start-work" });
  await fire("ui.render", { surface: "terminal", props: { bodyColumns: 100 } }, { component: "AbovePrompt" });
  assert.equal(clients.length, 1, "the skill's card was drawn");
  assert.deepEqual(holes(clients[0].props, "props"), []);
});

import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { describe, it } from "node:test";
import { EXTRA_DENIES, REPLAY, makeWorld, mapCommand, projectWithWork, verdict } from "./helpers/observer-replay.mjs";

const OWNER_SNAPSHOT = JSON.parse(readFileSync(new URL("./fixtures/observer-owner-snapshot.json", import.meta.url), "utf8"));
const READ_NOTE = /^Another session is running start-work work-1 here \(last activity [^)]+\); you may read, not change files\.$/u;
const OTHER_DENIAL = /^LitClaude start-work work-1 \(approved\.md\) belongs to another session in this project/u;

// plans/litclaude-1042.md todo 2 (A1): on 2026-10-27 a second session watching a running work was
// refused herdr reads and grep pipelines; the user had to type `!` commands for it.
describe("start-work observer reads from another session", () => {
  const withProject = (fn) => {
    const root = projectWithWork();
    const world = makeWorld();
    try {
      fn(root, world);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(world, { recursive: true, force: true });
    }
  };

  it("replays the 2026-10-27 commands with their expected verdict", () => {
    withProject((root, world) => {
      for (const entry of REPLAY) {
        const result = verdict(root, "session-other", mapCommand(entry.command, world), world);
        assert.equal(result.decision, entry.expect, `${entry.id} (${entry.why}): ${JSON.stringify(result)}`);
        if (entry.expect === "allow") assert.match(result.context, READ_NOTE, entry.id);
        else assert.match(result.reason, OTHER_DENIAL, entry.id);
      }
    });
  });

  it("keeps refusing writes, other herdr verbs, redirects, substitutions and unknown pipes", () => {
    withProject((root, world) => {
      for (const command of EXTRA_DENIES) {
        const result = verdict(root, "session-other", mapCommand(command, world), world);
        assert.equal(result.decision, "deny", command);
        assert.match(result.reason, OTHER_DENIAL, command);
      }
    });
  });

  it("leaves the owner session's verdicts exactly as recorded before the change", () => {
    for (const [command, recorded] of Object.entries(OWNER_SNAPSHOT)) {
      withProject((root, world) => {
        assert.deepEqual(verdict(root, "session-root", mapCommand(command, world), world), recorded, command);
      });
    }
  });
});

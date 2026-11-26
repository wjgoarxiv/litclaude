import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { classifyObservation } from "../plugins/litclaude/lib/start-work-lifecycle.mjs";
import { EXTRA_DENIES, NUDGE_ALLOWS, REPLAY, makeWorld, mapCommand, projectWithWork, verdict } from "./helpers/observer-replay.mjs";

const OWNER_SNAPSHOT = JSON.parse(readFileSync(new URL("./fixtures/observer-owner-snapshot.json", import.meta.url), "utf8"));
const READ_NOTE = /^Another session is running start-work work-1 here \(last activity [^)]+\); you may read and write notes in your scratchpad or the shared project memory, not change project files\. Only the user answers that run's parked steps, in its own session\.$/u;
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

  it("lets a watcher nudge the worker, split a pane and list files, as inert commands", () => {
    withProject((root, world) => {
      for (const command of NUDGE_ALLOWS) {
        const result = verdict(root, "session-other", mapCommand(command, world), world);
        assert.equal(result.decision, "allow", `${command}: ${JSON.stringify(result)}`);
        assert.match(result.context, READ_NOTE, command);
      }
      // mapCommand would move an absolute command name into the temp world, so ask the grammar directly.
      assert.equal(classifyObservation("/bin/ls plans", root, root), true);
      assert.equal(classifyObservation("/bin/rm plans", root, root), false);
      // F2 review L1: a leading find option must not skip the search root's sensitive-path check.
      writeFileSync(join(root, ".env"), "K=v\n");
      assert.equal(classifyObservation("find .env -name x", root, root), false);
      assert.equal(classifyObservation("find -x .env -name x", root, root), false);
      assert.equal(classifyObservation("find -x plans -name x", root, root), true);
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

// Evidence freshness: a file existing is not proof that a pass is current. `record-evidence --inputs` (and
// `--reviewed` for the artifact a human review looked at) binds the pass to each file's SHA-256 at the moment
// it was observed; when one of those files changes or disappears, the pass reopens as `stale`.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { LitgoalStateError } from "./state.mjs";

const MAX_INPUT_BYTES = 256 * 1024 * 1024;

const sha256Of = (path) => {
  let info;
  try {
    info = lstatSync(path);
  } catch {
    return null;
  }
  if (!info.isFile() || info.size > MAX_INPUT_BYTES) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
};

/** Fingerprints each path (relative to `cwd`) as { path, role, sha256 }; a missing or non-regular file is refused. */
export const fingerprintInputs = (cwd, entries) =>
  entries.map(({ path, role }) => {
    const absolute = resolve(cwd, path);
    const sha256 = sha256Of(absolute);
    if (!sha256) throw new LitgoalStateError(`evidence input is not a readable regular file: ${path}`);
    return { path: absolute, role, sha256 };
  });

/** The inputs of an evidence record whose file changed or vanished since it was recorded. */
export const staleInputs = (record) =>
  (Array.isArray(record?.inputs) ? record.inputs : []).flatMap(({ path, role, sha256 }) => {
    const now = sha256Of(path);
    if (now === sha256) return [];
    return [{ path, role, reason: now === null ? "missing" : "changed" }];
  });

/**
 * Reopens every passing criterion whose latest evidence has a changed or missing input: its status becomes
 * `stale` and `staleInputs` says which. Mutates `state`; returns one ledger entry per reopened criterion.
 */
export const reopenStaleCriteria = (state) => {
  const reopened = [];
  for (const criterion of Array.isArray(state?.criteria) ? state.criteria : []) {
    if (criterion?.status !== "pass") continue;
    const stale = staleInputs(criterion.evidence?.at(-1));
    if (!stale.length) continue;
    criterion.status = "stale";
    criterion.staleInputs = stale;
    reopened.push({ event: "evidence.stale", criterionId: criterion.id, staleInputs: stale });
  }
  return reopened;
};

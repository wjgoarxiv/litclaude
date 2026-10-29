// The unknown register: unknowns are reduced while the work runs, not only while it is planned. Each item is
// KK (known known: needs a source), KU (known unknown), UK (unknown known: something only the user can answer)
// or UU (unknown unknown). An open KU/UK/UU needs a deterministic probe, closing one needs evidence, and an
// open critical item blocks completion.
import { LitgoalStateError } from "./state.mjs";

export const UNKNOWN_KINDS = Object.freeze(["KK", "KU", "UK", "UU"]);

/** Adds an item to `state.unknowns`; returns the stored record. */
export const addUnknown = (state, { kind, text, source, probe, critical, now }) => {
  if (!UNKNOWN_KINDS.includes(kind)) throw new LitgoalStateError(`unknown kind must be one of: ${UNKNOWN_KINDS.join(", ")}`, 64);
  if (!text) throw new LitgoalStateError("missing text", 64);
  if (kind === "KK" && !source) throw new LitgoalStateError("a KK item needs --source", 64);
  if (kind !== "KK" && !probe) throw new LitgoalStateError(`an open ${kind} item needs --probe: how it will be checked`, 64);
  const unknowns = Array.isArray(state.unknowns) ? state.unknowns : [];
  const record = {
    id: `unknown-${unknowns.length + 1}`,
    kind,
    text,
    ...(source ? { source } : {}),
    ...(probe ? { probe } : {}),
    critical: Boolean(critical),
    status: kind === "KK" ? "known" : "open",
    createdAt: now,
  };
  state.unknowns = [...unknowns, record];
  return record;
};

/** Closes an open item with the evidence that answered it; returns the updated record. */
export const resolveUnknown = (state, { id, evidence, now }) => {
  const record = (Array.isArray(state.unknowns) ? state.unknowns : []).find((item) => item.id === id);
  if (!record) throw new LitgoalStateError("unknown item not found");
  if (record.status !== "open") throw new LitgoalStateError(`${id} is not open`);
  if (!evidence) throw new LitgoalStateError("closing an unknown needs --evidence", 64);
  record.status = "resolved";
  record.evidence = evidence;
  record.resolvedAt = now;
  return record;
};

/** Open items marked critical: any one of them blocks completion. */
export const openCriticalUnknowns = (state) =>
  (Array.isArray(state?.unknowns) ? state.unknowns : []).filter((item) => item?.status === "open" && item.critical === true);

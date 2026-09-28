// Deterministic rule order: local beats global, nearer beats farther, then source
// priority, then path. Ordering is load-bearing — it decides which rules survive the
// character budget, so it must be a total order with no ties left to scan order.

import { SOURCE_PRIORITY } from "./constants.mjs";

const compareNumber = (left, right) => left - right;

const compareString = (left, right) => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const priorityOf = (source) => SOURCE_PRIORITY.get(source) ?? Number.POSITIVE_INFINITY;

export const compareCandidates = (a, b) =>
  compareNumber(Number(a.isGlobal === true), Number(b.isGlobal === true))
  || compareNumber(a.distance ?? 0, b.distance ?? 0)
  || compareNumber(priorityOf(a.source), priorityOf(b.source))
  || compareString(a.relativePath ?? "", b.relativePath ?? "")
  || compareString(a.realPath ?? "", b.realPath ?? "");

/** Stable sort: equal candidates keep discovery order. */
export const sortCandidates = (candidates) =>
  candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => compareCandidates(left.candidate, right.candidate) || left.index - right.index)
    .map(({ candidate }) => candidate);

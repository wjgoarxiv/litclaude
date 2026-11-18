#!/usr/bin/env node
// The launch question's cost line: idea agents, reducers (one per 30 idea agents) and one judge, as a
// token range per agent. Calibrated on a real 100-agent run (2026-11-18): each agent's input counts the
// host's system and tool prompt and its cache reads on every turn, plus its output. Idea agents used
// 77k each (p10-p90 76.8k-78.2k), reducers 110k-266k, the judge 140k: 8.58M in all. A planning figure
// only; the host's own usage report is the real number.
// Usage: node estimate.mjs <agents> [--json]

export const IDEA_TOKENS = Object.freeze({ low: 70_000, high: 85_000 });
export const REDUCER_TOKENS = Object.freeze({ low: 110_000, high: 270_000 });
export const JUDGE_TOKENS = Object.freeze({ low: 110_000, high: 180_000 });
export const PER_REDUCER = 30;
export const MAX_AGENTS = 900;

export const estimate = (agents) => {
  if (!Number.isInteger(agents) || agents < 1) throw new Error("agents must be a positive whole number");
  if (agents > MAX_AGENTS) throw new Error(`at most ${MAX_AGENTS} idea agents per run; split a larger run`);
  const reducers = Math.ceil(agents / PER_REDUCER);
  const total = (end) => agents * IDEA_TOKENS[end] + reducers * REDUCER_TOKENS[end] + JUDGE_TOKENS[end];
  return { agents, reducers, judges: 1, tokens: { low: total("low"), high: total("high") } };
};

const millions = (tokens) => (Math.round(tokens / 100_000) / 10).toFixed(1);

export const costLine = (agents) => {
  const { reducers, tokens } = estimate(agents);
  return `${agents} idea agents (haiku, low) + ${reducers} reducers (sonnet) + 1 judge (opus) ≈ ${millions(tokens.low)}-${millions(tokens.high)}M tokens`;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const [raw, flag] = process.argv.slice(2);
  try {
    const agents = Number(raw);
    process.stdout.write(`${flag === "--json" ? JSON.stringify(estimate(agents)) : costLine(agents)}\n`);
  } catch (error) {
    process.stderr.write(`estimate: ${error.message}\n`);
    process.exitCode = 64;
  }
}

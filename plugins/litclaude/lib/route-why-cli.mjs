// `litclaude-ai why "<prompt>"`: which workflow a prompt routes to and why, as one short block. The
// prompt is shown only as its first 80 characters, with control characters blanked.
import { explainRoute } from "./route-match.mjs";

const USAGE = 'Usage: litclaude-ai why "<prompt>"\n';
const SHOWN_CHARS = 80;

const preview = (prompt) => {
  const chars = Array.from(prompt);
  const shown = chars.slice(0, SHOWN_CHARS).join("").replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ");
  return chars.length > SHOWN_CHARS ? `${shown}…` : shown;
};

export const runWhyCli = (args, out = process.stdout, err = process.stderr) => {
  if (args[0] === "--help" || args[0] === "-h") {
    out.write(USAGE);
    return 0;
  }
  const prompt = args.join(" ");
  if (prompt.trim() === "") {
    err.write(USAGE);
    return 64;
  }
  const { route, ruleId, runnerUp, inert } = explainRoute(prompt);
  out.write(`${[
    `prompt  ${preview(prompt)}`,
    `route   ${route ?? "none"}`,
    `rule    ${ruleId ?? "none"}`,
    `runner  ${runnerUp ? `${runnerUp.route} (${runnerUp.ruleId})` : "none"}`,
    `inert   ${inert ? "yes" : "no"}`,
  ].join("\n")}\n`);
  return 0;
};

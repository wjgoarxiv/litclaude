// The one ROUND_ENDS: line that install, update and doctor end with: do the status line and the LIT card
// show round ends here, and if not, why and one fix. Facts in, text out.

import { hudColorDepth, normalizeHudAppearance } from "../plugins/litclaude/lib/hud-accent-palette.mjs";
import { drawsRoundCaps, glyphWord } from "../plugins/litclaude/lib/mod/round.mjs";
import { AGENT_COMMAND, NPX } from "./agent-guide.mjs";

const square = (reason, fix) => `ROUND_ENDS: square (${reason}; ${fix})`;
const check = (reason) => `ROUND_ENDS: check (${reason}; show your user the test pill from ${AGENT_COMMAND})`;

// What this window can show. An agent's shell is no window, so it is asked only of a terminal.
const windowReason = (env) => {
  if (Object.hasOwn(env, "NO_COLOR")) return square("NO_COLOR", "start Claude Code without NO_COLOR");
  if (/^dumb$/iu.test(env.TERM ?? "")) return square("TERM=dumb", "start Claude Code in a terminal with colour");
  if (normalizeHudAppearance(env.LITCLAUDE_HUD_APPEARANCE) !== "dark") return square("light ground", "use a dark terminal and unset LITCLAUDE_HUD_APPEARANCE");
  if (hudColorDepth(env) !== "truecolor") return square("fewer colours than truecolor", "use a truecolor terminal, or set COLORTERM=truecolor if yours is one");
  return null;
};

/**
 * `surface` is "on", "disabled" (the plugin is off) or "off"; `saved` the stored glyphs choice;
 * `fontHere` whether a Nerd Font's file name was found; `fontProblem` why this run could not add one.
 */
export const roundEndsLine = ({ env, platform, surface, saved, fontHere, fontProblem, tty }) => {
  if (surface === "disabled") return square("no surface enabled", "turn LitClaude on with /plugin in Claude Code");
  if (surface !== "on") return square("no surface enabled", `${NPX} config band always`);
  const fromEnv = glyphWord(env.LITCLAUDE_HUD_GLYPHS);
  const setting = fromEnv ?? glyphWord(saved) ?? "auto";
  if (setting === "basic") return square("choice is square", fromEnv ? "unset LITCLAUDE_HUD_GLYPHS" : `${NPX} update --yes --round --glyphs auto`);
  const unseen = tty ? windowReason(env) : null;
  if (unseen) return unseen;
  if (setting === "round" && !fromEnv) return "ROUND_ENDS: shown";
  if (drawsRoundCaps(env)) return `ROUND_ENDS: ready${tty ? "" : " in a dark full-colour terminal"}`;
  if (setting !== "auto") return check(`${fromEnv ? "LITCLAUDE_HUD_GLYPHS" : "the saved choice"} is ${setting}, and this terminal is not known to draw the ends`);
  if (env.SSH_CONNECTION) return square("SSH", `if your user sees both ends of the test pill round, ${NPX} update --yes --round --glyphs round`);
  if (fontHere) return check("an icon font is here, and this terminal is not known to use it for the ends");
  if (fontProblem) return square(`font not installed (${fontProblem.replace(/\s+/gu, " ")})`, `${NPX} update --yes --round`);
  if (platform === "win32") return square("Windows console", "use Windows Terminal or VS Code");
  return square("no icon font", `${NPX} update --yes --round`);
};

// What `install --agent` prints. Text only: it answers no question and changes no gate. The question
// titles here are the ones the installer's cards show; both README prompts carry the same steps, and
// test/agent-guide.test.mjs keeps guide, flags, cards and READMEs in step.

import { ICON_FONT } from "./icon-font.mjs";

export const NPX = "npx --yes @litfamily/litclaude@latest";
export const AGENT_COMMAND = `${NPX} install --agent`;
export const AGENT_POINTER = `Agent? See ${AGENT_COMMAND}.`;
export const ROUND_PILL = " LIT ";

const later = `your user can choose it later with ${NPX} install`;
export const INSTALL_QUESTIONS = Object.freeze([
  { id: "accent", title: "Status-line colour", other: `default cyan, or the colour saved before; ${later}` },
  { id: "style", title: "Output style", other: `default None, or the style saved before; ${later}` },
  { id: "font", title: "Icon font", other: "default No; --round adds it only when no icon font is here, --icon-font adds it in any case" },
  { id: "attribution", title: "Co-Authored-By line", other: `default keep; your user can choose it later with ${NPX} config attribution off` },
  { id: "agentFile", title: "LitFamily block", other: "default adds a short block to the global CLAUDE.md and leaves the other text as it is; --no-agent-file leaves the file alone" },
].map(Object.freeze));
export const questionTitle = (id) => INSTALL_QUESTIONS.find((question) => question.id === id).title;

/** Only the installer answers --agent; `run -- --agent x` is Claude Code's own flag. */
export const asksForAgentGuide = (argv) => {
  const command = argv.find((arg, index) => !arg.startsWith("-") && !["--glyphs", "--permission-mode"].includes(argv[index - 1]));
  return argv.includes("--agent") && (command === undefined || ["install", "update"].includes(command));
};

const [font, licence] = ICON_FONT.files.map(({ name }) => name);

export const agentGuide = () => `LitClaude install guide for coding agents

If you are a coding agent and your user asked you to install LitClaude, follow these steps. They are written for your user to read too.

Preview (changes nothing)
   ${NPX} --dry-run install --yes --round
   Show your user what it would change.

Ask
   Keep every default: the install line below does.
${INSTALL_QUESTIONS.map(({ title, other }) => `   - ${title}: ${other}.`).join("\n")}
   - The icon font is ${font} with ${licence}, from the pinned Nerd Fonts ${ICON_FONT.release} release on GitHub, checked by SHA-256. --round puts it in ~/Library/Fonts (macOS) or \${XDG_DATA_HOME:-~/.local/share}/fonts, by default ~/.local/share/fonts (Linux), only when no icon font is here. Windows gets no font.
   - The status line and the LIT card are on after the install; no flag is needed. The status line takes the place of the one set now, and uninstall puts that one back.
   Wait for your user's yes. Use only this package; add no other source, and do not approve hooks, trust or sign-in for your user.

Install
   ${NPX} install --yes --round

Update
   ${NPX} update --yes --round

Check
   ${NPX} doctor
   Its last line is DOCTOR_PASS. The install, the update and doctor each print one ROUND_ENDS: line. shown and ready need nothing more; check and square name the reason and one fix.
   If a step fails, show your user the lines and stop.

Rounded ends
   Show your user this and ask if both ends are round: ${ROUND_PILL}
   Both ends round:
   ${NPX} update --yes --round --glyphs round
   Boxes:
   ${NPX} update --yes --round --glyphs square
   For round ends later, set the terminal's own font to a full Nerd Font, or add ${ICON_FONT.family} as its fallback font (iTerm2 Non-ASCII Font, VS Code terminal.integrated.fontFamily, kitty symbol_map). Terminal.app has no fallback setting, so it needs a full Nerd Font as its font.
   Over SSH or from a phone, leave it unless your user says both ends are round. This undoes either choice:
   ${NPX} update --yes --round --glyphs auto

Only your user can
   - quit Claude Code and start it again (claude), or open a new session in the desktop app, so the plugin loads;
   - sign in to Claude Code, and answer its folder trust and permission questions;
   - set the font of the terminal.
`;

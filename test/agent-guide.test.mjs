// `install --agent`, the pointers to it, and the drift guard that binds the guide, the parser's flags, the
// questions the installer really asks and both README prompts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { INSTALL_QUESTIONS, agentGuide, asksForAgentGuide } from "../bin/agent-guide.mjs";
import { cliEnv } from "./helpers/cli-env.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = join(root, "bin/litclaude-ai.js");
const skip = process.platform === "win32";
const guide = agentGuide();
const PILL = " LIT ";
const POINTER = "Agent? See npx --yes @litfamily/litclaude@latest install --agent.";
const commandsIn = (text) => [...text.matchAll(/npx --yes @litfamily\/litclaude@latest [a-z-][a-zA-Z -]*[a-zA-Z]/gu)].map(([command]) => command);
const promptOf = (path) => {
  const blocks = [...readFileSync(join(root, path), "utf8").matchAll(/```text\n([\s\S]*?)```/gu)].map(([, block]) => block).filter((block) => block.includes("DOCTOR_PASS"));
  assert.equal(blocks.length, 1, `${path} has one agent prompt`);
  return blocks[0];
};

const inHome = (work) => {
  const home = mkdtempSync(join(tmpdir(), "litclaude-agent-"));
  try {
    const env = (extra = {}) => cliEnv({
      PATH: process.env.PATH, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), LITCLAUDE_HOME: join(home, ".litclaude"),
      TMPDIR: join(home, "tmp"), LANG: "en_US.UTF-8", TERM: "xterm-256color", NO_UPDATE_NOTIFIER: "1", LITCLAUDE_NO_AUTO_UPDATE: "1", ...extra,
    });
    const run = (args, extra) => spawnSync(process.execPath, [bin, ...args], { cwd: home, encoding: "utf8", timeout: 60_000, env: env(extra) });
    const pty = (args, extra = {}, steps = [], size = [100, 40]) => {
      const result = spawnSync("python3", [join(root, "test/helpers/installer-keys.py"), process.execPath, bin, ...args], {
        cwd: home, env: env(extra), encoding: "utf8", timeout: 60_000, input: JSON.stringify({ size, steps }),
      });
      assert.equal(result.status, 0, result.stderr || String(result.error));
      const out = JSON.parse(result.stdout);
      assert.equal(out.timedOut, false, out.output);
      return out;
    };
    return work({ home, run, pty, files: () => readdirSync(home, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map(({ name }) => name) });
  } finally {
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
};

test("the guide is the same bytes everywhere, writes nothing and needs no host", () => inHome(({ run, files }) => {
  for (const args of [["install", "--agent"], ["--agent"], ["install", "--yes", "--agent"], ["--dry-run", "install", "--agent"], ["--agent", "--dry-run"], ["install", "--agent", "--bogus"], ["update", "--agent"], ["install", "--permission-mode", "yolo", "--agent"], ["--help", "--agent"], ["--agent", "--json"], ["--agent", "--glyphs", "round"], ["--agent", "--permission-mode", "safe"]]) {
    for (const extra of [{}, { NO_COLOR: "1" }, { CI: "1" }, { TERM: "dumb" }, { LC_ALL: "C" }, { PATH: "/nonexistent" }, { NO_UPDATE_NOTIFIER: undefined, LITCLAUDE_NO_AUTO_UPDATE: undefined }]) {
      const result = run(args, extra);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, guide, args.join(" "));
      assert.equal(result.stderr, "");
    }
  }
  assert.deepEqual(files(), []);
}));

test("a terminal gets the same bytes and is asked nothing", { skip }, () => inHome(({ pty, files }) => {
  const out = pty(["install", "--agent"]);
  assert.equal(out.exit, 0);
  assert.equal(out.output.replaceAll("\r\n", "\n"), guide);
  assert.deepEqual(files(), []);
}));

test("--agent belongs to the installer: other commands keep it", () => {
  for (const argv of [["run", "--", "--agent", "x"], ["run", "--agent"], ["why", "--agent"], ["doctor", "--agent"], ["uninstall", "--agent"], ["--dry-run", "run", "--agent"], ["install"], []]) assert.equal(asksForAgentGuide(argv), false, argv.join(" "));
});

test("the guide says what an agent must know, in order", () => {
  const order = [
    "LitClaude install guide for coding agents",
    "If you are a coding agent and your user asked you to install LitClaude, follow these steps. They are written for your user to read too.",
    "--dry-run install --yes --round", "Show your user what it would change.",
    "Keep every default", ...INSTALL_QUESTIONS.map(({ title }) => title), "SymbolsNerdFontMono-Regular.ttf", "The status line and the LIT card are on",
    "Wait for your user's yes. Use only this package; add no other source, and do not approve hooks, trust or sign-in for your user.",
    "@latest install --yes --round\n", "@latest update --yes --round\n", "@latest doctor\n", "DOCTOR_PASS", "ROUND_ENDS:", "If a step fails, show your user the lines and stop.",
    `Show your user this and ask if both ends are round: ${PILL}`, "--glyphs round", "--glyphs square", "--glyphs auto",
    "Only your user can", "quit Claude Code", "sign in",
  ];
  let at = -1;
  for (const phrase of order) {
    const next = guide.indexOf(phrase, at + 1);
    assert.ok(next > at, `in order: ${phrase}`);
    at = next;
  }
  assert.doesNotMatch(guide, /\x1b|--yolo|permission-mode|\bstar\b|do not ask|macOS (?:usually )?finds/iu);
  assert.ok(guide.endsWith("\n"));
});

test("drift: every flag and command in the guide and both READMEs is one the installer takes", () => inHome(({ run }) => {
  const english = promptOf("README.md");
  const korean = promptOf("README_ko-KR.md");
  const commands = [...new Set(commandsIn(guide))];
  assert.ok(commands.length >= 8, commands.join("\n"));
  for (const [path, prompt] of [["README.md", english], ["README_ko-KR.md", korean]]) {
    for (const command of commands.filter((line) => !line.endsWith("--agent"))) assert.ok(prompt.includes(command), `${path}: ${command}`);
    assert.deepEqual(commandsIn(prompt).filter((command) => !commands.includes(command)), [], `${path} names only the guide's commands`);
    for (const phrase of [PILL, "ROUND_ENDS", "SymbolsNerdFontMono-Regular.ttf", "~/Library/Fonts", "~/.local/share/fonts", "--no-agent-file", "--icon-font", "--round", "Terminal.app", "iTerm2", "symbol_map"]) assert.ok(prompt.includes(phrase), `${path}: ${phrase}`);
  }
  for (const { title } of INSTALL_QUESTIONS) assert.ok(english.includes(title), `README.md asks about ${title}`);
  for (const word of ["상태 줄 색상", "출력 스타일", "아이콘 글꼴", "Co-Authored-By", "LitFamily 구역"]) assert.ok(korean.includes(word), `README_ko-KR.md asks about ${word}`);
  for (const text of [guide, english, korean]) {
    for (const command of commandsIn(text)) {
      const args = command.split(" ").slice(3);
      if (args[0] === "config") assert.deepEqual(args, ["config", "attribution", "off"]);
      else if (!args.includes("--agent")) {
        const result = run(args.includes("--dry-run") ? args : [...args, "--dry-run"]);
        assert.equal(result.status, 0, `${command}: ${result.stderr}`);
      }
    }
    for (const [flag] of text.matchAll(/(?<![\w-])--[a-z-]+[a-z]/gu)) {
      if (["--agent", "--dry-run", "--yes"].includes(flag)) continue;
      const result = run(["install", "--dry-run", flag, ...(flag === "--glyphs" ? ["round"] : [])]);
      assert.equal(result.status, 0, `${flag}: ${result.stderr}`);
    }
  }
}));

test("drift: the guide's questions are the cards the installer really shows, in order", { skip }, () => inHome(({ home, pty }) => {
  mkdirSync(join(home, ".claude"));
  const out = pty(["install"], { COLORTERM: "truecolor", LITCLAUDE_HUD_GLYPHS: "square" }, INSTALL_QUESTIONS.map(({ title }) => [title, "\r", 0.4]));
  assert.equal(out.exit, 0, out.output);
  const text = out.output.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, "");
  const asked = [];
  for (const [, n, title] of text.matchAll(/LIT (\d)\/5 +· ([^[─\r\n]+?) *(?:\[[Yy]\/[Nn]\])? +─/gu)) if (asked[n - 1] === undefined) asked[n - 1] = title.trim();
  assert.deepEqual(asked, INSTALL_QUESTIONS.map(({ title }) => title));
}));

test("--help, a run with no person and the first card point at the guide", { skip }, () => inHome(({ home, run, pty }) => {
  assert.match(run(["--help"]).stdout, /^Are you an agent\? .*npx --yes @litfamily\/litclaude@latest install --agent$/mu);
  const rows = run(["install", "--dry-run"]).stdout.split("\n").filter(Boolean);
  assert.equal(rows[1], POINTER, "right after the first banner line");
  assert.equal(run(["install", "--dry-run", "--json"]).status, 64, "install has no JSON form; one that comes must leave the pointer out");
  assert.equal(pty(["install", "--dry-run"]).output.includes(POINTER), false, "a person at a terminal sees no pointer line");
  assert.ok(pty(["install", "--dry-run"], { CI: "1" }).output.includes(POINTER));
  for (const [size, shown] of [[[100, 40], true], [[80, 24], true], [[40, 30], false], [[100, 12], false]]) {
    const steps = [["Status-line colour", "\r", 0.4], ["Output style", "\x03", 0.2]];
    const text = pty(["install"], { LITCLAUDE_HUD_GLYPHS: "basic" }, steps, size).output.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, "");
    const second = text.lastIndexOf("Output style");
    assert.equal(text.slice(0, second).includes(POINTER), shown, `first card at ${size}`);
    assert.equal(text.slice(second).includes(POINTER), false, "only the first card");
    assert.ok(text.includes("LIT 1/5") && text.includes("LIT 2/5"));
  }
  assert.equal(existsSync(join(home, ".claude/settings.json")), false);
}));

test("the hint takes an empty row: the first card is as tall with it as without", async () => {
  const { createInstallUi } = await import("../bin/install-ui.mjs");
  const { EventEmitter } = await import("node:events");
  const rowsOf = async (hint, columns, rows) => {
    const stdin = Object.assign(new EventEmitter(), { setRawMode() {}, resume() {}, pause() {} });
    const stdout = Object.assign(new EventEmitter(), { columns, rows, text: "", write(chunk) { this.text += chunk; } });
    const ui = createInstallUi({ stdin, stdout, env: { NO_COLOR: "1", LC_ALL: "C.UTF-8" }, settleMs: 0, hint });
    const answer = ui.choose({ tag: "LIT 1/1", title: "T", note: "note", choices: [{ id: "a", label: "a", key: "1" }, { id: "b", label: "b", key: "2" }], initial: "a" });
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    const drawn = stdout.text.split("\r\n").length;
    stdin.emit("keypress", "\r", { name: "return" });
    await answer;
    return drawn;
  };
  for (const [columns, rows] of [[100, 40], [80, 24], [40, 12], [60, 13]]) assert.equal(await rowsOf(POINTER, columns, rows), await rowsOf("", columns, rows), `${columns}x${rows}`);
});

test("plain install, update and doctor end with the restart line and one ROUND_ENDS line", () => inHome(({ home, run }) => {
  mkdirSync(join(home, "tmp"));
  writeFileSync(join(home, "tmp", ".keep"), "");
  for (const command of ["install", "update"]) {
    const { status, stdout, stderr } = run([command, "--yes"]);
    assert.equal(status, 0, stderr);
    assert.match(stdout, /^RESTART: quit Claude Code if it is open, then start it again so the plugin loads\.$/mu);
    const lines = stdout.trimEnd().split("\n");
    assert.match(lines.at(-1), /^ROUND_ENDS: /u);
    assert.equal(lines.filter((line) => line.startsWith("ROUND_ENDS:")).length, 1);
  }
  const doctor = run(["doctor"], { PATH: "/nonexistent" }).stdout.trimEnd().split("\n");
  assert.equal(doctor.at(-1), "DOCTOR_PASS");
  assert.equal(doctor.filter((line) => line.startsWith("ROUND_ENDS:")).length, 1);
}));

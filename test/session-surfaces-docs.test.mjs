// plans/litclaude-1042.md todo 10: each behaviour this release added is named in the command, skill or
// guide a user reads for it, so the docs cannot drift away from the code silently.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const plugin = (...parts) => read("plugins", "litclaude", ...parts);

test("start-work says what another session may run while a work is running", () => {
  const text = plugin("commands", "start-work.md");
  assert.match(text, /Another session in the same project may watch a running work/u);
  assert.match(text, /`herdr agent read\|get\|list`, `herdr pane read\|list` and\s+`herdr tab list`/u);
  assert.match(text, /owner session's own guard is unchanged/u);
});

test("lit-plan offers go and asks for Scope roots lines for outside todo paths", () => {
  for (const text of [plugin("commands", "lit-plan.md"), plugin("skills", "lit-plan", "SKILL.md")]) {
    assert.match(text, /type `go` within 30 minutes, or `\/litclaude:start-work plans\/<slug>\.md`/u);
    assert.match(text, /scaffold-plan\.mjs\s+--check`?\s+and the Stop hook/u);
    assert.match(text, /Scope roots: <(?:existing )?folder> \(read\)/u);
  }
});

test("lit-adhd describes the opening lines, the plan window, skipped plans and the HANDOFF step", () => {
  const text = plugin("skills", "lit-adhd", "SKILL.md");
  assert.match(text, /\*\*Three opening lines\*\*/u);
  assert.match(text, /`Done so far:`.*`Doing now:`.*`Next:`/su);
  assert.match(text, /open plans changed inside the window \(this worktree's too\)/u);
  assert.match(text, /the brief says how many were not read/u);
  assert.match(text, /`## Next` or `## Next Steps` in this worktree's own `HANDOFF\*\.md`/u);
});

test("both guides describe the card's session rows, herdr lanes, the done linger and the restart notice", () => {
  const en = read("docs", "guide.md");
  assert.match(en, /a running one is listed first, an idle\s+one after it, and an ended one leaves the card/u);
  assert.match(en, /herdr pane\s+of the same project draws as a lane row/u);
  assert.match(en, /keeps\s+its ✓ for one minute/u);
  assert.match(en, /`restart to <version>`/u);
  const ko = read("docs", "guide_ko-KR.md");
  assert.match(ko, /실행 중인 세션이 먼저, 쉬는 세션이 그다음에/u);
  assert.match(ko, /herdr pane에서 도는 Claude Code 세션/u);
  assert.match(ko, /1분 동안 ✓/u);
  assert.match(ko, /`restart to <version>`/u);
});

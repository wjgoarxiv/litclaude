import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { cancelStartWorkFromUserPrompt, handleStartWorkPreToolUse, initializeStartWork, recordStartWorkSessionEnd, startWorkFromInvocation } from "../plugins/litclaude/lib/start-work-lifecycle.mjs";
import { parseReaders, posixDrivePath } from "../plugins/litclaude/lib/start-work-readers.mjs";

const makeProject = (base) => {
  const root = join(base, "project");
  const outside = join(base, "outside");
  mkdirSync(join(outside, "sub"), { recursive: true });
  writeFileSync(join(outside, "secret.txt"), "s\n");
  for (const dir of ["plans", "src", "wt", "keys", ".claude"]) mkdirSync(join(root, dir), { recursive: true });
  for (const [file, text] of [
    ["src/a.txt", "hello\nworld\n"], ["src/b.txt", "hello\n"], ["src/with space.txt", "x\n"], ["src/reset.mjs", "x\n"], ["src/d.json", "{}\n"],
    ["plans/p.md", "# P\n\n## TODOs\n\n- [ ] 1. one\n"], [".env", "KEY=1\n"], [".mcp.json", "{}\n"], ["keys/server.pem", "x"], [".claude/settings.json", "{}"],
  ]) writeFileSync(join(root, file), text);
  symlinkSync(join(outside, "secret.txt"), join(root, "link-out"));
  symlinkSync(join(outside, "sub"), join(root, "link-dir"));
  mkdirSync(join(root, "wt", "deep"));
  for (const dir of ["+1", "src/+1"]) mkdirSync(join(root, dir));
  symlinkSync(join(root, "wt", "deep"), join(root, "deep-link"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["init", "-q"], { cwd: join(root, "wt") });
  return { root, outside };
};
const call = (root, sessionId, toolName, toolInput, options = {}) => handleStartWorkPreToolUse(root, {
  session_id: sessionId, prompt_id: "p", tool_use_id: "t", cwd: root, tool_name: toolName, tool_input: toolInput,
}, options);
const bash = (root, command, sessionId = "owner", options = {}) => call(root, sessionId, "Bash", { command }, options);

describe("ordinary read-only commands during a run", () => {
  let base;
  let root;
  let outside;
  before(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-readers-")));
    ({ root, outside } = makeProject(base));
    startWorkFromInvocation(root, { sessionId: "owner", promptId: "p1", plan: "plans/p.md" });
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  const allowed = () => [
    "grep -nE \"^(hello|world)$\" src/a.txt", "grep -n \"say \\\"hi\\\"\" src/a.txt", "grep -n \"a && b\" src/a.txt", "grep -n \"git config\" src/a.txt", "grep -rn \"npm publish\" src",
    "grep -c hello src/a.txt 2>/dev/null", "grep -rn hello src --include='*.txt'", "grep -n hello\\|world src/a.txt", "cat src/reset.mjs",
    "tail -n 20 src/a.txt", "tail -20 src/a.txt", "tail -n +2 src/a.txt", "head -n 5 src/a.txt", "head -50 src/a.txt", "head -c 100 src/a.txt",
    "wc -l src/a.txt", "wc src/a.txt src/b.txt", "cat -n src/a.txt", "cat \"src/with space.txt\"", `cat -n "${root}/src/with space.txt"`, "cat src/with\\ space.txt", "nl -ba src/a.txt",
    "sed -n 1,20p src/a.txt", "sed -n '1,20p' src/a.txt", "sed -n \"/hello/,/world/p\" src/a.txt", "sed -n '$p' src/a.txt", "sed -n '/[a-z]/p' src/a.txt", "sed 's/hello/bye/g' src/a.txt",
    "awk '{print $1}' src/a.txt", "awk -F: '{print $2}' src/a.txt", "awk 'NR>=1 && NR<=5' src/a.txt", "awk 'NR>1 {print}' src/a.txt",
    "find . -name \"*.txt\"", "find src -type f", "find src -maxdepth 1 -name '*.mjs' -not -path '*/x/*'", "find src \\( -name a -o -name b \\) -print", "tree src",
    "rg -n -g '*.txt' hello src", "rg --files src", "grep -Rn hello src", "grep -n '`npm test`' src/a.txt", "grep --context=3 hello src/a.txt", "grep -C 3 hello src/a.txt", "grep -3 hello src/a.txt", "rg --type-list", "tree -aL 2 src", "tree -dL 2 src", "tree -dI x src", "rg --no-config hello src", "git branch -l", "cd src && tail -n 3 a.txt | head -1", "grep -e hello -e world src/a.txt", "tree -L 2 -I node_modules src", "awk 1 src/filesystem.txt", "git log --date=format:%G -1", "git branch", "git branch -a", "ls -la src",
    "git log -3 --format='%h %s'", "git rev-parse HEAD", "git ls-files src", "git blame src/a.txt", "git --no-pager log -3", `git -C "${root}/wt" log --oneline -3`, "git show HEAD:src/a.txt", "git branch --show-current",
    "jq . src/d.json", "jq -r '.a | keys[]' src/d.json", "jq '.env' src/d.json", "sort src/a.txt", "sort -u src/a.txt | head -5", "uniq -c src/a.txt", "diff -u src/a.txt src/b.txt | head -40", "cmp src/a.txt src/b.txt",
    "stat src/a.txt", "file src/a.txt", "du -sh src", "cut -d: -f1 src/a.txt", "basename src/a.txt", "realpath src/a.txt", "shasum -a 256 src/a.txt", "which node", "node --version", "npm --version", "test -f src/a.txt",
    "cat src/a.txt | grep -n \"hello$\" | sort | uniq -c | sort -rn", "npm test 2>&1 | tail -n +2", "grep -n hello src/a.txt && tail -n 3 src/a.txt", "cd src && tail -n 3 a.txt && wc -l b.txt", "npm test && tail -n 3 src/a.txt", "/usr/bin/tail -n 3 src/a.txt",
    // git grep and the plain GitHub reads (backlog 9.15).
    "git grep hello", "git grep -n hello -- src", "git grep -n \"a|b\" -- src", "git grep -nE \"^(hello|world)$\" -- src", "git grep -C 2 hello src/a.txt", "git grep -n -e hello -e world HEAD -- src",
    "git grep \"git config\"", "git grep -c hello -- src/a.txt | head -3", `git -C ${root}/wt grep -n x`, "git --no-pager -C wt grep x", "git -C wt --no-pager grep x",
    "gh api repos/o/r/commits/main --jq .sha", "gh api repos/o/r/commits/main -q '.commit.message'", "gh api \"repos/o/r/pulls?state=open\" --jq '.[].number'", "gh api repos/o/r/commits/main --jq .sha | head -1",
    "gh pr list --state open --limit 5 --json number,title", "gh pr view 12 --json state --jq .state", "gh pr view feature/x", "gh run view 123 --log-failed", "gh run view 123 -R o/r --json conclusion",
  ];

  it("run with normal permissions on project paths", () => {
    for (const command of allowed()) {
      const decided = bash(root, command);
      assert.equal(decided.decision, "allow-normal", `${command}: ${decided.reason}`);
    }
  });

  it("run for another session that watches the run", () => {
    for (const command of ["tail -n 3 src/a.txt", "grep -nE \"^(a|b)$\" src/a.txt | head -3", "sed -n '1,3p' src/a.txt"]) {
      assert.equal(bash(root, command, "watcher").decision, "allow-normal", command);
    }
    for (const command of ["tail -n 5 /etc/hosts", `head -3 ${outside}/secret.txt`, "sed -n 1p link-out", "cd .. && tail -n 3 outside/secret.txt", "cat -n .env"]) {
      assert.equal(bash(root, command, "watcher").decision, "deny", command);
    }
  });

  it("name the run in a Bash refusal", () => {
    const { reason } = bash(root, "node -e 1");
    assert.match(reason, /start-work run p-[\w-]+|start-work run [\w-]+/u);
    assert.match(reason, /p\.md/u);
    assert.match(reason, /one plain command per Bash call/u);
  });

  const refused = () => [
    // Redirects, substitution and expansion.
    "cat src/a.txt > out.txt", "cat src/a.txt 2> err.txt", "cat src/a.txt >/dev/null/../x", "cat src/a.txt 2>/dev/nullx", "cat < src/a.txt", "cat <(id)", "grep \"$(id)\" src/a.txt", "cat \"${HOME}/x\"", "cat $'src/a.txt'", "cat ~/x", "cat *.txt", "cat src/{a,b}.txt", "ls \"src/*\"", "cat =ls", "cat ^x",
    // Chains and newlines.
    "cat src/a.txt; id", "cat src/a.txt || id", "cat src/a.txt & id", "cat src/a.txt |& sh", "cat src/a.txt | sh", "cat src/a.txt | tee out", "cat src/a.txt | xargs rm", "cat src/a.txt\nrm -rf src", "cat src/a.txt\r\nrm -rf src", "grep \"a\nb\" src/a.txt", "cat\u00a0src/a.txt", "cat src/a.txt\u2028id", "cat src/a.txt \\\n/etc/hosts", "grep x src/a.txt&&id",
    // Names that are not the plain tool.
    "\\cat src/a.txt", "./cat src/a.txt", "PAGER=id git log", "env X=1 cat src/a.txt", "command cat src/a.txt", "sudo cat src/a.txt", "alias cat=rm", "xargs cat", "eval cat src/a.txt",
    // find, sed, awk, sort and friends with a side effect.
    "find . -delete", "find . -exec rm {} +", "find . -execdir id \\;", "find . -ok id \\;", "find . -fprint out", "find . -fprintf out x", "find . -fls out", "find -L link-dir -name x", "find -files0-from x", "find -f /etc -name x", "find src -newer /etc/hosts", "find . -name x -o -delete",
    "sed -i s/a/b/ src/a.txt", "sed -n -i p src/a.txt", "sed -ni p src/a.txt", "sed --in-place s/a/b/ src/a.txt", "sed -i.bak s/a/b/ src/a.txt", "sed -n 'w out' src/a.txt", "sed 's/a/b/w out' src/a.txt", "sed 's/a/id/e' src/a.txt", "sed 1e src/a.txt", "sed -n 'r /etc/hosts' src/a.txt", "sed -f x src/a.txt", "sed -n '1,5p;w out' src/a.txt", "sed -n -e p -e 'w out' src/a.txt", "sed -n '/a/w out' src/a.txt", "sed -n 's,a,b,w out' src/a.txt", "sed -n '/[/]w out;/p' src/a.txt", "sed -n '/[[:a:]/p;s]/w out;/p' src/a.txt",
    "awk 'BEGIN{system(\"id\")}' src/a.txt", "awk '{print > \"out\"}' src/a.txt", "awk '{print | \"sh\"}' src/a.txt", "awk '{printf \"x\" > \"out\"}' src/a.txt", "awk 'BEGIN{\"id\" | getline x}'", "awk -f x.awk src/a.txt", "awk -i inplace 1 src/a.txt", "awk '@load \"filefuncs\"' src/a.txt", "awk 'BEGIN{print ENVIRON[\"HOME\"]}'", "awk 'BEGIN{ARGV[1]=\"/etc/passwd\";ARGC=2}{print}'", "awk 'BEGIN{@f()}' src/a.txt", "awk '{print \"}\" > \"out\"}' src/a.txt", "awk -v x=1 -f y src/a.txt", "awk -o out 1 src/a.txt",
    "sort -o out src/a.txt", "sort -oout src/a.txt", "sort --outp=out src/a.txt", "sort -uo out src/a.txt", "sort --compress-program=id src/a.txt", "sort -T /tmp src/a.txt", "sort --files0-from=x", "sort src/a.txt -o src/b.txt", "uniq src/a.txt out.txt", "xxd -r src/a.txt out", "xxd src/a.txt out", "tree -o out src", "file -C -m x", "file -f list", "diff -X /etc/hosts src src", "diff --to-file=/etc/hosts src/a.txt", "diff -l src/a.txt src/b.txt", "wc --files0-from=list", "du --files0-from=list", "shasum -c sums",
    "tail -f src/a.txt", "tail -F src/a.txt", "tail --pid=1 src/a.txt", "tail --follow src/a.txt",
    "rg --pre id x src", "rg --pre=id x src", "rg --hostname-bin=id x src", "rg --hostname-bin id x src", "rg -f /etc/hosts src", "rg -z x src", "rg --search-zip x src", "grep -f /etc/hosts src/a.txt", "grep -f/etc/hosts src/a.txt", "grep --fil /etc/hosts src/a.txt", "grep --fil=/etc/hosts src/a.txt", "grep --exclude-fro=/etc/hosts a src/a.txt",
    "jq -f /etc/hosts src/d.json", "jq -nf x", "jq -n env", "jq '$ENV.HOME' src/d.json", "jq --slurpfile a /etc/hosts . src/d.json", "jq --rawfile a /etc/hosts . src/d.json", "jq -L /tmp . src/d.json", "jq 'import \"x\" as y; .' src/d.json", "jq --args . src/d.json /etc/hosts",
    // git with a program, an output file, a write verb or another repository.
    `git -C ${outside} status`, "git -C .. status", "git -C / log", "git -C . -C / log", "git -c core.pager=id log", "git --exec-path=/tmp status", "git --git-dir=/tmp/x status", "git -p log", "git diff --ext-diff", "git diff --ext", "git log --textcon", "git diff --output=x", "git diff --outpu=x", "git diff --output x", "git diff --no-index src/a.txt /etc/hosts", "git branch new", "git branch -D main", "git ls-files -X/etc/hosts -o", "git blame --contents /etc/hosts src/a.txt", "git grep -O id", "git rev-parse --git-path /etc", "git add src/a.txt", "git add -A", "git stash", "git commit -m x", "git push", "git config user.name x", "git reset --hard", "git fetch", "git lg", "git remote -v update",
    // Inline code and shells, PowerShell included.
    "python3 -c \"print(1)\"", "node -e 1", "node --version --require x", "perl -e 1", "bash -c id", "powershell -Command Remove-Item x", "pwsh -c id", "cmd /c del x", "Remove-Item src/a.txt", "Get-Content src/a.txt | Set-Content x", "Invoke-Expression id", "tee out", "cp src/a.txt src/z", "echo x > y",
    "test -f $(id)", "which node; id",
    // Words the real tool reads another way: xxd takes one flag per word, BSD tools stop at the first operand.
    "xxd -ps src/a.txt src/b.txt", "xxd -ps src/a.txt .litclaude/boulder.json", "cd keys && xxd -ps server.pem", "xxd src/a.txt -p", "cat src/a.txt | xxd -ps out",
    "sed w/tmp/victim -ep src/a.txt", "sed r.env -ep src/a.txt", "sed wout --expression=p src/a.txt", "sed p src/a.txt -n", "uniq src/a.txt -c", "awk 1 -vx=1 src/a.txt",
    "jq -n '$ ENV'", "jq -n '$  __prog_args'", "awk 'BEGIN{print SYMTAB[\"ENV\" \"IRON\"][\"HOME\"]}'", "gawk 'BEGIN{FUNCTAB[\"x\"]}'",
    "git log --show-signature -1", "git log --show-sig -1", "git show --format='%G?' HEAD", "git log --pretty='format:%h %GS'", "yarn --version", "pnpm --version",
    "git log -1 --format=%+GS", "git show '--pretty=format:%-G?' HEAD", "git log '--format=% GK'", "cargo --version", "rustc --version", "go --version",
    "tree -Io x plans/p.md", "tree -Po x .litclaude/boulder.json", "tree -Ix src",
    // A search whose flags hide a file operand, or whose words the shell would expand.
    "grep -ee .env", "grep -eroote /etc/passwd", "grep -e K -drecurse /etc", "rg -e K -rA .env", "rg -e K -gA /etc/hosts", "rg -e K -tmake /etc/hosts", "grep --reg=. .env", "grep --reg . .env", "rg --files /etc",
    "grep {e,.env}", "grep {.,/etc/hosts}", "rg {--pre=./x.sh,y}", "rg [$HOME", "grep x $HOME", "ls -l$IFS/etc", "ls -{a,/etc}", "cat src/a.txt | grep -r K", "cat src/a.txt | rg --files",
    "git branch --unset-upstream", "git branch -umain", "git branch --edit-description", "GIT diff --ext-diff",
    // A `cd` in a pipe or under env leaves the shell where it was.
    "cd src | head -1 && cat ../../outside/secret.txt", "cd src | head -1 && cat ../.env", "cd \"src\" | head -1 && cat a.txt", "env -u X cd src && mkdir -p ../x", "env -u X cd src && cat a.txt", "cd src 2>&1 | head -1 && cat a.txt",
    "egrep --context 1 .env", "/usr/bin/grep --context 1 .env", "cat src/a.txt | grep -3 KEY", "git log -p -- ::.env", "git log -p -- :.env", "git diff -- :/:.env", "cd deep-link && cd .\\. && cat ../src/a.txt", "cd src && cd +1 && cat a.txt", "cd +1", "tree -Lx 2 src",
    // git grep: a pattern comes before the first `--`, flags come before it, and nothing opens a pager or a file list.
    "git grep -- K .env", "git grep -n -- K .env", "git grep x -O vim", "git grep pat -n src", "git grep -nOvim x", "git grep -nO x", "git grep -O vim x", "git grep -Ovim x", "git grep --open-files-in-pager=id x", "git grep --open x",
    "git grep --no-index x /etc", "git grep --no-ind -e x -- /etc/hosts", "git grep -f /etc/hosts", "git grep -f/etc/hosts", "git grep --textc x", "git grep --recurse-submodules x", "git grep --untracked x", "git grep -C /etc x",
    "git grep -e K :/.env", "git grep K ::.env", "git grep -e K :^x", "git grep x -- ':(top).env'", "git grep x -- :/.env", "git grep x -- '*.mjs'", "git grep -e -- x",
    "git -c core.pager=id grep x", "git -C . -C / grep x", "git grep x; id", "git grep $(id)", "git grep x > out", "git grep x | sh", "git grep",
    // gh: a method, a body, a host or an output file turns a read into something else.
    "gh api -X POST repos/o/r/issues", "gh api -XGET repos/o/r", "gh api --method GET repos/o/r", "gh api --method=DELETE repos/o/r", "gh api -f a=b repos/o/r", "gh api -fa=b repos/o/r", "gh api --field=a=b repos/o/r", "gh api --raw-field a=b repos/o/r",
    "gh api --input=/etc/hosts repos/o/r", "gh api --input - repos/o/r", "gh api -H 'X-HTTP-Method-Override: DELETE' repos/o/r", "gh api --hostname evil.example repos/o/r", "gh api --paginate repos/o/r", "gh api --template '{{.}}' repos/o/r", "gh api -i repos/o/r",
    "gh api https://evil.example/x", "gh api //evil/x", "gh api /repos/o/r", "gh api graphql", "gh api user", "gh api repos/o/r/../../../user", "gh api repos/o/r/%2e%2e/user", "gh api 'repos/{owner}/{repo}'", "gh api repos/o/r repos/o/s",
    "gh api repos/o/r --jq env", "gh api repos/o/r --jq '$ENV'", "gh api repos/o/r --jq '\"\\(env.GH_TOKEN)\"'", "gh api repos/o/r --jq '$__loc__'", "gh api repos/o/r --jq input_filename", "gh api repos/o/r --jq",
    "GH_HOST=evil.example gh api repos/o/r", "gh api repos/o/r --jq .x > out", "gh api repos/o/r | sh",
    "gh auth token", "gh auth status -t", "gh config get x", "gh alias set x y", "gh extension exec x", "gh repo clone o/r", "gh pr create", "gh pr merge 1", "gh pr checkout 1", "gh pr comment 1 -b x", "gh run list", "gh run rerun 1", "gh run download 1", "gh run watch 1", "gh secret list",
    "gh pr view 1 --web", "gh pr view 1 -w", "gh pr list -w", "gh pr list --web", "gh run view 1 -w", "gh pr view 1 --comments", "gh pr list -R evil.example/o/r", "gh pr view 1 --repo=evil.example/o/r", "gh pr view https://evil.example/o/r/pull/1", "gh pr list --template x", "gh --repo o/r pr view",
    "gh pr list -R ../..", "gh pr list -R ./.", "gh pr view 1 --repo=../..", "gh run view 1 -R ./x", "gh run view 1 -R x/..",
    // Forms this fix leaves as they were.
    "ps -Ao pid,command", "claude plugin validate src", "zsh src/reset.mjs",
  ];

  it("leave every form with a side effect refused", () => {
    assert.deepEqual(refused().filter((command) => bash(root, command).decision !== "deny"), []);
  });

  it("stay inside the grants, links resolved", () => {
    for (const command of [
      "tail -n 5 /etc/hosts", `head -5 ${outside}/secret.txt`, `wc -l ${outside}/secret.txt`, "sed -n 1p /etc/hosts", "awk '{print}' /etc/hosts", "jq . /etc/hosts", "sort /etc/hosts", "cat -n src/../../outside/secret.txt",
      "cat -n link-out", "head -3 link-out", "sed -n 1p link-out", "wc -l link-dir/x", "cat link-dir/../secret.txt", "cat -n link-dir/../secret.txt", "diff src/a.txt /etc/hosts", "comm src/a.txt /etc/hosts", "find / -name x", "grep -n \"a|b\" /etc/hosts", "cd /etc && tail -n 3 hosts", "git blame /etc/hosts", "tree /", "stat -f %N /etc/hosts", "test -f /etc/hosts",
    ]) assert.equal(bash(root, command).decision, "deny", command);
  });

  it("never open secrets or settings", () => {
    for (const command of [
      "cat -n .env", "head -5 .env", "grep -n \"K|E\" .env", "sed -n 1p .env", "awk 1 .env", "wc -l .env", "sort .env", "jq . .mcp.json", "diff .env src/a.txt", "cut -c1-9 .env", "tail -n 3 keys/server.pem", "xxd keys/server.pem", "cat -n .claude/settings.json", "git diff -- .env", "git blame .env", "git show HEAD:.env", "git show HEAD:src/../.env", "cat '.e''nv'", "cat -n .e\\nv", "cd src && cat -n ../.env", "find .env -type f",
    ]) assert.equal(bash(root, command).decision, "deny", command);
  });
});

const withRun = (fn) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-readers-")));
  try {
    const { root, outside } = makeProject(base);
    startWorkFromInvocation(root, { sessionId: "owner", promptId: "p1", plan: "plans/p.md" });
    return fn(root, outside);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
};
const bashIn = (root, cwd, command, extra = {}) => handleStartWorkPreToolUse(root, {
  session_id: "owner", prompt_id: "p", tool_use_id: "t", cwd, tool_name: "Bash", tool_input: { command }, ...extra,
});
const stored = (root) => {
  const state = JSON.parse(readFileSync(join(root, ".litclaude", "boulder.json"), "utf8"));
  return state.works[state.active_work_id].pending_boundaries;
};
const parkEvents = (root) => {
  try {
    return readFileSync(join(root, ".litclaude", "start-work", "ledger.jsonl"), "utf8").split("\n").filter((line) => line.includes("work.command_parked")).length;
  } catch {
    return 0;
  }
};

describe("git grep and gh stay inside the grants and never open secrets", () => {
  it("refuse a folder, a link or a secret that git grep would read", () => withRun((root, outside) => {
    for (const command of [
      `git -C ${outside} grep x`, "git -C .. grep x", "git -C link-dir grep x", "git grep x -- ../outside/secret.txt", "git grep x -- link-out", "git grep x -- /etc/hosts", "git grep x -- .env", "git grep -e K .env", "git grep K .env",
      "git grep x -- keys/server.pem", "git grep x -- .claude/settings.json", "git grep x HEAD:.env",
    ]) assert.equal(bash(root, command).decision, "deny", command);
    for (const command of ["gh pr list", "gh api repos/o/r/commits/main"]) assert.equal(bashIn(root, outside, command).decision, "deny", `${command} from outside the grants`);
    for (const command of ["git grep x -- src", "git -C wt grep x"]) assert.equal(bash(root, command).decision, "allow-normal", `the allowed twin: ${command}`);
  }));

  it("give parseReaders the new forms and nothing wider", () => {
    assert.deepEqual(
      (({ name, targets, outward }) => ({ name, targets, outward }))(parseReaders("gh api repos/o/r/commits/main --jq .sha")[0]),
      { name: "gh", targets: [], outward: true },
    );
    const [grep] = parseReaders("git -C wt grep -n x -- src");
    assert.equal(grep.git, true);
    assert.equal(grep.dir, "wt");
    assert.deepEqual(grep.targets, ["src"]);
    const [colon] = parseReaders("git grep a/b:c -- src");
    assert.equal(colon.targets.includes("a/b:c"), false, "the pattern is data, never a path");
    assert.equal(colon.maybe.includes("a/b:c"), false);
    for (const command of ["gh api -X POST repos/o/r", "git grep -O x", "gh pr view 1 -w", "gh api repos/o/r | gh api repos/o/r", "git grep -- K .env"]) assert.equal(parseReaders(command), null, command);
  });

  it("reads rg and grep globs only when they are quoted, in the forms the tool takes", () => withRun((root) => {
    for (const command of ["rg -n hello src --glob='*.txt'", "rg -n hello src --iglob '*.TXT'", "rg -n hello src --glob '!*.md'", "rg -n hello src --glob=\"*.txt\"", "grep -rn hello src --include='*.txt' --exclude-dir='x*'"]) {
      assert.equal(bash(root, command).decision, "allow-normal", command);
    }
    for (const command of ["rg -n hello src --glob=*.txt", "grep -rn hello src --include=*.txt"]) {
      assert.equal(bash(root, command).decision, "deny", command);
    }
    assert.equal(stored(root).some((boundary) => boundary.command.includes("hello")), false, "an unquoted glob is answered, never stored");
  }));
});

describe("gh is the owner's read only; git grep reads for a watcher and after cancel", () => {
  it("lets a watching session run git grep on watched paths and refuses its gh calls", () => withRun((root) => {
    assert.equal(bash(root, "git grep hello -- src", "watcher").decision, "allow-normal");
    for (const command of ["gh pr list", "gh api repos/o/r/commits/main", "cd src && gh pr list", "gh pr list | head -1"]) assert.equal(bash(root, command, "watcher").decision, "deny", command);
    assert.equal(bash(root, "git grep hello -- .env", "watcher").decision, "deny");
  }));

  it("lets a cancelled session run git grep and refuses its gh calls", () => withRun((root) => {
    assert.ok(cancelStartWorkFromUserPrompt(root, { sessionId: "other", promptId: "cancel-1" })?.cancelled, "the run was cancelled from another window");
    assert.equal(bash(root, "git grep hello -- src").decision, "allow-normal");
    for (const command of ["gh pr list", "gh api repos/o/r/commits/main", "cd src && gh pr list", "gh pr list | head -1"]) assert.equal(bash(root, command).decision, "deny", command);
  }));
});

describe("a read the guard cannot run is answered, not stored", () => {
  const quotedAnswer = (root, command, extra = {}) => {
    const decided = bashIn(root, root, command, extra);
    assert.equal(decided.decision, "deny", command);
    assert.match(decided.reason, /nothing was parked/u, command);
    return decided.reason;
  };
  const answerCases = (root, extra = {}) => {
    const hinted = [
      ["grep -rn hello src --include=*.txt", "grep -rn hello src --include='*.txt'"],
      ["rg -n hello src --glob !*.md", "rg -n hello src --glob '!*.md'"],
      ["rg -n hello src -g *.txt", "rg -n hello src -g '*.txt'"],
    ];
    for (const [command, quoted] of hinted) {
      assert.ok(quotedAnswer(root, command, extra).includes(`\`${quoted}\``), command);
      assert.equal(bashIn(root, root, quoted, extra).decision, "allow-normal", `the quoted form runs: ${quoted}`);
    }
    assert.equal(stored(root).some((boundary) => boundary.command.includes("hello")), false, "nothing was stored");
    assert.equal(parkEvents(root), 0);
  };

  it("quotes the glob and stores nothing", () => withRun((root) => answerCases(root)));
  it("does the same for a lane that shares the owner's session", () => withRun((root) => answerCases(root, { agent_id: "lane-1" })));

  it("still gives the answer when the pattern names a forbidden word, and says nothing of shape", () => withRun((root) => {
    const reason = quotedAnswer(root, "grep -rn \"git push\" src --include=*.txt");
    assert.ok(reason.includes("`grep -rn \"git push\" src --include='*.txt'`"));
    assert.doesNotMatch(reason, /only for its shape/u);
    assert.equal(stored(root).length, 0);
  }));

  it("never offers the quoted form unless that command is an allowed read", () => withRun((root) => {
    const pluginRoot = realpathSync(fileURLToPath(new URL("../plugins/litclaude", import.meta.url)));
    for (const command of [
      "grep -rn x /etc --include=*.txt", "grep -rn x .env --include=*.txt", "grep -rn x src --include=*.{js,mjs}", "rg -f /etc/hosts x --glob *.md",
      `grep -rn "${"a".repeat(620)}" src --include=*.txt`, "find . -name *.txt",
    ]) {
      const decided = bash(root, command);
      assert.equal(decided.decision, "deny", command);
      assert.equal(decided.reason.includes("Run `"), false, command.slice(0, 80));
    }
    for (const command of ["grep -rn x /etc --include=*.txt", `grep -rn "${"a".repeat(620)}" src --include=*.txt`]) {
      assert.match(bash(root, command).reason, /nothing was parked/u, command.slice(0, 80));
    }
    assert.equal(stored(root).some((boundary) => boundary.command.includes(".env")), false, "a secret is refused, never stored");
    for (const command of ["grep -rn x src --include=*.txt; id", "grep -rn x src --include=$(id)", "grep -rn x src --include=*.txt > out", "grep -rn x src --include=*.{js,mjs}", "find . -name *.txt"]) {
      assert.equal(bash(root, command).decision, "deny", command);
      assert.ok(stored(root).some((boundary) => boundary.command === command), `still parked: ${command}`);
    }
    const reason = quotedAnswer(root, `grep -rn lit ${pluginRoot}/skills --include=*.md`);
    assert.ok(reason.includes(`\`grep -rn lit ${pluginRoot}/skills --include='*.md'\``), "the plugin's own files are a read the run may do");
  }));

  it("refuses a read outside the grants with the Scope roots hint and stores nothing", () => withRun((root) => {
    for (const command of ["tail -n 3 /etc/hosts", "git -C /etc log -1", "cd /etc && cat hosts"]) {
      const decided = bash(root, command);
      assert.equal(decided.decision, "deny", command);
      assert.match(decided.reason, /nothing was parked/u, command);
      assert.match(decided.reason, /Scope roots/u, command);
    }
    assert.deepEqual(stored(root), []);
  }));

  it("keeps parking what is not a read", () => withRun((root) => {
    for (const command of ["git grep -n x", "gh pr view 1"]) assert.equal(bash(root, command).decision, "allow-normal", `the read beside them runs: ${command}`);
    for (const command of ["git tag v1", "gh api -X POST repos/o/r/issues", "git grep -O vim x", "grep \"$(id)\" src/a.txt", "ps -Ao pid,command", "zsh src/reset.mjs"]) {
      assert.equal(bash(root, command).decision, "deny", command);
      assert.ok(stored(root).some((boundary) => boundary.command === command), `parked: ${command}`);
    }
    assert.ok(stored(root).find((boundary) => boundary.command === "grep \"$(id)\" src/a.txt").hold_reason, "held, never replayed");
  }));
});

describe("the reader grammar on Windows spellings", () => {
  it("maps Git Bash drive paths to the drive, on Windows only", () => {
    assert.equal(posixDrivePath("/c/Users/me/a.txt", "win32"), "c:/Users/me/a.txt");
    assert.equal(posixDrivePath("/cygdrive/d/x", "win32"), "d:/x");
    assert.equal(posixDrivePath("/c", "win32"), "c:/");
    assert.equal(posixDrivePath("/etc/hosts", "win32"), "/etc/hosts");
    assert.equal(posixDrivePath("/c/Users/me/a.txt", "darwin"), "/c/Users/me/a.txt");
  });

  it("reads a quoted backslash path as one operand", () => {
    const [segment] = parseReaders("tail -n 3 \"C:\\Users\\me\\a b.txt\"");
    assert.deepEqual(segment.targets, ["C:\\Users\\me\\a b.txt"]);
  });

  it("gives nothing for PowerShell and cmd forms", () => {
    for (const command of ["Get-Content src/a.txt", "gc a.txt; rm b", "type src\\a.txt", "findstr /n hello src\\a.txt", "Select-String -Path a -Pattern b"]) assert.equal(parseReaders(command), null, command);
  });
});

describe("a run of another session", () => {
  const withRun = (fn) => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-stale-")));
    try {
      const { root } = makeProject(base);
      initializeStartWork(root, { plan: "plans/p.md", workId: "w1", sessionId: "owner", grants: [`read:${root}`, `write:${root}`], idempotencyKey: "k1" });
      fn(root);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  };
  const state = (root) => JSON.parse(readFileSync(join(root, ".litclaude", "boulder.json"), "utf8")).works.w1;

  it("never limits this session once its owner ended or went idle", () => withRun((root) => {
    const now = Date.now();
    assert.equal(bash(root, "npm run anything", "other", { now }).decision, "deny", "a live run keeps its files");
    const idle = { now: now + 2 * 60 * 60 * 1000 + 1000 };
    for (const [tool, input] of [["Bash", { command: "npm run anything; echo x > y" }], ["Edit", { file_path: join(root, "src", "a.txt") }], ["Agent", { subagent_type: "x" }]]) {
      assert.equal(call(root, "other", tool, input, idle).decision, "allow-normal", tool);
    }
    recordStartWorkSessionEnd(root, { session_id: "owner" });
    assert.equal(call(root, "other", "Edit", { file_path: join(root, "src", "a.txt") }).decision, "allow-normal");
    assert.equal(state(root).status, "active", "the work itself is kept for a takeover");
  }));

  it("counts as live again when its owner comes back", () => withRun((root) => {
    recordStartWorkSessionEnd(root, { session_id: "owner" });
    assert.ok(state(root).root_session_ended_at);
    assert.equal(call(root, "owner", "Read", { file_path: join(root, "src", "a.txt") }).decision, "allow-normal");
    assert.equal(state(root).root_session_ended_at, undefined);
    assert.equal(call(root, "other", "Edit", { file_path: join(root, "src", "a.txt") }).decision, "deny");
  }));
});

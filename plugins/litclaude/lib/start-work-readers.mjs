// The closed grammar of plain read-only shell commands a start-work run lets through: `tail -n 20 f`,
// `grep -nE "a|b" f | head`, `sed -n '1,5p' f`, `git -C dir log`. A command passes only when every
// character, tool, flag and value is known here; everything else gives null and meets the guard's
// stricter checks, so an unknown flag can never turn into a write or a program start. This module
// reads no file: the caller resolves the returned paths, judges links, grants and protected files.

// Words and operators of a command, or null. `bare` is false once a quote or a backslash was seen.
// Any character the shell would expand, chain, redirect or treat as a blank other than space and tab
// refuses the whole command. In double quotes a `$` is literal only before the closing quote, `|` or
// `)`, as in "^(a|b)$"; a backtick is literal only in single quotes.
const UNSAFE_BARE = /[;&|<>()`$*?[\]{}#]/u;
const UNSAFE_ANYWHERE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const tokenize = (command) => {
  const tokens = [];
  let word = null;
  const push = () => {
    if (word) tokens.push(word);
    word = null;
  };
  const add = (text, bare) => {
    word ??= { text: "", bare: true };
    word.text += text;
    word.bare &&= bare;
  };
  for (let index = 0; index < command.length; index += 1) {
    const ch = command[index];
    if (ch === " " || ch === "\t") {
      push();
      continue;
    }
    if (UNSAFE_ANYWHERE.test(ch) || /\s/u.test(ch)) return null;
    if (ch === "'" || ch === "\"") {
      add("", false);
      let closed = false;
      for (index += 1; index < command.length; index += 1) {
        const inner = command[index];
        if (inner === ch) {
          closed = true;
          break;
        }
        if (UNSAFE_ANYWHERE.test(inner) || (ch === "\"" && inner === "`")) return null;
        if (ch === "\"" && inner === "$" && !/["|)]/u.test(command[index + 1] ?? "")) return null;
        if (ch === "\"" && inner === "\\" && /["\\$]/u.test(command[index + 1] ?? "")) {
          index += 1;
          add(command[index], false);
        } else {
          add(inner, false);
        }
      }
      if (!closed) return null;
      continue;
    }
    if (ch === "\\") {
      const next = command[index + 1] ?? "";
      if (!next || next === "`" || UNSAFE_ANYWHERE.test(next)) return null;
      index += 1;
      add(next, false);
      continue;
    }
    const rest = command.slice(index);
    const quiet = word === null ? /^2>(?:&1|[ \t]*\/dev\/null)(?=[ \t|]|$)/u.exec(rest) : null;
    if (quiet) {
      index += quiet[0].length - 1;
      continue;
    }
    if (ch === "|" && !/^\|[|&]/u.test(rest)) {
      push();
      tokens.push({ op: "|" });
      continue;
    }
    if (/^&&[ \t]/u.test(rest) && word === null) {
      tokens.push({ op: "&&" });
      index += 1;
      continue;
    }
    if (UNSAFE_BARE.test(ch) || (word === null && /[~=^]/u.test(ch))) return null;
    add(ch, true);
  }
  push();
  return tokens;
};

const ANY = /^/u;
const NUM = /^\d+$/u;
const NAME = /^[\w-]+$/u;
const COUNT = /^[+-]?\d+[kKmMgGbB]?$/u;
const LIST = /^[\d,-]+$/u;

// `short`: flags without a value; `value`: short flags with one, and what it may be; `long`: long flags
// without a value; `longValue`: long flags with one; `longMaybe`: an optional `=value`; `number`: `-20`.
// BSD tools stop reading flags at the first operand, so there a flag's separate value would be a file:
// after an operand only a number may follow as one, unless the tool is known to look further (`mixes`).
// `lead`: the tool runs or writes one of its operands, so a flag after the first one refuses the command.
// `apart`: the tool takes a value only from the next word, so a value flag must end its word.
const parseArgs = (args, spec) => {
  const operands = [];
  const seen = new Set();
  let ended = false;
  const nextValue = (index) => {
    const value = args[index + 1]?.text;
    return operands.length === 0 || spec.mixes || NUM.test(value ?? "") ? value : undefined;
  };
  for (let index = 0; index < args.length; index += 1) {
    const { text } = args[index];
    if (ended || text === "-" || !text.startsWith("-")) {
      operands.push(text);
      continue;
    }
    if (spec.lead && operands.length > 0) return null;
    if (text === "--") {
      ended = true;
      continue;
    }
    if (text.startsWith("--")) {
      const at = text.indexOf("=");
      const name = text.slice(2, at < 0 ? undefined : at);
      const inline = at < 0 ? undefined : text.slice(at + 1);
      seen.add(name);
      if (Object.hasOwn(spec.longValue ?? {}, name)) {
        const value = inline ?? nextValue(index);
        if (inline === undefined) index += 1;
        if (value === undefined || !spec.longValue[name].test(value)) return null;
      } else if (Object.hasOwn(spec.longMaybe ?? {}, name)) {
        if (inline !== undefined && !spec.longMaybe[name].test(inline)) return null;
      } else if (inline !== undefined || !(spec.long ?? []).includes(name)) {
        return null;
      }
      continue;
    }
    if (spec.number && /^-\d+$/u.test(text)) {
      seen.add("number");
      continue;
    }
    for (let at = 1; at < text.length; at += 1) {
      const flag = text[at];
      seen.add(flag);
      if ((spec.short ?? "").includes(flag)) continue;
      if (!Object.hasOwn(spec.value ?? {}, flag) || (spec.apart && at < text.length - 1)) return null;
      const inline = text.slice(at + 1);
      const value = inline || nextValue(index);
      if (!inline) index += 1;
      if (value === undefined || !spec.value[flag].test(value)) return null;
      break;
    }
  }
  return { operands, seen };
};

const files = (spec, limit = Infinity) => (args) => {
  const parsed = parseArgs(args, spec);
  return parsed && parsed.operands.length <= limit ? { targets: parsed.operands } : null;
};
const data = (spec) => (args) => (parseArgs(args, spec) ? { targets: [] } : null);

const GREP = {
  short: "aEFGPHhLlnoqsvwxcirRzbI",
  value: { A: NUM, B: NUM, C: NUM, m: NUM, e: ANY },
  long: ["count", "ignore-case", "line-number", "invert-match", "word-regexp", "line-regexp", "files-with-matches", "files-without-match", "only-matching", "quiet", "silent", "no-messages", "with-filename", "no-filename", "extended-regexp", "fixed-strings", "basic-regexp", "perl-regexp", "text", "recursive", "null", "byte-offset", "line-buffered"],
  longValue: { regexp: ANY, include: ANY, exclude: ANY, "exclude-dir": ANY, "max-count": NUM, "after-context": NUM, "before-context": NUM, "binary-files": NAME },
  longMaybe: { color: NAME, colour: NAME, context: NUM },
  number: true,
};
const RG = {
  mixes: true,
  short: "acFHhiIlnNoPpqsSuUvwx.0",
  value: { A: NUM, B: NUM, C: NUM, m: NUM, M: NUM, j: NUM, d: NUM, g: ANY, t: NAME, T: NAME, e: ANY, r: ANY, E: NAME },
  long: ["files", "type-list", "no-config", "passthru", "pretty", "hidden", "no-ignore", "no-ignore-vcs", "no-ignore-parent", "count", "count-matches", "files-with-matches", "files-without-match", "ignore-case", "smart-case", "case-sensitive", "line-number", "no-line-number", "heading", "no-heading", "with-filename", "no-filename", "only-matching", "fixed-strings", "word-regexp", "line-regexp", "multiline", "multiline-dotall", "pcre2", "invert-match", "json", "stats", "trim", "vimgrep", "no-messages", "quiet", "text", "null", "column"],
  longValue: { glob: ANY, iglob: ANY, type: NAME, "type-not": NAME, "max-count": NUM, "max-depth": NUM, "max-columns": NUM, "after-context": NUM, "before-context": NUM, context: NUM, regexp: ANY, replace: ANY, encoding: NAME, color: NAME, sort: NAME, sortr: NAME },
};
const search = (spec) => (args) => {
  const parsed = parseArgs(args, spec);
  if (!parsed) return null;
  const given = ["e", "regexp", "files", "type-list"].some((flag) => parsed.seen.has(flag));
  if (!given && parsed.operands.length === 0) return null;
  // These search or list the working folder even behind a pipe (`-3` is a depth to ugrep), so they are no filter.
  const walks = ["r", "R", "recursive", "files", "number"].some((flag) => parsed.seen.has(flag));
  return { walks, targets: given ? parsed.operands : parsed.operands.slice(1) };
};

// find: search roots, then tests and printers from a closed set. `-exec`, `-ok`, `-delete` and the
// `-fprint` family are absent, and so are the options that follow links or name a root elsewhere.
const FIND_PLAIN = new Set(["!", "(", ")", "-not", "-a", "-and", "-o", "-or", "-prune", "-print", "-print0", "-ls", "-quit", "-empty", "-readable", "-writable", "-executable", "-true", "-false", "-depth", "-xdev", "-mount"]);
const FIND_VALUE = new Map([
  ...["-name", "-iname", "-path", "-ipath", "-wholename", "-iwholename", "-regex", "-iregex", "-printf"].map((flag) => [flag, ANY]),
  ["-type", /^[bcdpfls,]+$/u], ["-maxdepth", NUM], ["-mindepth", NUM], ["-size", /^[+-]?\d+[bcwkMG]?$/u], ["-perm", /^[-/+]?[\w=+,]+$/u], ["-user", NAME], ["-group", NAME], ["-regextype", NAME],
  ...["-mtime", "-mmin", "-ctime", "-cmin", "-atime", "-amin", "-links", "-inum"].map((flag) => [flag, /^[+-]?\d+$/u]),
]);
const find = (args) => {
  const texts = args.map(({ text }) => text);
  const targets = [];
  let index = 0;
  for (; index < texts.length && !/^[-(!]/u.test(texts[index]); index += 1) targets.push(texts[index]);
  for (; index < texts.length; index += 1) {
    const text = texts[index];
    if (FIND_PLAIN.has(text)) continue;
    const value = texts[index + 1];
    if (value === undefined) return null;
    index += 1;
    if (text === "-newer") {
      if (value.startsWith("-")) return null;
      targets.push(value);
    } else if (!FIND_VALUE.has(text) || !FIND_VALUE.get(text).test(value)) {
      return null;
    }
  }
  return { targets };
};

// sed: line addresses with p, d, q or =, and s/// without its `e` and `w` flags. A bracket expression
// that could hide the delimiter is refused, because sed builds disagree on where that regex ends.
const SIMPLE_BRACKET = /\[\^?(?:\[:[a-z]+:\]|[^[\]/|,#:@!%+\\])+\]/gu;
const plainRegex = (text) => !/[[\]]/u.test(text.replace(/\\./gsu, "").replace(SIMPLE_BRACKET, ""));
const SED_ADDRESS = /^(?:\d+|\$|\/((?:[^/\\]|\\.)+)\/I?)/su;
const SED_COMMAND = /^[ \t]*!?[ \t]*(?:p|d|=|q\d*|s([/|,#:@!%+])((?:(?!\1)[^\\]|\\.)*)\1((?:(?!\1)[^\\]|\\.)*)\1[gpIi0-9]*)[ \t]*(?:;|$)/su;
const sedScript = (script) => {
  let rest = script.trim();
  if (!rest) return false;
  while (rest) {
    for (const part of [1, 2]) {
      const address = SED_ADDRESS.exec(rest);
      if (address) {
        if (address[1] !== undefined && !plainRegex(address[1])) return false;
        rest = rest.slice(address[0].length);
      }
      if (part === 2) break;
      const comma = address ? /^,[ \t]*(?:\+\d+)?/u.exec(rest) : null;
      if (!comma) break;
      rest = rest.slice(comma[0].length);
      if (comma[0].includes("+")) break;
      if (!SED_ADDRESS.test(rest)) return false;
    }
    const command = SED_COMMAND.exec(rest);
    if (!command || (command[2] !== undefined && !plainRegex(command[2]))) return false;
    rest = rest.slice(command[0].length).trim();
  }
  return true;
};
const SED = { lead: true, short: "nErsu", value: { e: ANY }, long: ["quiet", "silent", "regexp-extended"], longValue: { expression: ANY } };
const sed = (args) => {
  const parsed = parseArgs(args, SED);
  if (!parsed) return null;
  const scripts = [];
  for (const [index, { text }] of args.entries()) {
    if (text === "--") break;
    if (text.startsWith("--expression=")) scripts.push(text.slice("--expression=".length));
    else if (text === "--expression") scripts.push(args[index + 1].text);
    else if (/^-[nErsu]*e/u.test(text)) scripts.push(text.replace(/^-[nErsu]*e/u, "") || args[index + 1].text);
  }
  const targets = scripts.length ? parsed.operands : parsed.operands.slice(1);
  if (!scripts.length) scripts.push(parsed.operands[0] ?? "");
  return scripts.every(sedScript) ? { targets } : null;
};

// awk: no command, no file it opens itself, no redirect. Strings and regexes are not told apart, so
// the checks run over the raw text: a lone `|`, or a `>` anywhere after a print, refuses the program.
const AWK_UNSAFE = /system|getline|ENVIRON|ARG[CV]|PROCINFO|SYMTAB|FUNCTAB|@/u;
const AWK = { lead: true, value: { F: ANY, v: /^[A-Za-z_]\w*=/u } };
const awk = (args) => {
  const parsed = parseArgs(args, AWK);
  if (!parsed?.operands.length) return null;
  const [program, ...targets] = parsed.operands;
  // Every other word is a file name, unless it sets a variable or a flag.
  if (AWK_UNSAFE.test(program) || args.some(({ text }) => /^-|=/u.test(text) && AWK_UNSAFE.test(text))) return null;
  const printAt = program.indexOf("print");
  if (program.replaceAll("||", "").includes("|") || (printAt >= 0 && program.includes(">", printAt))) return null;
  return { targets };
};

// jq: one filter over named files. The environment, modules and files named by a flag stay out.
const JQ_UNSAFE = /(?<![."\w])(?:env|import|include|modulemeta|input_filename|get_search_list)\b|\$\s*(?:ENV|__)/u;
const JQ = { short: "rcnesSRaMCj", long: ["raw-output", "compact-output", "null-input", "exit-status", "slurp", "sort-keys", "raw-input", "ascii-output", "monochrome-output", "color-output", "join-output", "tab"], longValue: { indent: NUM } };
const jq = (args) => {
  const parsed = parseArgs(args, JQ);
  if (!parsed || parsed.operands.length === 0 || JQ_UNSAFE.test(parsed.operands[0])) return null;
  return { targets: parsed.operands.slice(1) };
};

// gh: GitHub reads over the network. No method, field, input, header, host, URL, template or web flag
// exists in any spec, so a call can only GET one repository's data; `outward` marks it for the caller.
const JQ_SAFE = { test: (value) => !JQ_UNSAFE.test(value) };
const GH_REPO = /^(?!\.{1,2}\/)[\w.-]+\/(?!\.{1,2}$)[\w.-]+$/u;
const GH_FIELDS = /^[A-Za-z]+(?:,[A-Za-z]+)*$/u;
const GH_STATE = /^(?:open|closed|merged|all)$/u;
const GH_ENDPOINT = /^repos\/[\w.-]+\/[\w.-]+(?:\/[\w.@:+~,-]+)*(?:\?[\w.@:+~,=&%-]*)?$/u;
const GH_JSON = { value: { R: GH_REPO, q: JQ_SAFE }, longValue: { repo: GH_REPO, json: GH_FIELDS, jq: JQ_SAFE } };
const GH = {
  api: { mixes: true, value: { q: JQ_SAFE }, longValue: { jq: JQ_SAFE } },
  "pr list": { mixes: true, value: { ...GH_JSON.value, s: GH_STATE, L: NUM }, longValue: { ...GH_JSON.longValue, state: GH_STATE, limit: NUM } },
  "pr view": { mixes: true, ...GH_JSON },
  "run view": { mixes: true, ...GH_JSON, long: ["log", "log-failed"] },
};
const gh = (args) => {
  const texts = args.map(({ text }) => text);
  const key = texts[0] === "api" ? "api" : `${texts[0]} ${texts[1]}`;
  if (!Object.hasOwn(GH, key)) return null;
  const parsed = parseArgs(args.slice(key === "api" ? 1 : 2), GH[key]);
  if (!parsed || parsed.operands.length > 1) return null;
  const [operand] = parsed.operands;
  if (key === "api" && !(operand && operand.length <= 300 && GH_ENDPOINT.test(operand)
    && !operand.split("?")[0].split("/").some((part) => part === "." || part === ".."))) return null;
  if (key === "pr list" && operand !== undefined) return null;
  if (key === "pr view" && operand !== undefined && !/^(?:\d+|[A-Za-z0-9_][\w./-]*)$/u.test(operand)) return null;
  if (key === "run view" && operand !== undefined && !/^\d+$/u.test(operand)) return null;
  return { targets: [], outward: true };
};

// git: verbs that only read, in this checkout or in `-C <dir>`. A flag that starts a program, writes a
// file or reads a named file is out, with every abbreviation git accepts for it.
const GIT_PROGRAM_FLAGS = ["output", "ext-diff", "textconv", "open-files-in-pager", "exec-path", "show-signature", "no-index"];
export const gitFlagIsUnsafe = (word) => {
  const name = /^--([a-z][a-z-]*)(?:=|$)/u.exec(word)?.[1];
  return name !== undefined && name !== "text" && GIT_PROGRAM_FLAGS.slice(0, 6).some((flag) => flag.startsWith(name));
};
const GIT_VALUE_FLAG = /^--(?:format|pretty|grep|author|committer|since|until|after|before|date|diff-filter|abbrev|max-count|skip|stat|color|word-diff|unified|untracked-files|porcelain|ignore-submodules|decorate)=/u;
// No pathspec magic (`:(top)x`, `:!x`) and no glob: the protected-file check reads the plain name.
const GIT_OPERAND = /^[\p{L}\p{N}_.\/@^~:=+, -]+$/u;
const GIT_SHORT = /^-(?:\d+|n|[pusbzwRaMCDcmtr]+|U\d+|n\d+|[SG].+)$/u;
const GIT_CLOSED = {
  "rev-parse": { long: ["show-toplevel", "abbrev-ref", "verify", "is-inside-work-tree", "git-dir", "git-common-dir", "show-prefix", "show-cdup", "quiet"], longMaybe: { short: NUM } },
  "ls-files": { short: "cdmosuz", long: ["cached", "deleted", "modified", "others", "stage", "unmerged", "exclude-standard", "error-unmatch", "full-name", "directory"] },
  blame: { short: "wslefnpt", value: { L: /^[\d,+-]+$/u }, long: ["line-porcelain", "porcelain", "show-email", "show-name", "show-number"] },
  branch: { short: "arvl",long: ["show-current", "all", "remotes", "list", "merged", "no-merged", "verbose"] },
  remote: { short: "v", long: ["verbose"] },
};
// git grep: the flags below, then a pattern, then revisions; pathspecs follow `--`. `lead` refuses a flag
// after the pattern, as git does, and an allowlist leaves out every flag that opens a pager, reads a
// pattern file or leaves the index (`-O`, `-f`, `--no-index`, `--untracked`, `--recurse-submodules`).
const GIT_GREP = { lead: true, short: "inwvEFlc", value: { e: ANY, A: NUM, B: NUM, C: NUM }, long: ["cached"] };
const gitGrep = (dir, words) => {
  const cut = words.indexOf("--");
  const before = cut < 0 ? words : words.slice(0, cut);
  const paths = cut < 0 ? [] : words.slice(cut + 1);
  const parsed = parseArgs(before.map((text) => ({ text })), GIT_GREP);
  if (!parsed) return null;
  // `git grep -- K .env` takes K as the pattern and reads .env, so a pattern must come before the first `--`.
  const given = parsed.seen.has("e");
  if (!given && parsed.operands.length === 0) return null;
  const revs = given ? parsed.operands : parsed.operands.slice(1);
  if (revs.some((word) => !GIT_OPERAND.test(word) || /^:[/:^]/u.test(word))) return null;
  if (paths.some((word) => !GIT_OPERAND.test(word) || word.startsWith(":"))) return null;
  const found = { git: true, dir, targets: [...paths], maybe: [] };
  for (const word of revs) {
    found.maybe.push(word);
    if (word.includes(":")) found.targets.push(word.slice(word.lastIndexOf(":") + 1) || ".");
  }
  return found;
};
const git = (args) => {
  let rest = args.map(({ text }) => text);
  let dir = null;
  for (;;) {
    if (rest[0] === "--no-pager") rest = rest.slice(1);
    else if (rest[0] === "-C" && dir === null && rest[1] && !rest[1].startsWith("-")) {
      [, dir] = rest;
      rest = rest.slice(2);
    } else break;
  }
  const [verb, ...words] = rest;
  if (verb === "grep") return gitGrep(dir, words);
  if (words.some((word) => !word.startsWith("-") && !GIT_OPERAND.test(word))) return null;
  // `:/x` and `::x`, and after `--` any `:` word, name another file than they spell.
  const ended = words.includes("--") ? words.indexOf("--") : words.length;
  if (words.some((word, index) => (index > ended ? word.startsWith(":") : /^:[/:^]/u.test(word)))) return null;
  const found = { git: true, dir, targets: [], maybe: [] };
  const operand = (word) => {
    found.maybe.push(word);
    if (word.includes(":")) found.targets.push(word.slice(word.lastIndexOf(":") + 1) || ".");
  };
  if (Object.hasOwn(GIT_CLOSED, verb ?? "")) {
    const parsed = parseArgs(words.map((text) => ({ text })), GIT_CLOSED[verb]);
    if (!parsed) return null;
    if (verb === "remote") return parsed.operands.length === 0 ? found : null;
    if (verb === "branch") return parsed.operands.length === 0 || parsed.seen.has("list") ? found : null;
    if (verb === "rev-parse") parsed.operands.forEach(operand);
    else found.targets.push(...parsed.operands);
    return found;
  }
  if (!["status", "diff", "log", "show"].includes(verb)) return null;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--") {
      found.targets.push(...words.slice(index + 1));
      break;
    }
    if (!word.startsWith("-")) operand(word);
    else if (word.startsWith("--")) {
      // A `%G` format starts gpg, with or without one of git's `%+`, `%-` and `% ` modifiers.
      if (/^--(?:format|pretty)=/u.test(word) && /%[-+ ]?G/u.test(word)) return null;
      if (GIT_VALUE_FLAG.test(word)) continue;
      const name = word.slice(2);
      if (!/^[a-z][a-z-]*$/u.test(name) || (name !== "text" && GIT_PROGRAM_FLAGS.some((flag) => flag.startsWith(name)))) return null;
    } else if (!GIT_SHORT.test(word)) return null;
  }
  return found;
};

const CHECKSUM = files({ short: "bt", long: ["binary", "text", "tag"] });
// `yarn`, `pnpm`, `cargo`, `rustc` and `go` can run the version a repository names, so they are absent.
const VERSIONED = new Set(["node", "npm", "npx", "bun", "deno", "python", "python3", "pip", "pip3", "git", "gh", "rg", "grep", "jq", "java", "ruby", "perl", "bash", "zsh", "make", "cmake", "docker", "claude", "uv"]);
const TOOLS = {
  cat: files({ short: "nbestuvAET", long: ["number", "number-nonblank", "show-all", "squeeze-blank", "show-ends", "show-tabs", "show-nonprinting"] }),
  head: files({ short: "qv", value: { n: COUNT, c: COUNT }, long: ["quiet", "verbose"], longValue: { lines: COUNT, bytes: COUNT }, number: true }),
  tail: files({ short: "qvr", value: { n: COUNT, c: COUNT }, long: ["quiet", "verbose"], longValue: { lines: COUNT, bytes: COUNT }, number: true }),
  wc: files({ short: "lwcmL", long: ["lines", "words", "bytes", "chars", "max-line-length"] }),
  nl: files({ value: { b: /^(?:[atn]|p.*)$/u, n: /^(?:ln|rn|rz)$/u, w: NUM, v: NUM, i: NUM, s: ANY } }),
  stat: files({ short: "xlsL", value: { f: /^[^/]*%[^/]*$/u, c: /^[^/]*%[^/]*$/u }, longValue: { format: /^[^/]*%[^/]*$/u, printf: /^[^/]*%[^/]*$/u } }),
  file: files({ short: "biIkh", long: ["brief", "mime", "mime-type", "mime-encoding"] }),
  du: files({ short: "shackmx", value: { d: NUM }, long: ["summarize", "human-readable", "all", "total", "apparent-size"], longValue: { "max-depth": NUM } }),
  df: files({ short: "hkmPT" }),
  cut: files({ short: "sn", value: { d: ANY, f: LIST, c: LIST, b: LIST }, long: ["complement", "only-delimited"], longValue: { delimiter: ANY, fields: LIST, characters: LIST, bytes: LIST, "output-delimiter": ANY } }),
  sort: files({ short: "bdfgiMhnRrVcCmsuz", value: { k: /^[\w.,]+$/u, t: /^.{1,2}$/su }, long: ["reverse", "unique", "numeric-sort", "general-numeric-sort", "human-numeric-sort", "version-sort", "ignore-case", "stable", "check"], longValue: { key: /^[\w.,]+$/u, "field-separator": /^.{1,2}$/su } }),
  uniq: files({ lead: true, short: "cduiz", value: { f: NUM, s: NUM, w: NUM }, long: ["count", "repeated", "unique", "ignore-case"] }, 1),
  diff: files({ short: "ucqwbBiyNastpE", value: { U: NUM, C: NUM, W: NUM }, long: ["brief", "ignore-all-space", "ignore-space-change", "ignore-blank-lines", "ignore-case", "side-by-side", "suppress-common-lines", "text", "new-file"], longValue: { width: NUM }, longMaybe: { unified: NUM, context: NUM, color: NAME } }, 2),
  cmp: files({ short: "lsb", value: { n: NUM }, long: ["verbose", "quiet", "silent", "print-bytes"] }, 2),
  comm: files({ short: "123i" }, 2),
  paste: files({ short: "s", value: { d: ANY } }),
  column: files({ short: "t", value: { s: ANY, c: NUM } }),
  tac: files({}),
  rev: files({}),
  fold: files({ short: "bs", value: { w: NUM } }),
  od: files({ short: "bcdovx", value: { A: /^[doxn]$/u, t: /^\w+$/u, N: /^\w+$/u, j: /^\w+$/u } }, 1),
  hexdump: files({ short: "bcCdovx", value: { n: NUM, s: /^\w+$/u } }),
  // GNU strings reads more arguments from an `@file` operand.
  strings: (args) => (args.some(({ text }) => text.startsWith("@")) ? null : files({ short: "a", value: { n: NUM, t: /^[dox]$/u }, number: true })(args)),
  md5: files({ short: "qr" }),
  md5sum: CHECKSUM,
  sha1sum: CHECKSUM,
  sha256sum: CHECKSUM,
  sha512sum: CHECKSUM,
  b2sum: CHECKSUM,
  cksum: files({}),
  shasum: files({ short: "bt", value: { a: NUM }, longValue: { algorithm: NUM } }),
  realpath: files({ short: "emqsz" }),
  readlink: files({ short: "femnqsvz" }),
  ls: files({ short: "aAbBcCdeFfgGhHiklLmnoOpPqrRsStTuUvwWxX1@%", long: ["all", "almost-all", "human-readable", "directory", "recursive", "reverse", "size", "full-time", "group-directories-first", "inode", "numeric-uid-gid"], longMaybe: { color: NAME, sort: NAME, time: NAME, "time-style": /^[\w+-]+$/u, format: NAME, classify: NAME } }),
  tree: files({ apart: true, short: "adfishDCnpugrtJXF", value: { L: NUM, I: ANY, P: ANY }, long: ["dirsfirst", "noreport", "gitignore", "prune"], longValue: { filelimit: NUM } }),
  basename: data({ short: "az", value: { s: ANY } }),
  dirname: data({ short: "z" }),
  tr: data({ short: "cCdstu" }),
  grep: search(GREP),
  egrep: search(GREP),
  fgrep: search(GREP),
  rg: search(RG),
  find,
  sed,
  awk,
  gawk: awk,
  jq,
  git,
  gh,
  which: (args) => (args.length > 0 && args.every(({ text }) => /^(?:-a|[A-Za-z][\w.+-]*)$/u.test(text)) ? { targets: [] } : null),
  command: (args) => (args.length === 2 && args[0].text === "-v" && /^[A-Za-z][\w.+-]*$/u.test(args[1].text) ? { targets: [] } : null),
  test: (args) => (args.length === 2 && /^-[fdersxLhw]$/u.test(args[0].text) && !args[1].text.startsWith("-") ? { targets: [args[1].text] } : null),
  // zsh reads `cd +1` as a place on its folder stack.
  cd: (args) => (args.length === 1 && !/^[-~+]/u.test(args[0].text) ? { cd: args[0].text, targets: [] } : null),
};
// Tools that read standard input when they get no file, so they may follow a pipe.
const FILTERS = new Set(["cat", "head", "tail", "wc", "nl", "cut", "sort", "uniq", "paste", "column", "tac", "rev", "fold", "od", "hexdump", "tr", "grep", "egrep", "fgrep", "rg", "sed", "awk", "gawk", "jq", "md5sum", "sha1sum", "sha256sum", "shasum", "cksum"]);

const readPart = (words) => {
  const [head, ...args] = words;
  if (!head?.bare) return null;
  if (VERSIONED.has(head.text) && args.length === 1 && args[0].text === "--version") return { name: head.text, targets: [] };
  const name = /^(?:\/(?:usr\/)?bin\/)?([a-z][a-z0-9]*)$/u.exec(head.text)?.[1];
  if (!name || !Object.hasOwn(TOOLS, name)) return null;
  const read = TOOLS[name](args);
  if (!read) return null;
  return { ...read, name, ticked: args.some(({ text }) => text.includes("`")), targets: read.targets.filter((target) => target !== "-") };
};
const isFilter = (read) => read !== null && FILTERS.has(read.name) && read.targets.length === 0 && !read.git && !read.walks && !read.ticked;

const split = (tokens, op) => {
  const groups = [[]];
  for (const token of tokens) {
    if (token.op === op) groups.push([]);
    else groups.at(-1).push(token);
  }
  return groups;
};

const MAX_FILTERS = 4;

/**
 * The segments of a command made only of readers, joined by ` && `, each with up to four filters that
 * read only their standard input; null for anything else. A segment is `{ cd }`, or `{ targets, maybe, dir }`:
 * `targets` are paths, `maybe` are git operands that are a path when they hold a `/` or name a file,
 * `dir` is git's `-C` folder, which those paths are relative to.
 */
export const parseReaders = (command) => {
  const tokens = typeof command === "string" ? tokenize(command) : null;
  if (!tokens?.length) return null;
  const segments = [];
  for (const segment of split(tokens, "&&")) {
    const [first, ...filters] = split(segment, "|").map(readPart);
    if (!first || filters.length > MAX_FILTERS || !filters.every(isFilter) || (first.cd !== undefined && filters.length)) return null;
    segments.push(first);
  }
  return segments;
};

const GLOB_SEARCHES = new Set(["grep", "egrep", "fgrep", "rg"]);
const GLOB_INLINE = { grep: /^(--(?:include|exclude|exclude-dir))=(.*)$/su, rg: /^(--(?:glob|iglob))=(.*)$/su };
// No brace: the shell would split it into several words, and quoting it would change the meaning.
const isGlobValue = (value) => /^[\w.*?[\]!\/,-]+$/u.test(value) && /[*?[]/u.test(value);

/**
 * A grep or rg command with the unquoted glob in `--include=`, `--exclude=`, `--exclude-dir=`, `--glob=`,
 * `--iglob=` and `--glob <g>` / `-g <g>` put in single quotes, or null when there is no such glob or the
 * text is not plain enough to rewrite. Pure text: the result is a suggestion the caller must judge again.
 */
export const quoteGlobValues = (command) => {
  if (typeof command !== "string" || UNSAFE_ANYWHERE.test(command)) return null;
  const words = [];
  let start = -1;
  let plain = true;
  let quote = null;
  const close = (end) => {
    if (start >= 0) words.push({ start, end, text: command.slice(start, end), plain });
    start = -1;
    plain = true;
  };
  for (let index = 0; index < command.length; index += 1) {
    const ch = command[index];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === " " || ch === "\t") {
      close(index);
      continue;
    }
    if (start < 0) start = index;
    if (ch === "'" || ch === "\"") {
      quote = ch;
      plain = false;
    } else if (ch === "\\") {
      plain = false;
    }
  }
  if (quote) return null;
  close(command.length);
  if (!words[0]?.plain || !GLOB_SEARCHES.has(words[0].text)) return null;
  const rg = words[0].text === "rg";
  const edits = [];
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (!word.plain) continue;
    if (word.text === "--") break;
    const inline = GLOB_INLINE[rg ? "rg" : "grep"].exec(word.text);
    if (inline) {
      if (isGlobValue(inline[2])) edits.push([word.start + inline[1].length + 1, word.end]);
    } else if (rg && ["--glob", "--iglob", "-g"].includes(word.text) && words[index + 1]?.plain && isGlobValue(words[index + 1].text)) {
      index += 1;
      edits.push([words[index].start, words[index].end]);
    }
  }
  if (edits.length === 0) return null;
  let out = "";
  let at = 0;
  for (const [from, to] of edits) {
    out += `${command.slice(at, from)}'${command.slice(from, to)}'`;
    at = to;
  }
  return out + command.slice(at);
};

/** Whether one pipe part only reads its standard input and prints. */
export const isReaderFilter = (part) => {
  const tokens = tokenize(part);
  return Boolean(tokens?.length) && tokens.every((token) => !token.op) && isFilter(readPart(tokens));
};

/** Git Bash spells a Windows drive `/c/...` and Cygwin `/cygdrive/c/...`; elsewhere those are plain paths. */
export const posixDrivePath = (path, platform = process.platform) => {
  if (platform !== "win32") return path;
  const match = /^\/(?:cygdrive\/)?([A-Za-z])(?:\/(.*))?$/su.exec(path);
  return match ? `${match[1]}:/${match[2] ?? ""}` : path;
};

// `lit invite @<github-id>` (plans/invite-pilot.md): the invitee records who invited them, and the
// LIT card shows its `club` look from then on. Honor system and cosmetic only: the record lives in
// `$LITCLAUDE_HOME/invite.json` (`~/.litclaude/invite.json` by default) on this machine, nothing is
// sent anywhere, and the messages only print the Discussions link where invites are counted.
//
// The home folder and `invite.json` must be real (a symlink at either is refused), the record is
// written to a fresh temporary file and renamed into place, and the first inviter is kept.

import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DISCUSSIONS_URL = "https://github.com/wjgoarxiv/litfamily/discussions";
export const INVITE_FILE = "invite.json";

const ID = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const MAX_RECORD_BYTES = 4096;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

/** The GitHub id after stripping one leading `@`, or null when it is not one. */
export const parseInviteId = (raw) => {
  if (typeof raw !== "string") return null;
  const id = raw.startsWith("@") ? raw.slice(1) : raw;
  return ID.test(id) ? id : null;
};

// Only a whole prompt counts, spelled like `lit approve` (start-work-lifecycle.mjs APPROVE_TOKEN):
// a longer, quoted or relayed message that merely mentions `lit invite` keeps its ordinary route.
const INVITE_PROMPT = /^lit[ \t]+invite(?:[ \t]+(\S+))?$/iu;

/** `{ id }` (null for a bare `lit invite`) when the whole prompt is an invite, else null. */
export const parseInvitePrompt = (prompt) => {
  if (typeof prompt !== "string" || prompt.length > 512) return null;
  const match = INVITE_PROMPT.exec(prompt.trim());
  return match ? { id: match[1] ?? null } : null;
};

/** Same rule as automatic-update.mjs resolveHome: LITCLAUDE_HOME, else ~/.litclaude. */
export const inviteHome = (env = process.env) => (env.LITCLAUDE_HOME ? env.LITCLAUDE_HOME : join(homedir(), ".litclaude"));

const validRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
  && value.version === 1 && parseInviteId(value.invitedBy) === value.invitedBy && typeof value.at === "string" && Number.isFinite(Date.parse(value.at));

const realFolder = (path) => {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** The stored record, or null when there is none or it is not a real, well-formed file. */
export const readInvite = ({ home = inviteHome() } = {}) => {
  if (!realFolder(home)) return null;
  const path = join(home, INVITE_FILE);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_RECORD_BYTES) return null;
    const value = JSON.parse(readFileSync(path, "utf8"));
    return validRecord(value) ? { version: 1, invitedBy: value.invitedBy, at: value.at } : null;
  } catch {
    return null;
  }
};

const writeRecord = (home, record) => {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (!realFolder(home)) throw new Error("the LitClaude home is not a real folder");
  const target = join(home, INVITE_FILE);
  try {
    if (!lstatSync(target).isFile()) throw new Error("invite.json is not a regular file");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = join(home, `.${INVITE_FILE}.${process.pid}.${Date.now()}.tmp`);
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW, 0o600);
  try {
    try {
      writeSync(fd, `${JSON.stringify(record)}\n`);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
};

/**
 * Records `raw` as this machine's inviter. `{ status }` is `invalid` (nothing written), `recorded`,
 * `same` (that id is already the inviter), `kept` (another id already is; `requested` is the one
 * refused) or `failed` (the home or the file could not be written safely; nothing written).
 */
export const recordInvite = (raw, { home = inviteHome(), now = () => new Date() } = {}) => {
  const id = parseInviteId(raw);
  if (!id) return { status: "invalid", input: typeof raw === "string" ? raw : "" };
  const existing = readInvite({ home });
  if (existing) {
    return existing.invitedBy.toLowerCase() === id.toLowerCase()
      ? { status: "same", record: existing }
      : { status: "kept", record: existing, requested: id };
  }
  const record = { version: 1, invitedBy: id, at: now().toISOString() };
  try {
    writeRecord(home, record);
  } catch (error) {
    return { status: "failed", reason: error?.code ?? (error instanceof Error ? error.message : "write failed") };
  }
  return { status: "recorded", record };
};

/** What to tell friends: the line they type, and where invites are counted. */
export const shareLine = () =>
  `Invite a friend: ask them to type \`lit invite @<your GitHub id>\` in Claude Code with LitClaude. They get the club card look, and you both can say hi in ${DISCUSSIONS_URL}`;

/** The message one recordInvite result prints, in the CLI and as the prompt hook's answer. */
export const inviteMessage = (result) => {
  switch (result?.status) {
    case "recorded":
      return `Thanks for joining through @${result.record.invitedBy}. The club look is on for your LIT card (turn it off with \`litclaude-ai config club off\`). Nothing was sent anywhere; if you like, post "invited by @${result.record.invitedBy}" in ${DISCUSSIONS_URL}`;
    case "same":
      return `You were already invited by @${result.record.invitedBy}; nothing changed. The thread: ${DISCUSSIONS_URL}`;
    case "kept":
      return `You were already invited by @${result.record.invitedBy}, and the first invite stays; @${result.requested} was not recorded. The thread: ${DISCUSSIONS_URL}`;
    case "invalid":
      return "That is not a GitHub id: use letters, digits and single hyphens, up to 39 characters, not starting with a hyphen (for example `lit invite @octocat`). Nothing was recorded.";
    default:
      return `The invite could not be saved (${result?.reason ?? "unknown error"}): the LitClaude home folder or invite.json is not a plain, writable file. Nothing was recorded.`;
  }
};

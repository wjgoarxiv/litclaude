// Redaction for every string the lit-adhd collector emits. Terminal escape sequences, control and
// format characters go first, so neither an OSC link in a commit subject nor a zero-width space
// inside a key survives. Credential shapes, webhook URLs and URI userinfo come next; `NAME=value`
// and JSON `"name": "value"` pairs with a secret-like name lose their value; any substring equal to
// a current environment value of 8+ characters is replaced (compared here, never printed); the home
// directory becomes `~`. Path-shaped and locale/terminal values are not credentials and stay, or
// every path in the brief would be blanked; a URL is kept only when it is a bare origin. Callers
// redact the whole text and clip afterwards, so a clip cannot cut a secret below its shape.

import { SECRET_SHAPE_PATTERNS, URI_USERINFO_PATTERN } from "../secret-shapes.mjs";

const MASK = "[redacted]";
const SECRET_NAME = /KEY|TOKEN|SECRET|PASS|AUTH|COOKIE|WEBHOOK/iu;
const ASSIGNMENT = /\b([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s"'`]+)/gu;
const JSON_PAIR = /"([A-Za-z_][A-Za-z0-9_-]*)"(\s*:\s*)"(?:[^"\\]|\\.)*"/gu;
const WEBHOOK = /\bhttps?:\/\/(?:hooks\.slack\.com\/(?:services|workflows|triggers)|(?:[a-z0-9-]+\.)?discord(?:app)?\.com\/api\/webhooks|[a-z0-9-]+\.webhook\.office\.com|outlook\.office\.com\/webhook)\/[^\s"'`<>]+/giu;
// CSI and OSC sequences whole, then any other C0/C1 control (tab and newline stay) and format character.
const TERMINAL_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u009b[0-?]*[ -/]*[@-~]|\u009d[^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-_]?/gu;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}]/gu;
export const stripControls = (text) => String(text).replace(TERMINAL_SEQUENCE, "").replace(CONTROL, "");
const PLAIN_ENV_NAMES = /^(?:PATH|HOME|PWD|OLDPWD|SHELL|USER|LOGNAME|LANG|LANGUAGE|TERM|TERM_PROGRAM|TERM_PROGRAM_VERSION|COLORTERM|EDITOR|VISUAL|PAGER|TMPDIR|SHLVL|LC_[A-Z]+|XPC_[A-Z_]+|__CF[A-Z_]*|COMMAND_MODE|_)$/u;
const globalOf = (pattern) => new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
const SHAPES = [...SECRET_SHAPE_PATTERNS.map(globalOf)];
const USERINFO = globalOf(URI_USERINFO_PATTERN);

// A URL-form value is a secret when it carries more than an origin: a webhook path, a query or userinfo.
const carriesUrlSecret = (value) => {
  try {
    const url = new URL(value);
    return /^https?:$/u.test(url.protocol) && (url.pathname.length > 1 || url.search !== "" || url.username !== "");
  } catch {
    return false;
  }
};
const envSecrets = (env) => Object.entries(env ?? {})
  .filter(([name, value]) => typeof value === "string" && value.length >= 8 && !PLAIN_ENV_NAMES.test(name)
    && !/^[~/]/u.test(value) && (!value.includes(":/") || carriesUrlSecret(value)) && !/^(?:true|false|\d+)$/iu.test(value))
  .map(([, value]) => value)
  .sort((a, b) => b.length - a.length);

/** A redactor bound to one environment and home, so the env scan happens once per run. */
export const makeRedactor = ({ env = process.env, home = env?.HOME } = {}) => {
  const values = envSecrets(env);
  return (input) => {
    if (typeof input !== "string" || input === "") return input;
    let text = stripControls(input);
    for (const value of values) if (text.includes(value)) text = text.split(value).join(MASK);
    text = text.replace(WEBHOOK, MASK);
    text = text.replace(USERINFO, (match) => match.replace(/\/\/[^/?#\s]+@/u, `//${MASK}@`));
    text = text.replace(ASSIGNMENT, (match, name) => (SECRET_NAME.test(name) ? `${name}=${MASK}` : match));
    text = text.replace(JSON_PAIR, (match, name, colon) => (SECRET_NAME.test(name) ? `"${name}"${colon}"${MASK}"` : match));
    for (const pattern of SHAPES) text = text.replace(pattern, MASK);
    if (typeof home === "string" && home.length > 1) text = text.split(home).join("~");
    return text;
  };
};

// Redaction for every string the lit-adhd collector emits. Credential shapes and URI userinfo come
// from the shared secret-shape set; `NAME=value` pairs with a secret-like name lose their value; any
// substring equal to a current environment value of 8+ characters is replaced (compared here,
// never printed); the home directory becomes `~`. Path-shaped and locale/terminal values are not
// credentials and stay, or every path in the brief would be blanked.

import { SECRET_SHAPE_PATTERNS, URI_USERINFO_PATTERN } from "../secret-shapes.mjs";

const MASK = "[redacted]";
const SECRET_NAME = /KEY|TOKEN|SECRET|PASS|AUTH|COOKIE/iu;
const ASSIGNMENT = /\b([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s"'`]+)/gu;
const PLAIN_ENV_NAMES = /^(?:PATH|HOME|PWD|OLDPWD|SHELL|USER|LOGNAME|LANG|LANGUAGE|TERM|TERM_PROGRAM|TERM_PROGRAM_VERSION|COLORTERM|EDITOR|VISUAL|PAGER|TMPDIR|SHLVL|LC_[A-Z]+|XPC_[A-Z_]+|__CF[A-Z_]*|COMMAND_MODE|_)$/u;
const globalOf = (pattern) => new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
const SHAPES = [...SECRET_SHAPE_PATTERNS.map(globalOf)];
const USERINFO = globalOf(URI_USERINFO_PATTERN);

const envSecrets = (env) => Object.entries(env ?? {})
  .filter(([name, value]) => typeof value === "string" && value.length >= 8 && !PLAIN_ENV_NAMES.test(name)
    && !/^[~/]/u.test(value) && !value.includes(":/") && !/^(?:true|false|\d+)$/iu.test(value))
  .map(([, value]) => value)
  .sort((a, b) => b.length - a.length);

/** A redactor bound to one environment and home, so the env scan happens once per run. */
export const makeRedactor = ({ env = process.env, home = env?.HOME } = {}) => {
  const values = envSecrets(env);
  return (input) => {
    if (typeof input !== "string" || input === "") return input;
    let text = input;
    for (const value of values) if (text.includes(value)) text = text.split(value).join(MASK);
    text = text.replace(USERINFO, (match) => match.replace(/\/\/[^/?#\s]+@/u, `//${MASK}@`));
    text = text.replace(ASSIGNMENT, (match, name) => (SECRET_NAME.test(name) ? `${name}=${MASK}` : match));
    for (const pattern of SHAPES) text = text.replace(pattern, MASK);
    if (typeof home === "string" && home.length > 1) text = text.split(home).join("~");
    return text;
  };
};

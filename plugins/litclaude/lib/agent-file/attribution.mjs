// The attribution switch. `keep` (the default) leaves Claude Code's own Co-Authored-By trailer and pull
// request line as the host writes them; `off` hides them through Claude Code's native `attribution`
// setting and adds one line to the LitFamily block. The object form below hides all three parts on every
// Claude Code version (`attribution: false` needs 2.1.281, and older versions skip the whole file).
// Before the first change LitClaude keeps the user's earlier value in its own settings record, and
// restoring puts exactly that value back.

import { readLitConfigKey, writeLitConfigKey } from "../mark.mjs";

export const ATTRIBUTION_MODES = Object.freeze(["keep", "off"]);
export const HIDDEN_ATTRIBUTION = Object.freeze({ commit: "", pr: "", sessionUrl: false });
export const ATTRIBUTION_LINE = "- Do not add `Co-Authored-By` lines or other AI attribution to commits or pull requests.";

/** The stored choice, or undefined when the user never made one. */
export const storedAttributionMode = (litHome) => {
  const stored = readLitConfigKey(litHome, "attribution");
  return ATTRIBUTION_MODES.includes(stored) ? stored : undefined;
};

export const readAttributionMode = ({ env = process.env, litHome }) => {
  const override = String(env.LITCLAUDE_ATTRIBUTION ?? "").trim().toLowerCase();
  if (ATTRIBUTION_MODES.includes(override)) return override;
  return storedAttributionMode(litHome) ?? "keep";
};

export const writeAttributionMode = (litHome, mode) => {
  if (!ATTRIBUTION_MODES.includes(mode)) throw new Error(`attribution takes one of: ${ATTRIBUTION_MODES.join(", ")}`);
  return writeLitConfigKey(litHome, "attribution", mode);
};

const isHidden = (value) => JSON.stringify(value) === JSON.stringify(HIDDEN_ATTRIBUTION);

/**
 * Hides attribution in `settings`; `record` (LitClaude's settings entry) keeps the earlier value once.
 * When LitClaude hid it before and the user has since set their own value, that value wins: nothing is
 * changed and the result is `user-changed` (otherwise `hidden`).
 */
export const applyAttribution = (settings, record) => {
  if (Object.hasOwn(record, "attributionPrior")) {
    if (Object.hasOwn(settings, "attribution") && !isHidden(settings.attribution)) return "user-changed";
  } else {
    record.attributionPrior = Object.hasOwn(settings, "attribution")
      ? { had: true, value: structuredClone(settings.attribution) }
      : { had: false };
  }
  settings.attribution = { ...HIDDEN_ATTRIBUTION };
  return "hidden";
};

/**
 * Puts back the value `applyAttribution` replaced, but only while the setting still holds what
 * LitClaude wrote; a value the user set since, or one LitClaude never touched, is left alone.
 */
export const restoreAttribution = (settings, record) => {
  if (!record || !Object.hasOwn(record, "attributionPrior")) return;
  const prior = record.attributionPrior;
  if (isHidden(settings.attribution)) {
    if (prior?.had) settings.attribution = prior.value;
    else delete settings.attribution;
  }
  delete record.attributionPrior;
};

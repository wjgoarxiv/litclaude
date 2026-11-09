// Interface-mode wording for frontend-ui-ux: build (the default), polish, audit and harden.
//
// Input is the hook's normalized prompt text (lower-cased, code removed, `-` and `_` turned into
// spaces), so "stress-test" arrives as "stress test" and "read-only" as "read only". Hangul terms
// are bare stems for the same agglutination reason the hook's UI route gives. Mode words say
// nothing about the object; the hook pairs them with its interface-noun check before routing, so
// "이 문단 다듬어줘" or "서버 상태 점검" never reach the skill. Video, 영상, 모션 and 발표 wording
// is deliberately absent: those belong to other skills.

// A fix requested in the same breath turns an audit back into an editing mode.
const FIX_REQUEST = /고쳐\s*줘|바로\s*고쳐|고치고|수정해\s*줘|\b(?:then|and) fix\b|\bfix (?:everything|it all|them all)\b/u;
const AUDIT = /\baudit\w*|\bread only\b|\bjust check\b|\btell me what['’]?s wrong\b|점검|검토만/u;
const HARDEN = /\bharden\w*|\bstress test\w*|\bholds? up (?:under|with)\b|\brobust to\b|튼튼하게|견고하게/u;
const NEGATED_HARDEN = /\b(?:don['’]?t|do not|no|without)\s+(?:stress test\w*|harden\w*)/gu;
const POLISH = /\bpolish\w*|\bclean up the styling\b|\btighten up\b|\bsame layout\b|\bwithout redesigning\b|\bdon['’]?t restructure\b|\bkeep every \w+ where\b|다듬|그대로\s*두고|구조는\s*(?:그대로|손대지)/u;
// Polish never restructures: wording that asks for a new layout or a rebuild is a build.
const REBUILD = /(?<!without )\bredesign\w*|\bcompletely new\b|\bbrand new\b|\bfrom scratch\b|전체를\s*다시|다시\s*짜|새로\s*(?:만들|짜)/u;

export const INTERFACE_MODES = Object.freeze(["build", "polish", "audit", "harden"]);

// True when the text carries a polish, audit or harden word (negated harden wording excluded).
export function hasInterfaceModeWord(normalized) {
  const text = normalized.replace(NEGATED_HARDEN, " ");
  return AUDIT.test(text) || HARDEN.test(text) || POLISH.test(text);
}

export function interfaceMode(normalized) {
  const text = normalized.replace(NEGATED_HARDEN, " ");
  if (AUDIT.test(text) && !FIX_REQUEST.test(text)) return "audit";
  if (HARDEN.test(text)) return "harden";
  if (POLISH.test(text) && !REBUILD.test(text)) return "polish";
  return "build";
}

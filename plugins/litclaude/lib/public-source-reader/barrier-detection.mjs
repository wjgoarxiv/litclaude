const visibleText = (html) =>
  html
    .replace(/<(?:script|style|noscript)\b[\s\S]*?<\/(?:script|style|noscript)>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

const pageTitle = (html) => /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1]?.replace(/<[^>]+>/gu, " ").trim() ?? "";

const hasSubstantiveContainer = (html, text) => /<(?:article|main)\b/iu.test(html) && text.length >= 160;

export const looksErrorTemplate = (html = "", title = "", contentText = "") => {
  const marker = /\b(access denied|permission denied|request (?:was |has been )?rejected|forbidden|service unavailable|page unavailable|an error occurred)\b/iu;
  if (!marker.test(title) && !marker.test(contentText)) return false;
  const directTitle = /^(?:access denied|permission denied|request (?:was |has been )?rejected|forbidden|service unavailable|page unavailable|an error occurred)$/iu.test(title.trim());
  return directTitle || (!hasSubstantiveContainer(html, contentText) && contentText.length <= 2_000);
};

export const looksAuthRequired = (html = "") => {
  const marker = /\b(sign in|required login|log in to continue|subscribe to continue|paywall)\b/iu;
  if (!marker.test(html)) return false;
  const text = visibleText(html);
  const directTitle = /^(?:sign in required|required login|log in to continue|subscribe to continue|paywall)$/iu.test(pageTitle(html));
  const authControls = /<form\b[^>]*(?:login|sign-?in|auth|subscribe)|<input\b[^>]*type\s*=\s*["']?password/iu.test(html);
  return directTitle || authControls || (!hasSubstantiveContainer(html, text) && text.length <= 800);
};

export const looksChallengeRequired = (html = "") => {
  const marker = /\b(verify you are human|checking your browser|captcha|security check|browser check|are you a robot|unusual traffic|automated access)\b/iu;
  if (!marker.test(html)) return false;
  const text = visibleText(html);
  const directTitle = /^(?:checking|checking your browser|security check|verify you are human|captcha)$/iu.test(pageTitle(html));
  const challengeControls = /<(?:form|iframe|script)\b[^>]*(?:captcha|challenge|security-check|verify)/iu.test(html);
  return directTitle || challengeControls || (!hasSubstantiveContainer(html, text) && text.length <= 800);
};

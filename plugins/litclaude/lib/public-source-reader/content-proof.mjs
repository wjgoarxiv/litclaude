import { looksChallengeRequired, looksErrorTemplate } from "./barrier-detection.mjs";


export const contentTypeEssence = (value = "") => value.split(";", 1)[0].trim().toLowerCase();

const isJsonContentType = (value) => {
  const essence = contentTypeEssence(value);
  return essence === "application/json" || essence.endsWith("+json");
};

const isHtmlContentType = (value) => {
  const essence = contentTypeEssence(value);
  return !essence || essence === "text/html" || essence === "application/xhtml+xml";
};

export const isReadableTextContentType = (value) => {
  const essence = contentTypeEssence(value);
  return (
    !essence ||
    essence.startsWith("text/") ||
    isJsonContentType(essence) ||
    essence === "application/xml" ||
    essence.endsWith("+xml")
  );
};

export const classifyHttpError = (fetched) => {
  if (fetched.statusCode === 401 || fetched.statusCode === 403) {
    return { ok: false, status: "auth-required", reason: `http-${fetched.statusCode}`, contentValidation: "not-ok" };
  }
  if (fetched.statusCode === 404) return { ok: false, status: "not-found", reason: "http-404", contentValidation: "not-ok" };
  if (fetched.statusCode === 429) return { ok: false, status: "rate-limited", reason: "http-429", contentValidation: "not-ok" };
  return {
    ok: false,
    status: "fetch-error",
    reason: fetched.reason ?? `http-${fetched.statusCode}`,
    contentValidation: fetched.statusCode ? "not-ok" : "not-read",
  };
};

const classifyJsonContent = (fetched) => {
  let parsed;
  try {
    parsed = JSON.parse(fetched.body);
  } catch {
    return { ok: false, status: "fetch-error", reason: "invalid-json", contentValidation: "invalid-json" };
  }

  const isObject = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  const isEmpty = parsed === null || (Array.isArray(parsed) && parsed.length === 0) || (isObject && Object.keys(parsed).length === 0);
  if (isEmpty) return { ok: false, status: "fetch-error", reason: "empty-json", contentValidation: "empty-json" };

  const numericStatus = isObject ? Number(parsed.status) : 0;
  const hasErrorShape = isObject && (Object.hasOwn(parsed, "error") || Object.hasOwn(parsed, "errors") || numericStatus >= 400);
  if (contentTypeEssence(fetched.contentType) === "application/problem+json" || hasErrorShape) {
    return { ok: false, status: "fetch-error", reason: "problem-json", contentValidation: "error-json" };
  }

  return { ok: true, status: "strong", reason: null, contentValidation: "valid-json" };
};

export const classifyFetchedContent = ({ fetched, metadata, contentText }) => {
  if (fetched.authRequired) {
    return {
      ok: false,
      status: "auth-required",
      reason: "auth-or-paywall-marker",
      contentValidation: "auth-required",
    };
  }

  if (isHtmlContentType(fetched.contentType) && looksChallengeRequired(fetched.body ?? "")) {
    return { ok: false, status: "blocked", reason: "challenge-detected", contentValidation: "challenge" };
  }

  if (isJsonContentType(fetched.contentType)) return classifyJsonContent(fetched);

  if (
    isHtmlContentType(fetched.contentType) &&
    looksErrorTemplate(fetched.body ?? "", metadata.title ?? "", contentText)
  ) {
    return { ok: false, status: "blocked", reason: "error-template-detected", contentValidation: "error-template" };
  }

  if (fetched.ok && !(fetched.body ?? "").trim()) {
    return { ok: false, status: "fetch-error", reason: "empty-response", contentValidation: "empty" };
  }

  if (fetched.ok && !contentText && !metadata.title && !metadata.description && metadata.jsonLd.length === 0) {
    return { ok: false, status: "fetch-error", reason: "no-readable-content", contentValidation: "no-readable-content" };
  }

  return { ok: true, status: "strong", reason: null, contentValidation: "valid" };
};

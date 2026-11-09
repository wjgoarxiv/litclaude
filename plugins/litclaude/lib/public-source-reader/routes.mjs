import { validatePublicSourceTarget } from "./validator.mjs";
import { redactPublicUrl } from "./guard.mjs";
import { requestPinnedHttp } from "./pinned-request.mjs";
import { looksAuthRequired } from "./barrier-detection.mjs";

const authRequiredMessage =
  "This source appears to require authentication or paywall access. Provide a public URL, exported artifact, or excerpt instead; LitClaude will not cross login or private-data controls.";

export const authRequiredResult = (resolvedUrl, stopReason, evidence, extra = {}) => ({
  ok: false,
  status: "auth-required",
  route: "direct-http",
  stopReason,
  message: authRequiredMessage,
  metadata: {},
  contentText: "",
  evidence,
  ...extra,
  resolvedUrl: redactPublicUrl(resolvedUrl),
});

const readLimitedText = async (response, maxBytes) => {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel?.();
    return { tooLarge: true, text: "" };
  }

  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) return { tooLarge: true, text: "" };
    return { tooLarge: false, text };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { tooLarge: true, text: "" };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { tooLarge: false, text: new TextDecoder().decode(bytes) };
};

export const fetchDirectHttp = async (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  const fetchImpl = options.fetchImpl;
  const maxRedirects = options.maxRedirects ?? 5;
  const maxBytes = options.maxBytes ?? 2_000_000;
  const headers = {
    accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
    "user-agent": "LitClaudePublicSourceReader/0.3 (+https://github.com/wjgoarxiv/litclaude)",
  };
  try {
    let currentUrl = url;
    let currentValidation = options.validatedTarget;
    const redirectChain = [];
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      options.sourceUrlCollector?.(currentUrl);
      if (!fetchImpl && (!currentValidation?.ok || currentValidation.url !== currentUrl)) {
        currentValidation = await validatePublicSourceTarget(currentUrl, options);
      }
      if (!fetchImpl && !currentValidation?.ok) {
        return {
          ok: false,
          blocked: currentValidation?.status === "blocked",
          reason: currentValidation?.reason ?? "dns-pinning-unavailable",
          statusCode: 0,
          resolvedUrl: currentUrl,
          contentType: "",
          body: "",
          redirectChain,
        };
      }

      const response = fetchImpl
        ? await fetchImpl(currentUrl, { signal: controller.signal, redirect: "manual", headers })
        : await requestPinnedHttp(currentUrl, currentValidation.addresses, {
            headers,
            requestImpl: options.requestImpl,
            signal: controller.signal,
          });

      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        const nextUrl = new URL(response.headers.get("location"), currentUrl).href;
        options.sourceUrlCollector?.(nextUrl);
        await response.body?.cancel?.();
        const validation = await validatePublicSourceTarget(nextUrl, options);
        redirectChain.push({
          from: redactPublicUrl(currentUrl),
          to: redactPublicUrl(nextUrl),
          statusCode: response.status,
          ok: validation.ok,
        });
        if (!validation.ok) {
          return {
            ok: false,
            blocked: validation.status === "blocked",
            reason: validation.reason,
            statusCode: response.status,
            resolvedUrl: nextUrl,
            contentType: "",
            body: "",
            redirectChain,
          };
        }
        currentUrl = validation.url;
        currentValidation = validation;
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (response.url) options.sourceUrlCollector?.(response.url);
      const body = await readLimitedText(response, maxBytes);
      if (body.tooLarge) {
        return {
          ok: false,
          tooLarge: true,
          statusCode: response.status,
          resolvedUrl: response.url || currentUrl,
          contentType,
          body: "",
          redirectChain,
        };
      }

      return {
        ok: response.ok,
        statusCode: response.status,
        resolvedUrl: response.url || currentUrl,
        contentType,
        body: body.text,
        redirectChain,
        authRequired:
          response.status === 401 ||
          response.status === 403 ||
          ((!contentType || /^\s*(?:text\/html|application\/xhtml\+xml)\b/iu.test(contentType)) && looksAuthRequired(body.text)),
      };
    }

    return {
      ok: false,
      reason: "too-many-redirects",
      statusCode: 0,
      resolvedUrl: currentUrl,
      contentType: "",
      body: "",
      redirectChain,
    };
  } finally {
    clearTimeout(timeout);
  }
};

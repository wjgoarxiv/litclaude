import { redactPublicUrl } from "./guard.mjs";
import { extractMetadata, htmlToText } from "./metadata.mjs";
import { classifyFetchedContent, classifyHttpError, contentTypeEssence, isReadableTextContentType } from "./content-proof.mjs";
import { claimGraphFor, makeAttempt, makeFetchVerdict, redactMetadataUrls, routeTraceFor, stopped } from "./receipts.mjs";
import { authRequiredResult, fetchDirectHttp } from "./routes.mjs";
import { redactSourceSecrets } from "./secret-redaction.mjs";
import { validatePublicSourceTarget } from "./validator.mjs";

const contentSafety = Object.freeze({ untrusted: true, instructionsIgnored: true });

const readPublicSourceReport = async (input, options = {}) => {
  const validation = await validatePublicSourceTarget(input, options);
  const evidence = [{ step: "validate-target", ok: validation.ok, status: validation.status, reason: validation.reason ?? null }];

  if (!validation.ok) {
    if (validation.status === "invalid-input") {
      return stopped("invalid-input", validation.reason, "Provide a valid http(s) public URL.", evidence);
    }
    return stopped(validation.status, validation.reason, `Public source read stopped: ${validation.reason}.`, evidence, {
      resolvedUrl: validation.url ?? "",
    });
  }

  try {
    const fetched = await fetchDirectHttp(validation.url, { ...options, validatedTarget: validation });
    evidence.push({ step: "direct-http", ok: fetched.ok && !fetched.authRequired, statusCode: fetched.statusCode, redirects: fetched.redirectChain ?? [] });

    if (fetched.blocked) {
      const fetchVerdict = makeFetchVerdict({
        status: "blocked",
        reason: fetched.reason,
        route: "direct-http",
        httpStatus: fetched.statusCode,
        contentValidation: "not-read",
      });
      const fetchAttempts = [makeAttempt({ route: "direct-http", url: validation.url, resolvedUrl: fetched.resolvedUrl, statusCode: fetched.statusCode, redirects: fetched.redirectChain ?? [], verdict: fetchVerdict })];
      return stopped("blocked", fetched.reason, `Public source read stopped: ${fetched.reason}.`, evidence, {
        route: "direct-http",
        resolvedUrl: fetched.resolvedUrl,
        fetchAttempts,
        fetchVerdict,
        routeTrace: routeTraceFor({ fetchAttempts, terminalStopReason: fetched.reason }),
      });
    }

    if (!fetched.ok && (fetched.statusCode < 200 || fetched.statusCode >= 300)) {
      const contentVerdict = classifyHttpError(fetched);
      const fetchVerdict = makeFetchVerdict({
        status: contentVerdict.status,
        reason: contentVerdict.reason,
        route: "direct-http",
        httpStatus: fetched.statusCode,
        contentValidation: contentVerdict.contentValidation,
      });
      const fetchAttempts = [makeAttempt({ route: "direct-http", url: validation.url, resolvedUrl: fetched.resolvedUrl, statusCode: fetched.statusCode, redirects: fetched.redirectChain ?? [], verdict: fetchVerdict })];
      const receipt = {
        route: "direct-http",
        resolvedUrl: fetched.resolvedUrl,
        contentType: fetched.contentType,
        fetchAttempts,
        fetchVerdict,
        routeTrace: routeTraceFor({ fetchAttempts, terminalStopReason: contentVerdict.reason }),
        claimGraph: claimGraphFor({ resolvedUrl: fetched.resolvedUrl, route: "direct-http", fetchVerdict }),
      };

      if (contentVerdict.status === "auth-required") {
        return authRequiredResult(fetched.resolvedUrl, contentVerdict.reason, evidence, receipt);
      }

      const message = fetched.statusCode
        ? `HTTP ${fetched.statusCode} while reading public source.`
        : `Public source read stopped: ${contentVerdict.reason}.`;
      return stopped(contentVerdict.status, contentVerdict.reason, message, evidence, receipt);
    }

    if (!isReadableTextContentType(fetched.contentType)) {
      const isPdf = contentTypeEssence(fetched.contentType) === "application/pdf";
      const stopReason = isPdf ? "pdf-requires-artifact-validation" : "unsupported-content-type";
      const contentValidation = isPdf ? "binary-pdf" : "unsupported-content-type";
      const fetchVerdict = makeFetchVerdict({
        status: "unsupported-content",
        reason: stopReason,
        route: "direct-http",
        httpStatus: fetched.statusCode,
        contentValidation,
        signals: { contentType: fetched.contentType },
      });
      const fetchAttempts = [makeAttempt({ route: "direct-http", url: validation.url, resolvedUrl: fetched.resolvedUrl, statusCode: fetched.statusCode, redirects: fetched.redirectChain ?? [], verdict: fetchVerdict })];
      return stopped("unsupported-content", stopReason, "Public source response is not readable text; handle binary artifacts through a format-specific validation lane.", evidence, {
        route: "direct-http",
        resolvedUrl: fetched.resolvedUrl,
        contentType: fetched.contentType,
        fetchAttempts,
        fetchVerdict,
        routeTrace: routeTraceFor({ fetchAttempts, terminalStopReason: stopReason }),
      });
    }

    if (fetched.tooLarge) {
      const fetchVerdict = makeFetchVerdict({
        status: "fetch-error",
        reason: "content-too-large",
        route: "direct-http",
        httpStatus: fetched.statusCode,
        contentValidation: "too-large",
      });
      const fetchAttempts = [makeAttempt({ route: "direct-http", url: validation.url, resolvedUrl: fetched.resolvedUrl, statusCode: fetched.statusCode, redirects: fetched.redirectChain ?? [], verdict: fetchVerdict })];
      return stopped("fetch-error", "content-too-large", "Public source response exceeded the configured byte limit.", evidence, {
        route: "direct-http",
        resolvedUrl: fetched.resolvedUrl,
        fetchAttempts,
        fetchVerdict,
        routeTrace: routeTraceFor({ fetchAttempts, terminalStopReason: "content-too-large" }),
      });
    }

    const metadata = redactMetadataUrls(extractMetadata(fetched.body, redactPublicUrl(fetched.resolvedUrl)));
    const contentText = htmlToText(fetched.body);
    const contentVerdict = classifyFetchedContent({ fetched, metadata, contentText });
    const fetchVerdict = makeFetchVerdict({
      ok: contentVerdict.ok,
      status: contentVerdict.status,
      reason: contentVerdict.reason,
      route: "direct-http",
      httpStatus: fetched.statusCode,
      contentValidation: contentVerdict.contentValidation,
      signals: {
        contentType: fetched.contentType,
        textLength: contentText.length,
        metadataTitle: Boolean(metadata.title),
      },
    });
    const fetchAttempts = [makeAttempt({ route: "direct-http", url: validation.url, resolvedUrl: fetched.resolvedUrl, statusCode: fetched.statusCode, redirects: fetched.redirectChain ?? [], verdict: fetchVerdict })];

    if (fetched.authRequired) {
      return authRequiredResult(fetched.resolvedUrl, contentVerdict.reason, evidence, {
        metadata,
        fetchAttempts,
        fetchVerdict,
        routeTrace: routeTraceFor({ fetchAttempts, terminalStopReason: contentVerdict.reason }),
        claimGraph: claimGraphFor({ resolvedUrl: fetched.resolvedUrl, route: "direct-http", metadata, fetchVerdict }),
      });
    }

    if (contentVerdict.status === "blocked") {
      return stopped("blocked", contentVerdict.reason, `Public source read stopped: ${contentVerdict.reason}.`, evidence, {
        route: "direct-http",
        resolvedUrl: fetched.resolvedUrl,
        metadata,
        fetchAttempts,
        fetchVerdict,
        routeTrace: routeTraceFor({ fetchAttempts, terminalStopReason: contentVerdict.reason }),
      });
    }

    if (!contentVerdict.ok) {
      return stopped(contentVerdict.status, contentVerdict.reason, `Public source read stopped: ${contentVerdict.reason}.`, evidence, {
        route: "direct-http",
        resolvedUrl: fetched.resolvedUrl,
        metadata,
        fetchAttempts,
        fetchVerdict,
        routeTrace: routeTraceFor({ fetchAttempts, terminalStopReason: contentVerdict.reason }),
      });
    }

    return {
      ok: true,
      status: "ok",
      route: "direct-http",
      resolvedUrl: redactPublicUrl(fetched.resolvedUrl),
      contentType: fetched.contentType,
      metadata,
      contentText,
      evidence,
      fetchAttempts,
      fetchVerdict,
      routeTrace: routeTraceFor({ fetchAttempts, winningRoute: "direct-http", terminalStopReason: null }),
      claimGraph: claimGraphFor({ resolvedUrl: fetched.resolvedUrl, route: "direct-http", metadata, fetchVerdict }),
    };
  } catch (error) {
    const stopReason = error.name === "AbortError" ? "timeout" : "network-error";
    evidence.push({ step: "direct-http", ok: false, reason: stopReason });
    const fetchVerdict = makeFetchVerdict({ status: "fetch-error", reason: stopReason, route: "direct-http" });
    const fetchAttempts = [makeAttempt({ route: "direct-http", url: validation.url, resolvedUrl: validation.url, verdict: fetchVerdict })];
    return stopped("fetch-error", stopReason, `Public source read failed: ${stopReason}.`, evidence, {
      route: "direct-http",
      resolvedUrl: validation.url,
      fetchAttempts,
      fetchVerdict,
      routeTrace: routeTraceFor({ fetchAttempts, terminalStopReason: stopReason }),
    });
  }
};

export const readPublicSource = async (input, options = {}) => {
  const sourceUrls = [input];
  const report = await readPublicSourceReport(input, {
    ...options,
    sourceUrlCollector: (url) => sourceUrls.push(url),
  });
  return redactSourceSecrets({ ...report, contentSafety }, sourceUrls);
};

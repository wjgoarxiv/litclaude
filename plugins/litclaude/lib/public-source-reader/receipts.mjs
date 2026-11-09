import { redactPublicUrl, redactUrlLikeValue } from "./guard.mjs";

export const emptyMetadata = { title: "", description: "", canonicalUrl: "", openGraph: {}, jsonLd: [] };

const defaultUntriedRoutes = ["public-api-or-feed", "alternate-public-url"];

const metadataUrlKeys = new Set(["@id", "audio", "image", "logo", "sameas", "target", "video"]);
const isMetadataUrlKey = (key) => metadataUrlKeys.has(key.toLowerCase()) || key.toLowerCase().endsWith("url");

const redactStructuredUrls = (value, key = "") => {
  if (Array.isArray(value)) return value.map((entry) => redactStructuredUrls(entry, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [entryKey, redactStructuredUrls(entry, entryKey)]));
  }
  return redactUrlLikeValue(value, isMetadataUrlKey(key));
};

export const redactMetadataUrls = (metadata) => ({
  ...metadata,
  sourceUrl: redactPublicUrl(metadata.sourceUrl ?? ""),
  canonicalUrl: redactPublicUrl(metadata.canonicalUrl ?? ""),
  openGraph: Object.fromEntries(Object.entries(metadata.openGraph ?? {}).map(([key, value]) => [key, redactStructuredUrls(value, key)])),
  jsonLd: redactStructuredUrls(metadata.jsonLd ?? []),
});

const redactRedirects = (redirects = []) =>
  redirects.map((entry) => ({
    ...entry,
    from: redactPublicUrl(entry.from ?? ""),
    to: redactPublicUrl(entry.to ?? ""),
  }));

export const makeFetchVerdict = ({
  ok = false,
  status,
  reason = null,
  route = null,
  httpStatus = null,
  contentValidation = "not-read",
  signals = {},
}) => ({
  ok,
  status,
  reason,
  route,
  httpStatus,
  contentValidation,
  http200IsNotSuccess: true,
  signals,
});

export const makeAttempt = ({ route, url = "", resolvedUrl = "", statusCode = null, redirects = [], verdict }) => ({
  route,
  surface: "public-http",
  tried: true,
  url: redactPublicUrl(url),
  resolvedUrl: redactPublicUrl(resolvedUrl),
  statusCode,
  redirects: redactRedirects(redirects),
  verdict,
});

export const routeTraceFor = ({
  fetchAttempts = [],
  winningRoute = null,
  terminalStopReason = null,
  untriedRoutes = defaultUntriedRoutes,
}) => ({
  attemptedRoutes: fetchAttempts.map((entry) => entry.route),
  attempts: fetchAttempts,
  winningRoute,
  untriedRoutes,
  routeCoverageComplete: untriedRoutes.length === 0,
  terminalStopReason,
});

export const claimGraphFor = ({ resolvedUrl = "", route = null, metadata = emptyMetadata, fetchVerdict = null } = {}) => ({
  schema: "litclaude.claim-source-graph.v1",
  claims: [],
  sources: resolvedUrl
    ? [
        {
          id: "source:1",
          url: redactPublicUrl(resolvedUrl),
          route,
          title: metadata.title ?? "",
          verdict: fetchVerdict?.status ?? "unknown",
        },
      ]
    : [],
  edges: [],
  uncertainties: ["The reader does not extract claims automatically; downstream litresearch must attach each claim to a source with confidence and uncertainty."],
});

export const stopped = (status, stopReason, message, evidence = [], extra = {}) => {
  const route = extra.route ?? null;
  const resolvedUrl = redactPublicUrl(extra.resolvedUrl ?? "");
  const metadata = redactMetadataUrls(extra.metadata ?? emptyMetadata);
  const fetchAttempts = extra.fetchAttempts ?? [];
  const fetchVerdict = extra.fetchVerdict ?? makeFetchVerdict({ status, reason: stopReason, route });
  const routeTrace =
    extra.routeTrace ??
    routeTraceFor({
      fetchAttempts,
      winningRoute: null,
      terminalStopReason: stopReason,
    });
  const claimGraph = extra.claimGraph ?? claimGraphFor({ resolvedUrl, route, metadata, fetchVerdict });

  return {
    ok: false,
    status,
    stopReason,
    message,
    route,
    ...extra,
    resolvedUrl,
    metadata,
    contentText: "",
    evidence,
    fetchAttempts,
    fetchVerdict,
    routeTrace,
    claimGraph,
  };
};

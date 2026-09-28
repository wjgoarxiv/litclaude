const replacement = "[REDACTED]";

const decode = (value) => {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return value;
  }
};

const variantsFor = (value) => {
  const variants = new Set();
  const add = (candidate) => {
    variants.add(candidate);
    variants.add(candidate.replace(/%[\da-f]{2}/giu, (escape) => escape.toLowerCase()));
    variants.add(candidate.replace(/%[\da-f]{2}/giu, (escape) => escape.toUpperCase()));
  };
  let current = value;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    add(current);
    add(encodeURIComponent(current));
    const decoded = decode(current);
    if (decoded === current) break;
    current = decoded;
  }
  return variants;
};

const secretsFromUrl = (value) => {
  if (typeof value !== "string" || !value.includes("://")) return [];
  const fragmentIndex = value.indexOf("#");
  const queryIndex = value.indexOf("?");
  const queryEnd = fragmentIndex >= 0 ? fragmentIndex : value.length;
  const rawValues = [];
  if (queryIndex >= 0 && queryIndex < queryEnd) {
    for (const entry of value.slice(queryIndex + 1, queryEnd).split("&")) {
      const separator = entry.indexOf("=");
      rawValues.push(separator >= 0 ? entry.slice(separator + 1) : "");
    }
  }
  if (fragmentIndex >= 0) rawValues.push(value.slice(fragmentIndex + 1));
  return rawValues.flatMap((entry) => [...variantsFor(entry)]).filter(Boolean);
};

const redactString = (value, secrets) => {
  if (/^(?:https?:\/\/|\/|\.\.?\/|\?)/iu.test(value) && /(?:\[REDACTED\]|%5BREDACTED%5D)/iu.test(value)) return value;
  let result = value;
  for (const secret of secrets) result = result.replaceAll(secret, replacement);
  return result;
};

const redactPageValue = (value, secrets) => {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((entry) => redactPageValue(entry, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [redactString(key, secrets), redactPageValue(entry, secrets)]),
    );
  }
  return value;
};

export const redactSourceSecrets = (value, sourceUrls = []) => {
  const secrets = [...new Set(sourceUrls.flatMap(secretsFromUrl))].sort((left, right) => right.length - left.length);
  if (secrets.length === 0 || !value || typeof value !== "object") return value;
  const metadata = Object.fromEntries(
    Object.entries(value.metadata ?? {}).map(([key, entry]) => [key, redactPageValue(entry, secrets)]),
  );
  const claimGraph = value.claimGraph
    ? {
        ...value.claimGraph,
        sources: (value.claimGraph.sources ?? []).map((source) => ({
          ...source,
          title: redactString(source.title ?? "", secrets),
        })),
      }
    : value.claimGraph;
  return {
    ...value,
    contentText: redactString(value.contentText ?? "", secrets),
    metadata,
    claimGraph,
  };
};

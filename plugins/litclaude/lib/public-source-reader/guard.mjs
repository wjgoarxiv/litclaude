const privateHostnames = new Set(["localhost", "localhost.localdomain"]);

export const REDACTED_QUERY_VALUE = "[REDACTED]";

const isIpv4 = (value) => /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value);

const ipv4Parts = (value) => value.split(".").map((part) => Number(part));

const isPrivateIpv4 = (value) => {
  if (!isIpv4(value)) return false;
  const parts = ipv4Parts(value);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
};

const isPrivateIpv6 = (value) => {
  const address = value.toLowerCase();
  const firstWord = Number.parseInt(address.split(":", 1)[0] || "0", 16);
  return (
    address === "::" ||
    address === "::1" ||
    address === "0:0:0:0:0:0:0:1" ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    (firstWord & 0xffc0) === 0xfe80 ||
    (firstWord & 0xffc0) === 0xfec0 ||
    (firstWord & 0xff00) === 0xff00
  );
};

const mappedIpv4 = (value) => {
  const dotted = /^(?:::ffff:|0:0:0:0:0:ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(value);
  if (dotted) return dotted[1];
  const hexadecimal = /^(?:::ffff:|0:0:0:0:0:ffff:)([\da-f]{1,4}):([\da-f]{1,4})$/iu.exec(value);
  if (!hexadecimal) return null;
  const high = Number.parseInt(hexadecimal[1], 16);
  const low = Number.parseInt(hexadecimal[2], 16);
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
};

export const isPrivateAddress = (value) => {
  if (!value) return true;
  const normalized = value.replace(/^\[|\]$/gu, "").toLowerCase();
  const mapped = mappedIpv4(normalized);
  if (mapped) return isPrivateIpv4(mapped);
  return privateHostnames.has(normalized) || isPrivateIpv4(normalized) || isPrivateIpv6(normalized);
};

export const isAllowedProtocol = (protocol) => protocol === "http:" || protocol === "https:";

const redactParsedUrl = (url) => {
  const queryEntries = [...url.searchParams];
  url.username = "";
  url.password = "";
  url.hash = "";
  url.search = "";
  for (const [key] of queryEntries) url.searchParams.append(key, REDACTED_QUERY_VALUE);
  return url;
};

const redactMalformedUrl = (value) => {
  const withoutFragment = value.split("#", 1)[0];
  const withoutUserinfo = withoutFragment.replace(
    /^((?:[a-z][a-z\d+.-]*:)?\/\/)([^/?#]*)/iu,
    (_match, prefix, authority) => `${prefix}${authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority}`,
  );
  const queryIndex = withoutUserinfo.indexOf("?");
  if (queryIndex < 0) return withoutUserinfo;

  const path = withoutUserinfo.slice(0, queryIndex);
  const query = withoutUserinfo.slice(queryIndex + 1);
  const replacement = encodeURIComponent(REDACTED_QUERY_VALUE);
  const redactedQuery = query
    .split("&")
    .map((entry) => {
      if (!entry) return "";
      const separator = entry.indexOf("=");
      const key = separator < 0 ? entry : entry.slice(0, separator);
      return `${key}=${replacement}`;
    })
    .join("&");
  return `${path}?${redactedQuery}`;
};

export const redactPublicUrl = (value) => {
  const source = typeof value === "string" ? value : "";
  if (!source) return "";

  try {
    return redactParsedUrl(new URL(source)).href;
  } catch {
    try {
      const base = "https://litclaude.invalid";
      const redacted = redactParsedUrl(new URL(source, `${base}/`));
      return redacted.href.startsWith(base) ? redacted.href.slice(base.length) : redacted.href;
    } catch {
      return redactMalformedUrl(source);
    }
  }
};

const urlLikePrefix = /^(?:https?:\/\/|\/\/|\/|\.\.?\/|\?)/iu;
const relativePathWithQuery = /^[^\s?#]+\?[^#\s]*=/u;

export const redactUrlLikeValue = (value, assumeUrl = false) => {
  if (typeof value !== "string") return value;
  return assumeUrl || urlLikePrefix.test(value) || relativePathWithQuery.test(value) ? redactPublicUrl(value) : value;
};

import { lookup } from "node:dns/promises";
import { isAllowedProtocol, isPrivateAddress } from "./guard.mjs";

const blocked = (url, reason, evidence = []) => ({ ok: false, status: "blocked", reason, url, evidence });

const lookupWithTimeout = async (lookupImpl, hostname, options) => {
  const requestedTimeout = options.dnsTimeoutMs ?? options.timeoutMs ?? 10_000;
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : 10_000;
  let timer;
  try {
    return await Promise.race([
      lookupImpl(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("DNS lookup timed out");
          error.code = "LITCLAUDE_DNS_LOOKUP_TIMEOUT";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export const normalizePublicSourceInput = (input) => {
  const rawInput = typeof input === "string" ? input.trim() : "";
  if (!rawInput) {
    return { ok: false, status: "invalid-input", reason: "empty-input", input: rawInput };
  }

  try {
    const url = new URL(rawInput);
    if (!isAllowedProtocol(url.protocol)) {
      return { ok: false, status: "invalid-input", reason: "unsupported-protocol", input: rawInput };
    }
    if (url.username || url.password) {
      return { ok: false, status: "invalid-input", reason: "credentials-in-url" };
    }
    url.hash = "";
    return { ok: true, inputType: "url", input: rawInput, url: url.href, hostname: url.hostname };
  } catch {
    if (!/^[a-z][a-z0-9+.-]*:\/\//iu.test(rawInput)) {
      const searchUrl = new URL("https://duckduckgo.com/html/");
      searchUrl.searchParams.set("q", rawInput);
      return { ok: true, inputType: "query", input: rawInput, url: searchUrl.href, hostname: searchUrl.hostname };
    }
    return { ok: false, status: "invalid-input", reason: "invalid-url", input: rawInput };
  }
};

export const validatePublicSourceTarget = async (input, options = {}) => {
  const normalized = normalizePublicSourceInput(input);
  const evidence = [{ step: "parse-input", ok: normalized.ok, reason: normalized.reason ?? null }];
  if (!normalized.ok) return { ...normalized, evidence };

  if (options.skipDnsLookup) {
    return { ok: true, status: "ok", ...normalized, addresses: [], evidence };
  }

  if (!options.allowPrivateHosts && isPrivateAddress(normalized.hostname)) {
    return blocked(normalized.url, "private-address", evidence);
  }

  let addresses = [];
  try {
    const lookupImpl = options.lookupImpl ?? lookup;
    addresses = await lookupWithTimeout(lookupImpl, normalized.hostname, options);
  } catch (error) {
    const reason = error.code === "LITCLAUDE_DNS_LOOKUP_TIMEOUT" ? "dns-lookup-timeout" : "dns-lookup-failed";
    return { ok: false, status: "network-error", reason, url: normalized.url, message: error.message, evidence };
  }

  if (!Array.isArray(addresses) || addresses.length === 0) {
    return { ok: false, status: "network-error", reason: "dns-no-address", url: normalized.url, evidence };
  }

  if (!options.allowPrivateHosts && addresses.some((entry) => isPrivateAddress(entry.address))) {
    return blocked(normalized.url, "private-address", evidence);
  }

  return { ok: true, status: "ok", ...normalized, addresses, evidence };
};

import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

const responseHeaders = (headers = {}) => {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (entry !== undefined) result.append(name, String(entry));
    }
  }
  return result;
};

const pinnedLookup = ({ address, family }) => (_hostname, options, callback) => {
  if (options?.all) {
    callback(null, [{ address, family }]);
    return;
  }
  callback(null, address, family);
};

export const requestPinnedHttp = (url, addresses, options = {}) => {
  const target = addresses?.[0];
  if (!target?.address || ![4, 6].includes(target.family)) {
    const error = new Error("validated DNS address unavailable for pinned connection");
    error.code = "LITCLAUDE_DNS_PIN_UNAVAILABLE";
    throw error;
  }

  const parsed = new URL(url);
  const requestImpl = options.requestImpl ?? (parsed.protocol === "https:" ? requestHttps : requestHttp);
  const requestOptions = {
    family: target.family,
    headers: options.headers,
    lookup: pinnedLookup(target),
    rejectUnauthorized: true,
    signal: options.signal,
  };
  if (parsed.protocol === "https:" && isIP(parsed.hostname) === 0) requestOptions.servername = parsed.hostname;

  return new Promise((resolve, reject) => {
    const request = requestImpl(parsed, requestOptions, (response) => {
      resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode ?? 0,
        url: parsed.href,
        headers: responseHeaders(response.headers),
        body: Readable.toWeb(response),
      });
    });
    request.on("error", reject);
    request.end();
  });
};

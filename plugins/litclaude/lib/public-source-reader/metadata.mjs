const entityMap = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export const decodeHtml = (value = "") =>
  value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, entity) => {
    const key = entity.toLowerCase();
    if (key.startsWith("#x")) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    return entityMap[key] ?? match;
  });

const attributesFor = (tag) => {
  const attrs = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gu)) {
    attrs[match[1].toLowerCase()] = decodeHtml(match[3] ?? match[4] ?? match[5] ?? "").trim();
  }
  return attrs;
};

const firstMatch = (html, regex) => {
  const match = regex.exec(html);
  return match ? decodeHtml(match[1].replace(/<[^>]*>/gu, "").trim()) : "";
};

export const extractMetadata = (html, sourceUrl) => {
  const metadata = {
    title: firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/iu),
    description: "",
    canonicalUrl: "",
    openGraph: {},
    jsonLd: [],
    sourceUrl,
  };

  for (const match of html.matchAll(/<meta\b[^>]*>/giu)) {
    const attrs = attributesFor(match[0]);
    const key = (attrs.name || attrs.property || "").toLowerCase();
    if (key === "description") metadata.description = attrs.content || metadata.description;
    if (key.startsWith("og:") && attrs.content) metadata.openGraph[key.slice(3)] = attrs.content;
  }

  for (const match of html.matchAll(/<link\b[^>]*>/giu)) {
    const attrs = attributesFor(match[0]);
    if ((attrs.rel || "").toLowerCase().split(/\s+/u).includes("canonical") && attrs.href) {
      metadata.canonicalUrl = attrs.href;
    }
  }

  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1].trim()));
      if (Array.isArray(parsed)) metadata.jsonLd.push(...parsed);
      else metadata.jsonLd.push(parsed);
    } catch {
      // Ignore malformed publisher metadata; the page text may still be readable.
    }
  }

  if (!metadata.description && metadata.openGraph.description) metadata.description = metadata.openGraph.description;
  if (!metadata.title && metadata.openGraph.title) metadata.title = metadata.openGraph.title;

  return metadata;
};

export const htmlToText = (html) => {
  const withoutNonContent = html
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/giu, " ");
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/iu.exec(withoutNonContent)?.[1] ?? withoutNonContent;
  return decodeHtml(main.replace(/<[^>]+>/gu, " ")).replace(/\s+/gu, " ").trim();
};

// The `mark` setting: whether LitClaude's engines tag the files they make. `on` puts an invisible
// generator tag in every output and a small visible mark on showcase outputs (films, README covers,
// diagrams, schematics); `meta` keeps only the invisible tag; `off` leaves outputs unmarked.
// The value lives in LitClaude's own `<litHome>/config.json`, never in Claude Code's settings;
// LITCLAUDE_MARK overrides it for one run. Anything unreadable reads as `on`. No network, no clock.
// output_mark.py is the Python engines' copy of the same rules.

import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

import { STATE_WRITE_FLAG } from "./project-state-root.mjs";

export const MARK_MODES = Object.freeze(["on", "meta", "off"]);
const MAX_CONFIG_BYTES = 64 * 1024;
const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json");

export const markLitHome = (env = process.env) => resolve(env.LITCLAUDE_HOME || join(homedir(), ".litclaude"));
export const markConfigPath = (litHome = markLitHome()) => join(litHome, "config.json");

const readConfig = (path) => {
  let fd;
  try {
    if (!lstatSync(path).isFile()) return null;
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const { size } = fstatSync(fd);
    if (size > MAX_CONFIG_BYTES) return null;
    const buffer = Buffer.alloc(size);
    readSync(fd, buffer, 0, size, 0);
    const parsed = JSON.parse(buffer.toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

/** The mode for this run: LITCLAUDE_MARK when valid, else the stored value, else `on`. */
export const readMarkMode = ({ env = process.env, litHome = markLitHome(env) } = {}) => {
  const override = String(env.LITCLAUDE_MARK ?? "").trim().toLowerCase();
  if (MARK_MODES.includes(override)) return override;
  const stored = readConfig(markConfigPath(litHome))?.mark;
  return MARK_MODES.includes(stored) ? stored : "on";
};

/** One key of `<litHome>/config.json`, or undefined when the file or key is unreadable. */
export const readLitConfigKey = (litHome, key) => readConfig(markConfigPath(litHome))?.[key];

/** Stores one key, keeping the file's other keys; a symlinked config or home is refused, not followed. */
export const writeLitConfigKey = (litHome, key, value) => {
  const path = markConfigPath(litHome);
  for (const p of [litHome, path]) {
    try {
      if (lstatSync(p).isSymbolicLink()) throw new Error(`refusing to write the ${key} setting through a symlink: ${p}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  let current = {};
  try {
    lstatSync(path);
    current = readConfig(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // A config.json that exists but does not read as an object holds the user's other settings.
  if (current === null) throw new Error(`refusing to overwrite ${path}: it is not readable JSON; fix or remove it first`);
  mkdirSync(litHome, { recursive: true, mode: 0o700 });
  const next = { ...current, [key]: value };
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(next, null, 2)}\n`, { flag: STATE_WRITE_FLAG, mode: 0o600 });
  renameSync(staging, path);
  return value;
};

/** Stores the mode, keeping the file's other keys; a symlinked config or home is refused, not followed. */
export const writeMarkMode = (litHome, mode) => {
  if (!MARK_MODES.includes(mode)) throw new Error(`mark takes one of: ${MARK_MODES.join(", ")}`);
  return writeLitConfigKey(litHome, "mark", mode);
};

/** `LitClaude <version> · github.com/wjgoarxiv/litclaude`, the version taken from the plugin manifest. */
export const generatorString = () => {
  const { version } = JSON.parse(readFileSync(manifestPath, "utf8"));
  return `LitClaude ${version} · github.com/wjgoarxiv/litclaude`;
};

const CUSTOM_PART = "docProps/custom.xml";
const CUSTOM_TYPE = "application/vnd.openxmlformats-officedocument.custom-properties+xml";
const CUSTOM_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties";
const FMTID = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}";
const xmlText = (value) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");

/**
 * The changed package parts that name `generator`: app.xml <Application> and a custom `Generator` property,
 * with the content type and package relationship custom.xml needs. Same rules as output_mark.tag_ooxml_parts.
 */
export const tagOoxmlParts = (parts, generator) => {
  const text = xmlText(generator);
  const out = {};
  const app = parts["docProps/app.xml"];
  if (app !== undefined) {
    const tag = `<Application>${text}</Application>`;
    out["docProps/app.xml"] = /<Application[>/]/u.test(app)
      ? app.replace(/<Application>[^<]*<\/Application>|<Application\/>/u, tag)
      : app.replace("</Properties>", `${tag}</Properties>`);
  }
  const prop = `<vt:lpwstr>${text}</vt:lpwstr></property>`;
  const custom = parts[CUSTOM_PART];
  if (custom === undefined) {
    out[CUSTOM_PART] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" '
      + 'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
      + `<property fmtid="${FMTID}" pid="2" name="Generator">${prop}</Properties>`;
  } else {
    const existing = custom.match(/(<property [^>]*name="Generator"[^>]*>)[\s\S]*?<\/property>/u);
    if (existing) out[CUSTOM_PART] = custom.replace(existing[0], existing[1] + prop);
    else {
      const pid = Math.max(1, ...[...custom.matchAll(/\bpid="(\d+)"/gu)].map((m) => Number(m[1]))) + 1;
      out[CUSTOM_PART] = custom.replace("</Properties>", `<property fmtid="${FMTID}" pid="${pid}" name="Generator">${prop}</Properties>`);
    }
  }
  const types = parts["[Content_Types].xml"];
  if (!types.includes(`PartName="/${CUSTOM_PART}"`)) {
    out["[Content_Types].xml"] = types.replace("</Types>", `<Override PartName="/${CUSTOM_PART}" ContentType="${CUSTOM_TYPE}"/></Types>`);
  }
  const rels = parts["_rels/.rels"];
  if (!rels.includes(`Target="${CUSTOM_PART}"`) && !rels.includes(`Target="/${CUSTOM_PART}"`)) {
    const rid = `rId${Math.max(0, ...[...rels.matchAll(/Id="rId(\d+)"/gu)].map((m) => Number(m[1]))) + 1}`;
    out["_rels/.rels"] = rels.replace("</Relationships>", `<Relationship Id="${rid}" Type="${CUSTOM_REL}" Target="${CUSTOM_PART}"/></Relationships>`);
  }
  return out;
};

/** Tags an OOXML package held in a JSZip instance when this run's mode is `on` or `meta`. */
export const tagOoxmlZip = async (zip, options) => {
  const { generator } = markPlan(options);
  if (!generator) return;
  const parts = {};
  for (const name of ["docProps/app.xml", CUSTOM_PART, "[Content_Types].xml", "_rels/.rels"]) {
    if (zip.file(name)) parts[name] = await zip.file(name).async("string");
  }
  for (const [name, xml] of Object.entries(tagOoxmlParts(parts, generator))) zip.file(name, xml);
};

/**
 * The visible mark every showcase engine draws (approved by the user on 2026-10-28 from task-6-mock): the text,
 * Pretendard 500 with 0.02 em tracking, a corner size of 1.6 % of the short side (never under 11 px) at 60 %
 * opacity, a film end card of about 0.5 s after the last beat, and ink taken from the output's own ground,
 * pushed 72 % toward black on a light ground or white on a dark one. The flame logo (lib/mark-logo.png, the plugin
 * icon at 96 px; chosen by the user on 2026-10-30) sits left of the text at 1.3 x the font size, 0.35 em away,
 * in its own colours at the same opacity.
 */
export const WORDMARK = Object.freeze({
  text: "made with LitClaude",
  font: "Pretendard",
  weight: 500,
  tracking: 0.02,
  cornerShare: 0.016,
  minPx: 11,
  insetShare: 0.025,
  cornerOpacity: 0.6,
  endCardSec: 0.5,
  endCardFadeSec: 0.12,
  endCardShare: 0.022,
  inkPush: 0.72,
  logoScale: 1.3,
  logoGap: 0.35,
});

const logoPath = join(dirname(fileURLToPath(import.meta.url)), "mark-logo.png");
/** The flame logo as a `data:image/png` URI, so an SVG or a page carries it without a sibling file. */
export const markLogoDataUri = () => `data:image/png;base64,${readFileSync(logoPath).toString("base64")}`;

/**
 * The logo's box for a mark whose text ends at `x` on baseline `y` with `fontSize` and `textWidth`:
 * left of the text, centred on its x-height band.
 */
export const markLogoBox = ({ x, y, fontSize, textWidth }) => {
  const size = WORDMARK.logoScale * fontSize;
  return { x: x - textWidth - WORDMARK.logoGap * fontSize - size, y: y - 0.36 * fontSize - size / 2, size };
};

/** An SVG <image> element for the logo box, at the mark's opacity. */
export const markLogoSvg = ({ x, y, size }) =>
  `<image data-litclaude-mark-logo="1" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" opacity="${WORDMARK.cornerOpacity}" href="${markLogoDataUri()}"/>`;

/** The mark's ink for a ground colour [r, g, b] (0-255): the ground pushed toward black or white. */
export const markInk = ([r, g, b]) => {
  const target = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5 ? 0 : 255;
  return [r, g, b].map((v) => Math.round(v + (target - v) * WORDMARK.inkPush));
};

/**
 * Where a corner mark of `boxW` x `boxH` pixels fits on a raster without touching anything drawn: the clear box
 * (no pixel within `pad` that departs from the box's median luminance by more than 0.08) nearest the anchor
 * (`bottom-right` or `bottom-centre`), searched over the bottom quarter and kept out of every `exclude` box.
 * Returns { x, y (top-left of the text box), ground [r, g, b], ink } or null when no clear spot exists.
 * `image` is { width, height, channels (3 or 4), pixels }.
 */
// How far (in luminance, 0-1) a pixel may stray from the box's median and still count as ground: a quiet
// pattern such as soft stripes or a gradient stays under it; type and drawn art (0.3 and more) do not.
const GROUND_TOLERANCE = 0.2;
export const findClearSpot = (image, { boxW, boxH, inset, pad = 0, anchor = "bottom-right", exclude = [] }) => {
  const { width, height, channels, pixels } = image;
  const stats = (x0, y0, x1, y1) => {
    const lums = [];
    let r = 0, g = 0, b = 0;
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, y1); y += 2) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, x1); x += 2) {
        const o = (y * width + x) * channels;
        r += pixels[o]; g += pixels[o + 1]; b += pixels[o + 2];
        lums.push((0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2]) / 255);
      }
    }
    const median = [...lums].sort((p, q) => p - q)[lums.length >> 1];
    return { ink: lums.filter((l) => Math.abs(l - median) > GROUND_TOLERANCE).length / lums.length, ground: [r, g, b].map((v) => Math.round(v / lums.length)) };
  };
  const ax = anchor === "bottom-right" ? width - inset - boxW / 2 : width / 2;
  const ay = height - inset - boxH / 2;
  let best = null;
  const step = Math.max(2, Math.round(boxH / 4));
  for (let y = height - inset - boxH; y >= height * 0.72; y -= step) {
    for (let x = inset; x <= width - inset - boxW; x += step) {
      const box = [x - pad, y - pad, x + boxW + pad, y + boxH + pad];
      if (exclude.some((e) => e[0] < box[2] && e[2] > box[0] && e[1] < box[3] && e[3] > box[1])) continue;
      const d = Math.hypot(x + boxW / 2 - ax, (y + boxH / 2 - ay) * 2);
      if (best && d >= best.d) continue;
      const s = stats(...box);
      if (s.ink < 0.004) best = { x, y, d, ground: s.ground };
    }
  }
  return best ? { x: best.x, y: best.y, ground: best.ground, ink: markInk(best.ground) } : null;
};

/** What an engine should do for this run: `meta` (invisible tag) and `visible` (showcase mark). */
export const markPlan = (options) => {
  const mode = readMarkMode(options);
  return { mode, meta: mode !== "off", visible: mode === "on", generator: mode === "off" ? null : generatorString() };
};

// ── Media outputs ───────────────────────────────────────────────────────────
// Every tag is a fixed string: no time, no random value, so deterministic renders stay deterministic.

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pngChunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
};

/** A PNG with one `tEXt` `Software` chunk naming `generator`, just before IEND (an earlier one is replaced). */
export const tagPngBuffer = (buf, generator) => {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("not a PNG file");
  const kept = [];
  let end = null;
  for (let o = 8; o + 12 <= buf.length;) {
    const len = buf.readUInt32BE(o);
    if (o + 12 + len > buf.length) throw new Error("not a PNG file (a chunk runs past the end)");
    const type = buf.toString("latin1", o + 4, o + 8);
    const whole = buf.subarray(o, o + 12 + len);
    if (type === "IEND") { end = whole; break; }
    const software = type === "tEXt" && buf.toString("latin1", o + 8, o + 17) === "Software\0";
    if (!software) kept.push(whole);
    o += 12 + len;
  }
  if (!end) throw new Error("not a PNG file (no IEND)");
  return Buffer.concat([PNG_SIGNATURE, ...kept, pngChunk("tEXt", Buffer.from(`Software\0${generator}`, "latin1")), end]);
};

/** A GIF with one comment extension naming `generator`, right after the header and global colour table. */
export const tagGifBuffer = (buf, generator) => {
  if (buf.length < 13 || !/^GIF8[79]a$/u.test(buf.toString("latin1", 0, 6))) throw new Error("not a GIF file");
  const flags = buf[10];
  const head = 13 + (flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0);
  const text = Buffer.from(generator, "utf8");
  const blocks = [];
  for (let o = 0; o < text.length; o += 255) {
    const part = text.subarray(o, o + 255);
    blocks.push(Buffer.from([part.length]), part);
  }
  const comment = Buffer.concat([Buffer.from([0x21, 0xfe]), ...blocks, Buffer.from([0])]);
  const rest = buf.subarray(head);
  if (rest.subarray(0, comment.length).equals(comment)) return buf;
  return Buffer.concat([buf.subarray(0, head), comment, rest]);
};

const xmpPacket = (generator) => Buffer.from(
  `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">`
  + `<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreatorTool>${xmlText(generator)}</xmp:CreatorTool></rdf:Description>`
  + "</rdf:RDF></x:xmpmeta><?xpacket end=\"r\"?>", "utf8");

/**
 * An extended (VP8X) WebP — every animated WebP the engines write — with an `XMP ` chunk naming `generator`
 * and the XMP flag set; an earlier XMP chunk is replaced. A simple-format still has no room for metadata
 * without re-encoding its header, so it is returned unchanged.
 */
export const tagWebpBuffer = (buf, generator) => {
  if (buf.length < 20 || buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP") throw new Error("not a WebP file");
  if (buf.toString("latin1", 12, 16) !== "VP8X") return buf;
  const chunks = [];
  for (let o = 12; o + 8 <= buf.length;) {
    const size = buf.readUInt32LE(o + 4);
    const type = buf.toString("latin1", o, o + 4);
    if (type !== "XMP ") chunks.push(Buffer.from(buf.subarray(o, o + 8 + size + (size & 1))));
    o += 8 + size + (size & 1);
  }
  chunks[0][8] |= 0x04;
  const xmp = xmpPacket(generator);
  const head = Buffer.alloc(8);
  head.write("XMP ", 0, "latin1");
  head.writeUInt32LE(xmp.length, 4);
  chunks.push(head, xmp, xmp.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0));
  const body = Buffer.concat(chunks);
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(4 + body.length, 4);
  riff.write("WEBP", 8, "latin1");
  const out = Buffer.concat([riff, body]);
  return out.equals(buf) ? buf : out;
};

/** An SVG with one `<metadata id="litclaude-generator">` right after its root element (an earlier one is replaced). */
export const svgWithMetadata = (svg, generator) => {
  const tag = `<metadata id="litclaude-generator">${xmlText(generator)}</metadata>`;
  const cleaned = svg.replace(/<metadata id="litclaude-generator">[^<]*<\/metadata>/u, "");
  return cleaned.replace(/<svg\b[^>]*>/u, (root) => root + tag);
};

/** ffmpeg arguments that name the generator in a video container's `comment`; none when the mode is off. */
export const ffmpegMetadataArgs = (options) => {
  const { generator } = markPlan(options);
  return generator ? ["-metadata", `comment=${generator}`] : [];
};

const pdfText = (value) => `<FEFF${Buffer.from(value, "utf16le").swap16().toString("hex").toUpperCase()}>`;

/**
 * A PDF whose Info dictionary names `generator` as Creator and Producer, added as a standard incremental
 * update (new Info object, xref section, trailer with /Prev); the original bytes stay in front unchanged.
 * Only a file whose last cross-reference is a classic `xref` table is updated: one that ends in a
 * cross-reference stream is returned unchanged. A file already carrying this generator is returned as it is.
 */
export const tagPdfBuffer = (buf, generator) => {
  if (buf.toString("latin1", 0, 5) !== "%PDF-") throw new Error("not a PDF file");
  const tail = buf.toString("latin1", Math.max(0, buf.length - 4096));
  const prev = Number(tail.match(/startxref\s+(\d+)\s+%%EOF\s*$/u)?.[1]);
  if (!Number.isInteger(prev) || buf.toString("latin1", prev, prev + 4) !== "xref") return buf;
  const value = pdfText(generator);
  const trailer = buf.toString("latin1", prev).match(/trailer\s*<<([\s\S]*?)>>\s*startxref/u)?.[1];
  if (!trailer) return buf;
  const size = Number(trailer.match(/\/Size\s+(\d+)/u)?.[1]);
  const root = trailer.match(/\/Root\s+(\d+\s+\d+\s+R)/u)?.[1];
  if (!size || !root) return buf;
  const info = trailer.match(/\/Info\s+(\d+)\s+0\s+R/u)?.[1];
  if (info && buf.toString("latin1").includes(`${info} 0 obj\n<</Creator ${value} /Producer ${value}>>`)) return buf;
  const id = trailer.match(/\/ID\s*(\[[^\]]*\])/u)?.[1];
  const sep = buf.at(-1) === 0x0a ? "" : "\n";
  const object = `${sep}${size} 0 obj\n<</Creator ${value} /Producer ${value}>>\nendobj\n`;
  const objectAt = buf.length + Buffer.byteLength(sep);
  const xrefAt = buf.length + Buffer.byteLength(object);
  const update = `${object}xref\n${size} 1\n${String(objectAt).padStart(10, "0")} 00000 n \ntrailer\n<</Size ${size + 1} /Root ${root} /Info ${size} 0 R${id ? ` /ID ${id}` : ""} /Prev ${prev}>>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.concat([buf, Buffer.from(update, "latin1")]);
};

const TAGGERS = { ".png": tagPngBuffer, ".gif": tagGifBuffer, ".webp": tagWebpBuffer, ".pdf": tagPdfBuffer };

// `node lib/mark.mjs` prints this run's plan as JSON, for skills whose outputs are assembled outside an engine
// (readme-studio covers): { mode, visible, generator, text, logo, logoScale, logoGap }, where `logo` is the flame
// PNG's path. It reads only the setting; it writes nothing.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { mode, visible, generator } = markPlan();
  process.stdout.write(`${JSON.stringify({ mode, visible, generator, text: WORDMARK.text, logo: logoPath, logoScale: WORDMARK.logoScale, logoGap: WORDMARK.logoGap })}\n`);
}

/** Tags a file the engine just wrote (png, gif, webp, svg) in place; returns whether the mode asked for it. */
export const tagFile = (file, options) => {
  const { generator } = markPlan(options);
  if (!generator) return false;
  const ext = extname(file).toLowerCase();
  const before = readFileSync(file);
  const after = ext === ".svg" ? Buffer.from(svgWithMetadata(before.toString("utf8"), generator), "utf8") : TAGGERS[ext]?.(before, generator);
  if (!after) return false;
  if (!after.equals(before)) writeFileSync(file, after);
  return true;
};

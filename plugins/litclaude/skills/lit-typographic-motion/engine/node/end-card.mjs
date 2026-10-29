// LitClaude's end card: about half a second after the film's last beat, the film's own ground with "made with
// LitClaude" centred, in the ground's ink (lib/mark.mjs WORDMARK). No music (the track is padded with silence),
// no camera move; a short crossfade from the last frame keeps the cut under the full-frame step limit. Only the
// `on` mark setting draws it. Both render paths append it to the master after the film's own frames: the flash
// audit, the full-frame step rule and the probe see it; the content rules judge the film's frames alone, and
// END-CARD checks the card itself.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WORDMARK, markInk, markPlan } from "../../../../lib/mark.mjs";
import { decodePng } from "./png.mjs";
import { StageBrowser } from "./stage-capture.mjs";
import { stageFonts } from "./stage-serve.mjs";

/** The card's length for this run, or null when the mark setting is not `on`. */
export function endCardPlan({ fps, env = process.env }) {
  if (!markPlan({ env }).visible) return null;
  const frames = Math.max(2, Math.round(WORDMARK.endCardSec * fps));
  const fade = Math.min(frames - 1, Math.max(2, Math.round(WORDMARK.endCardFadeSec * fps)));
  return { frames, fade, sec: frames / fps };
}

const hexRgb = (hex) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(String(hex ?? "").trim());
  return m ? [1, 2, 3].map((i) => parseInt(m[i], 16)) : null;
};

/** The card page: the ground, the wordmark centred, drawn in the stage's own Pretendard. */
export function endCardHtml({ width, height, ground }) {
  const g = hexRgb(ground) ?? [16, 18, 22];
  const ink = markInk(g);
  const size = Math.max(WORDMARK.minPx, Math.round(WORDMARK.endCardShare * Math.min(width, height)));
  return `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="/lit/fonts.css">
<script src="/lit/stage-kit.js"></script>
<style>
  html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: rgb(${g.join(",")}); }
  p { position: absolute; inset: 0; margin: 0; display: flex; align-items: center; justify-content: center; font: ${WORDMARK.weight} ${size}px/1 "Pretendard"; letter-spacing: ${WORDMARK.tracking}em; color: rgb(${ink.join(",")}); opacity: 0.7; }
</style>
<body><p>${WORDMARK.text}</p>
<script>LitStage.define({ width: ${width}, height: ${height}, fps: 30, duration: 1, render() {} });</script>
</body>
`;
}

/** Render the card once in the stage's headless Chrome; returns its RGBA pixels (width x height). */
export async function renderEndCard({ out, width, height, ground, env = process.env, log = () => {} }) {
  const dir = path.join(out, ".run", "end-card");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.html"), endCardHtml({ width, height, ground }));
  const browser = await StageBrowser.open({ stageDir: dir, faces: stageFonts(env), rasters: [], width, height, seed: 1, profileDir: path.join(out, ".run", `ce${process.pid % 100000}`), env, log });
  try {
    await browser.step(0, 30, { paint: true });
    const png = decodePng(await browser.capture());
    if (png.width !== width || png.height !== height) throw new Error(`end card captured at ${png.width}x${png.height}, expected ${width}x${height}`);
    const rgba = Buffer.alloc(width * height * 4);
    let lo = 255;
    let hi = 0;
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += png.channels) {
      rgba[i] = png.pixels[j]; rgba[i + 1] = png.pixels[j + 1]; rgba[i + 2] = png.pixels[j + 2]; rgba[i + 3] = 255;
      const l = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
      if (l < lo) lo = l;
      if (l > hi) hi = l;
    }
    if (hi - lo < 40) throw new Error("the end card came out flat: the wordmark was not drawn (Pretendard missing from the stage fonts?)");
    return rgba;
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Frame k of the card: a crossfade from the film's last frame over `fade` frames, then the card. A fresh buffer. */
export function endCardFrame({ last, card, k, fade }) {
  const a = Math.min(1, (k + 1) / fade);
  const outBuf = Buffer.alloc(card.length);
  for (let i = 0; i < card.length; i += 4) {
    outBuf[i] = Math.round(last[i] + (card[i] - last[i]) * a);
    outBuf[i + 1] = Math.round(last[i + 1] + (card[i + 1] - last[i + 1]) * a);
    outBuf[i + 2] = Math.round(last[i + 2] + (card[i + 2] - last[i + 2]) * a);
    outBuf[i + 3] = 255;
  }
  return outBuf;
}

/**
 * Pad a WAV the film was scored to with `frames` frames of silence at `fps`, so the music still ends with the
 * film and the card is silent. Returns the samples added (0 for no file).
 */
export function padWavSilence(file, { frames, fps }) {
  if (!file) return 0;
  const buf = readFileSync(file);
  const rate = buf.readUInt32LE(24);
  const blockAlign = buf.readUInt16LE(32);
  let o = 12;
  let dataAt = -1;
  let dataSize = 0;
  while (o + 8 <= buf.length) {
    const id = buf.toString("ascii", o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    if (id === "data") { dataAt = o; dataSize = size; }
    o += 8 + size + (size % 2);
  }
  if (dataAt < 0 || dataAt + 8 + dataSize !== buf.length) throw new Error(`cannot pad ${file}: the data chunk is not the last chunk`);
  const samples = Math.round((frames * rate) / fps);
  const padded = Buffer.concat([buf, Buffer.alloc(samples * blockAlign)]);
  padded.writeUInt32LE(dataSize + samples * blockAlign, dataAt + 4);
  padded.writeUInt32LE(padded.length - 8, 4);
  writeFileSync(file, padded);
  return samples;
}

/**
 * END-CARD: the card is the planned length, fades in within its planned frames and stays still after. That the
 * wordmark was drawn is checked when the card is rendered (renderEndCard refuses a flat card); the small centred
 * text sits below the 0.5 % luminance percentiles the frame log records, so the log cannot show it.
 */
export function endCardRule({ lines, plan, fps }) {
  if (!plan) return { id: "END-CARD", status: "N/A", detail: "mark setting is not on; no end card" };
  const problems = [];
  if (lines.length !== plan.frames) problems.push(`${lines.length} card frames, planned ${plan.frames}`);
  const tail = lines.slice(plan.fade);
  if (tail.length && new Set(tail.map((l) => l.rgbaSha256)).size !== 1) problems.push("the card moves after its fade");
  const detail = `${lines.length} frames (${(lines.length / fps).toFixed(2)} s), ${plan.fade}-frame crossfade, "${WORDMARK.text}"`;
  return problems.length ? { id: "END-CARD", status: "FAIL", detail: `${detail}: ${problems.join("; ")}` } : { id: "END-CARD", status: "PASS", detail };
}

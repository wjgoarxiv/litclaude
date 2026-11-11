import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WORDMARK, findClearSpot, markInk, markLogoBox } from "../plugins/litclaude/lib/mark.mjs";

describe("the shared wordmark", () => {
  it("names the approved text and takes its ink from the ground", () => {
    assert.equal(WORDMARK.text, "made with LitClaude");
    assert.deepEqual(markInk([255, 255, 255]), [71, 71, 71]);
    assert.deepEqual(markInk([10, 12, 20]), [186, 187, 189]);
  });

  it("reads the ground under a clear spot even when the inset is fractional", () => {
    const width = 400, height = 200, channels = 4;
    const pixels = new Uint8Array(width * height * channels);
    for (let o = 0; o < pixels.length; o += 4) pixels.set([10, 12, 20, 255], o);
    const spot = findClearSpot({ width, height, channels, pixels }, { boxW: 60.5, boxH: 13.3, inset: 12.5 });
    assert.deepEqual(spot.ground, [10, 12, 20]);
    assert.deepEqual(spot.ink, markInk([10, 12, 20]));
  });

  it("treats quiet ground stripes as clear but refuses a spot that would cover drawn type", () => {
    const width = 400, height = 200, channels = 4;
    const pixels = new Uint8Array(width * height * channels);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(Math.floor(x / 20) % 2 ? [26, 38, 51, 255] : [12, 17, 24, 255], (y * width + x) * 4);
    const image = { width, height, channels, pixels };
    assert.ok(findClearSpot(image, { boxW: 60, boxH: 14, inset: 10 }));
    for (let y = 150; y < height; y++) for (let x = 0; x < width; x += 3) pixels.set([240, 240, 240, 255], (y * width + x) * 4);
    assert.equal(findClearSpot(image, { boxW: 60, boxH: 14, inset: 10 }), null);
  });

  it("puts the flame logo left of the text, centred on its x-height band", () => {
    const box = markLogoBox({ x: 100, y: 50, fontSize: 10, textWidth: 60 });
    assert.equal(box.size, WORDMARK.logoScale * 10);
    assert.equal(box.x, 100 - 60 - WORDMARK.logoGap * 10 - box.size);
    assert.equal(box.y, 50 - 3.6 - box.size / 2);
  });
});

// The lit-diagram-drawer and lit-schematic marks moved with those skills to the figures extras plugin, and the film
// cover mark and end card with lit-typographic-motion to the video-covers extras plugin.

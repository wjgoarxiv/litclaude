// A card row's text with the sunset scene (sun, stars, sea) blanked out, at the same width: only the words are left.
// The live step's spinner (`- Bash`) is not part of the scene.
export const clearSky = (text) => text.replace(/(?<=\s)(?!- \p{L})[.+*~▁-█-]+(?=\s)/gu, (scene) => " ".repeat(scene.length));

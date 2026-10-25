// Cover-mode test helpers: a finished cover run without Chrome (treatment, manifest, report, stills),
// and a cover answers file, for the look rounds, the done-check and the Stop hook.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng } from "../../plugins/litclaude/skills/lit-typographic-motion/engine/node/png.mjs";
import { coverTreatment } from "./motion-treatment.mjs";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

export function fakeCoverRun(out, { verdict = "PASS+TARGET", treatment = coverTreatment() } = {}) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "treatment.json"), `${JSON.stringify(treatment, null, 2)}\n`);
  mkdirSync(join(out, "stills"), { recursive: true });
  const files = [];
  const put = (name, kind) => {
    const bytes = encodePng(Buffer.alloc(8 * 4 * 3, files.length * 9), 8, 4, 3);
    writeFileSync(join(out, "stills", name), bytes);
    files.push({ file: `stills/${name}`, sha256: sha256(bytes), kind });
  };
  put("frame-00.png", "frame");
  put("poster.png", "poster");
  put("seam.png", "seam");
  put("sheet.png", "sheet");
  writeFileSync(join(out, "stills", "index.json"), `${JSON.stringify({ schema: "litclaude.motion-stills/v1", path: "cover", mode: "cover", round: 1, stillsOnly: false, width: 1000, height: 500, durationSec: 6.048, files }, null, 2)}\n`);
  writeFileSync(join(out, "gate-report.txt"), `COVER gate --strict: ${verdict}\n`);
  writeFileSync(join(out, "manifest.json"), JSON.stringify({ mode: "cover", treatmentSha256: sha256(readFileSync(join(out, "treatment.json"))) }));
  return out;
}

/** Move the fake run's stills to round `round` (as a new render would). */
export function bumpStillsRound(out, round) {
  const index = JSON.parse(readFileSync(join(out, "stills", "index.json"), "utf8"));
  writeFileSync(join(out, "stills", "index.json"), JSON.stringify({ ...index, round }));
}

export const coverAnswers = (over = {}) => ({
  viewed: ["stills/sheet.png", "stills/poster.png", "stills/seam.png"],
  change: "Sharpen the light edge from 60 px to 24 px so the encoder keeps it.",
  answers: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((q) => ({
    q, verdict: q === 8 ? "none" : [6, 7].includes(q) ? "no" : "yes", frame: q === 2 ? "stills/seam.png" : "stills/sheet.png",
    observed: `Question ${q}: the orange dot sits at a different angle in every tile of the sheet row ${q}.`,
  })),
  ...over,
});

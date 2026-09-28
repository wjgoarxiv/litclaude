// Valid lit-typographic-motion treatments for the tests, written for this product's own corpus
// (neutral invented subjects, no shipped example values). Each call returns a fresh deep copy so a
// case can break one field without touching the others.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const clone = (value) => JSON.parse(JSON.stringify(value));

const STAGE = {
  request: "씨앗 도서관이 어떻게 운영되는지 보여주는 영상 만들어줘 lit",
  genre: "explainer",
  path: "stage",
  pathReason: "The film has to show seed packets moving between shelf, soil and harvest, which type alone cannot draw.",
  idea: "One paper packet makes a full year's loop from a lending shelf into the soil and back again.",
  audience: "Neighbours who garden a little and have never borrowed seeds.",
  channel: "The lobby screen of a public library, watched with sound on.",
  format: "16:9",
  formatReason: "The lobby screen is a landscape display.",
  durationSec: 16,
  beats: [
    { t0: 0, t1: 3, purpose: "Pose the question of how a seed can be borrowed.", onScreen: "A closed packet on a lending shelf, a return-date stamp beside it.", motion: "Slow push-in; the stamp lands on the downbeat.", sound: "Pad opens, soft pulse." },
    { t0: 3, t1: 6.5, purpose: "Show the first step: borrowing.", onScreen: "The packet slides off the shelf into a hand-drawn tote.", motion: "Match cut from shelf edge to tote seam.", sound: "Hit on the cut." },
    { t0: 6.5, t1: 10, purpose: "Show the second step: growing.", onScreen: "Seeds drop into furrows and sprout in a time-lapse line drawing.", motion: "Mask wipe down into the soil, then stems draw on.", sound: "Pulse doubles; a rise into the harvest." },
    { t0: 10, t1: 13, purpose: "Show the result: a harvest returned.", onScreen: "New packets fill the shelf gaps, each tagged with a grower's initial.", motion: "Staggered drops in rhythm, layered depth with parallax.", sound: "Hit on the cut." },
    { t0: 13, t1: 16, purpose: "Recap the loop and name the place.", onScreen: "The loop diagram closes into the library's mark.", motion: "Morph from loop to mark, then settle.", sound: "Closing cadence." },
  ],
  subject: { name: "Maru Seed Library", source: "invented", specifics: ["Lends heirloom seed packets the way a library lends books.", "Borrowers repay with seeds saved from their own harvest."] },
  visualDevices: [
    { kind: "illustration", role: "subject", beats: [0, 1, 2, 3, 4] },
    { kind: "diagram", role: "support", beats: [2, 4] },
    { kind: "path", role: "support", beats: [2] },
    { kind: "grid", role: "texture", beats: [0, 1] },
  ],
  typePlan: { faces: ["Pretendard"], hierarchy: "One headline per beat over one caption line.", maxWordsOnScreen: 8 },
  palette: [
    { color: "#f4efe6", role: "paper ground" },
    { color: "#2f4a3a", role: "ink and type" },
    { color: "#c9713c", role: "seed accent" },
  ],
  sound: { mode: "generated", plan: "A light pulse under the steps with hits on the cuts and a closing cadence.", palette: { timbre: "__TIMBRE__", key: "D", mode: "major", tempo: 92 } },
  copy: { source: "invented", lines: ["씨앗도 빌릴 수 있어요", "심고, 키우고, 거둔 만큼 돌려주세요", "마루 씨앗 도서관"] },
  inventions: ["Maru Seed Library (the name)", "the repay-with-harvest rule", "all three copy lines"],
  ambition: "Match cuts that carry the packet shape from shelf to soil to shelf, with the pulse locking every drop and a morph that closes the loop.",
};

const TYPE = {
  request: "\"물은 낮은 곳으로 흘러 결국 바다가 된다\" 이 문장으로 키네틱 타이포 영상 만들어줘 lit",
  genre: "type-led",
  path: "type",
  pathReason: "The user supplied one sentence and asked for kinetic type; the words themselves are the film.",
  idea: "A single breath that slows as it runs downhill and opens out when it reaches the end.",
  audience: "People who follow a small writing circle online.",
  channel: "A landscape post in a feed, played with sound.",
  format: "16:9",
  formatReason: "The feed post is shown landscape.",
  durationSec: 10,
  beats: [
    { t0: 0, t1: 3.5, purpose: "Set the first clause alone.", onScreen: "The first clause, set large and left-aligned.", motion: "Words arrive one eojeol at a time.", sound: "Pad opens." },
    { t0: 3.5, t1: 7, purpose: "Let the second clause fall lower.", onScreen: "The second clause drops a line lower than the first.", motion: "A slow downward drift with a long ease.", sound: "Rise into the last line." },
    { t0: 7, t1: 10, purpose: "Land the last word and hold.", onScreen: "The last phrase alone, centred, then held.", motion: "Settle and hold for reading.", sound: "Closing cadence." },
  ],
  subject: { name: "the supplied sentence", source: "user", specifics: ["A sentence about water finding its way down to the sea."] },
  visualDevices: [],
  typePlan: { faces: ["Pretendard"], hierarchy: "One clause per beat, the last phrase largest.", maxWordsOnScreen: 4 },
  palette: [
    { color: "#0e1a24", role: "deep ground" },
    { color: "#e8f1f4", role: "type" },
    { color: "#6fb3c8", role: "single accent" },
  ],
  sound: { mode: "generated", plan: "A slow pad with a rise into the last clause and a cadence at the end.", palette: { timbre: "__TIMBRE__", key: "A", mode: "minor", tempo: 72 } },
  copy: { source: "user", lines: ["물은 낮은 곳으로 흘러", "결국 바다가 된다"] },
  inventions: [],
  ambition: "Pacing that slows with the meaning, one clear hierarchy per beat and an ending that holds long enough to land.",
};

export function stageTreatment(timbre, overrides = {}) {
  const t = clone(STAGE);
  t.sound.palette.timbre = timbre;
  return { ...t, ...overrides };
}

export function typeTreatment(timbre, overrides = {}) {
  const t = clone(TYPE);
  t.sound.palette.timbre = timbre;
  return { ...t, ...overrides };
}

export function writeTreatment(dir, treatment) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "treatment.json");
  writeFileSync(file, `${JSON.stringify(treatment, null, 2)}\n`);
  return file;
}

/** The shortest valid type treatment (4 s, two beats), for engine tests that only need a render. */
export function shortTypeTreatment(timbre) {
  return typeTreatment(timbre, {
    durationSec: 4,
    beats: [
      { t0: 0, t1: 2, purpose: "Open on the first line.", onScreen: "The first line, set large.", motion: "Lands on the beat.", sound: "Pad opens." },
      { t0: 2, t1: 4, purpose: "Close on the last line.", onScreen: "The last line, centred and held.", motion: "Settles and holds.", sound: "Closing cadence." },
    ],
  });
}

/**
 * A short stage treatment for renderer tests: genre other (three beats), muted channel so sound can
 * be none, and the copy the fixture pages show.
 */
export function stageTestTreatment(timbre, { format = "16:9", fps, durationSec = 4, copy = ["Lanterns drift home"], sound = null } = {}) {
  const third = +(durationSec / 3).toFixed(3);
  const t = stageTreatment(timbre, {
    request: "render a short stage check clip lit",
    genre: "other",
    format,
    formatReason: format === "9:16" ? "A vertical loop on a portrait panel." : "A landscape loop on a wall panel.",
    channel: "A muted loop on a wall panel.",
    durationSec,
    beats: [
      { t0: 0, t1: third, purpose: "Open on the moving shape.", onScreen: "One square moving across a dark ground.", motion: "Constant drift with rotation.", sound: "None." },
      { t0: third, t1: +(2 * third).toFixed(3), purpose: "Change the shape.", onScreen: "The square rounds into a disc.", motion: "Timer-driven corner change.", sound: "None." },
      { t0: +(2 * third).toFixed(3), t1: durationSec, purpose: "Hold the line.", onScreen: "The copy line under the disc.", motion: "Hold.", sound: "None." },
    ],
    visualDevices: [{ kind: "shape", role: "subject", beats: [0, 1, 2] }, { kind: "icon", role: "support", beats: [2] }],
    sound: sound ?? { mode: "none", plan: "Silent: the panel plays muted." },
    copy: { source: "invented", lines: copy },
    inventions: ["Maru Seed Library (the name)", "the copy line"],
  });
  if (fps) t.fps = fps;
  return t;
}

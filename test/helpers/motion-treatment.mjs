// Valid lit-typographic-motion treatments for the tests, written for this product's own corpus
// (neutral invented subjects, no shipped example values). Each call returns a fresh deep copy so a
// case can break one field without touching the others. The stage explainer takes the style its genre
// picks (paper), the type film the default (swiss-signal): their colours and faces, a rich world on the
// stage and a per-film score, so the timbre argument is kept for the callers' signature only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const clone = (value) => JSON.parse(JSON.stringify(value));

const STAGE = {
  request: "씨앗 도서관이 어떻게 운영되는지 보여주는 영상 만들어줘 lit",
  genre: "explainer",
  path: "stage",
  pathReason: "The film has to show seed packets moving between shelf, soil and harvest, which type alone cannot draw.",
  style: "paper",
  idea: "One paper packet makes a full year's loop from a lending shelf into the soil and back again.",
  audience: "Neighbours who garden a little and have never borrowed seeds.",
  channel: "The lobby screen of a public library, watched with sound on.",
  format: "16:9",
  formatReason: "The lobby screen is a landscape display.",
  durationSec: 16,
  beats: [
    { t0: 0, t1: 3, purpose: "Pose the question of how a seed can be borrowed.", onScreen: "A closed packet on a lending shelf, a return-date stamp beside it.", motion: "Slow push-in; the stamp lands on the downbeat.", sound: "Pad opens, soft pulse.", layout: "split", hero: "The return-date stamp lands on the packet.", transition: "match" },
    { t0: 3, t1: 6.5, purpose: "Show the first step: borrowing.", onScreen: "The packet slides off the shelf into a hand-drawn tote.", motion: "Match cut from shelf edge to tote seam.", sound: "Hit on the cut.", layout: "split-alt", hero: "The packet slides into the tote.", transition: "wipe" },
    { t0: 6.5, t1: 10, purpose: "Show the second step: growing.", onScreen: "Seeds drop into furrows and sprout in a time-lapse line drawing.", motion: "Mask wipe down into the soil, then stems draw on.", sound: "Pulse doubles; a rise into the harvest.", layout: "hero", hero: "Stems draw up out of the furrows.", transition: "cut" },
    { t0: 10, t1: 13, purpose: "Show the result: a harvest returned.", onScreen: "New packets fill the shelf gaps, each tagged with a grower's initial.", motion: "Staggered drops in rhythm, layered depth with parallax.", sound: "Hit on the cut.", layout: "split", hero: "Packets drop into the shelf gaps in rhythm.", transition: "match" },
    { t0: 13, t1: 16, purpose: "Recap the loop and name the place.", onScreen: "The loop diagram closes into the library's mark.", motion: "Morph from loop to mark, then settle.", sound: "Closing cadence.", layout: "title", hero: "The loop closes into the mark.", transition: "end" },
  ],
  story: { expect: "A library shelf that lends books, like every other library.", turn: "The borrowed packet comes back as a whole drawer of new packets, more than was lent.", beat: 3, payoff: "The shelf ends fuller than it began, and the loop closes into the library's mark." },
  protagonist: { name: "the paper packet", kind: "object", look: "A folded kraft seed packet with a terracotta stamp, a third of the frame tall.", acts: [{ beat: 0, action: "Waits on the shelf and takes the stamp." }, { beat: 1, action: "Slides into the tote." }, { beat: 3, action: "Returns and splits into a row of new packets." }, { beat: 4, action: "Folds into the library's mark." }] },
  subject: { name: "Maru Seed Library", source: "invented", specifics: ["Lends heirloom seed packets the way a library lends books.", "Borrowers repay with seeds saved from their own harvest."] },
  visualDevices: [
    { kind: "illustration", role: "subject", beats: [0, 1, 2, 3, 4] },
    { kind: "diagram", role: "support", beats: [2, 4] },
    { kind: "path", role: "support", beats: [2] },
    { kind: "grid", role: "texture", beats: [0, 1] },
  ],
  typePlan: { faces: ["Pretendard"], hierarchy: "One headline per beat over one caption line.", maxWordsOnScreen: 8 },
  palette: [
    { color: "#f3eee5", role: "ground" },
    { color: "#1d1b18", role: "ink and type" },
    { color: "#b0452a", role: "seed accent" },
  ],
  world: {
    layers: ["Back: a reading room in paper tones, shelves receding into soft focus.", "Middle: the lending shelf with numbered drawers and a return-date board.", "Front: the packet, the stamp and the tote, each with its tag."],
    labels: ["반납일 3월 14일", "토마토 · 2024 수확", "대출 서랍 A-12", "고랑 1", "발아 7일", "돌려준 씨앗 +12"],
    camera: [{ beat: 0, move: "A slow push-in on the shelf." }, { beat: 2, move: "A crane down into the soil." }, { beat: 3, move: "A truck along the shelf as the packets drop." }],
  },
  sound: { mode: "score", plan: "A light house groove that builds through the steps, drops on the returned drawer and closes on a cadence.", events: [{ t: 1.6, on: "The return-date stamp lands on the packet.", kind: "tap" }, { t: 11.2, on: "The first new packet drops into a shelf gap.", kind: "tap" }, { t: 14.4, on: "The loop closes into the mark.", kind: "chime" }] },
  copy: { source: "invented", lines: ["씨앗도 빌릴 수 있어요", "심고, 키우고, 거둔 만큼 돌려주세요", "마루 씨앗 도서관"] },
  inventions: ["Maru Seed Library (the name)", "the repay-with-harvest rule", "all three copy lines"],
  ambition: "Match cuts that carry the packet shape from shelf to soil to shelf, with the pulse locking every drop and a morph that closes the loop.",
};

const TYPE = {
  request: "\"물은 낮은 곳으로 흘러 결국 바다가 된다\" 이 문장으로 키네틱 타이포 영상 만들어줘 lit",
  genre: "type-led",
  path: "type",
  pathReason: "The user supplied one sentence and asked for kinetic type; the words themselves are the film.",
  style: "swiss-signal",
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
  story: { expect: "Water that keeps falling until it disappears.", turn: "The falling line stops shrinking and opens out wide.", beat: 2, payoff: "The last phrase holds as wide as the frame, like the sea." },
  subject: { name: "the supplied sentence", source: "user", specifics: ["A sentence about water finding its way down to the sea."] },
  visualDevices: [],
  typePlan: { faces: ["Pretendard"], hierarchy: "One clause per beat, the last phrase largest.", maxWordsOnScreen: 4 },
  palette: [
    { color: "#0e1a24", role: "deep ground" },
    { color: "#e8f1f4", role: "type" },
    { color: "#6fb3c8", role: "single accent" },
  ],
  sound: { mode: "score", plan: "A deep groove with a rise into the last clause and a cadence at the end." },
  copy: { source: "user", lines: ["물은 낮은 곳으로 흘러", "결국 바다가 된다"] },
  inventions: [],
  ambition: "Pacing that slows with the meaning, one clear hierarchy per beat and an ending that holds long enough to land.",
};

export function stageTreatment(_timbre, overrides = {}) {
  return { ...clone(STAGE), ...overrides };
}

export function typeTreatment(_timbre, overrides = {}) {
  return { ...clone(TYPE), ...overrides };
}

export function writeTreatment(dir, treatment) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "treatment.json");
  writeFileSync(file, `${JSON.stringify(treatment, null, 2)}\n`);
  return file;
}


/**
 * The shortest valid type treatment (4 s, two beats), for engine tests that only need a render. A
 * `style` other than the default names itself in the request, as a user would, and takes its bed.
 */
export function shortTypeTreatment(timbre, { style = "swiss-signal" } = {}) {
  const named = style === "swiss-signal" ? {} : { style, request: `${TYPE.request} (${style} style)` };
  return typeTreatment(timbre, {
    ...named,
    story: { ...clone(TYPE.story), beat: 1 },
    durationSec: 4,
    beats: [
      { t0: 0, t1: 2, purpose: "Open on the first line.", onScreen: "The first line, set large.", motion: "Lands on the beat.", sound: "Pad opens." },
      { t0: 2, t1: 4, purpose: "Close on the last line.", onScreen: "The last line, centred and held.", motion: "Settles and holds.", sound: "Closing cadence." },
    ],
  });
}

/**
 * A short stage treatment for renderer tests: genre other (three beats), muted channel so sound can
 * be none, the copy the fixture pages show, and the minimal register (the fixture pages draw no world).
 */
export function stageTestTreatment(timbre, { format = "16:9", fps, durationSec = 4, copy = ["Lanterns drift home"], sound = null } = {}) {
  const third = +(durationSec / 3).toFixed(3);
  const t = stageTreatment(timbre, {
    request: `render a short, minimal ${durationSec} s ${format === "9:16" ? "vertical " : ""}stage check clip${fps === 30 ? " at 30 fps" : ""} lit`,
    register: "minimal",
    genre: "other",
    style: "swiss-signal",
    palette: [{ color: "#0c0e13", role: "ground" }, { color: "#e9ebe4", role: "ink and type" }],
    format,
    formatReason: format === "9:16" ? "A vertical loop on a portrait panel." : "A landscape loop on a wall panel.",
    channel: "A muted loop on a wall panel.",
    durationSec,
    beats: [
      { t0: 0, t1: third, purpose: "Open on the moving shape.", onScreen: "One square moving across a dark ground.", motion: "Constant drift with rotation.", sound: "None.", layout: "stage", hero: "The square drifts and turns.", transition: "cut" },
      { t0: third, t1: +(2 * third).toFixed(3), purpose: "Change the shape.", onScreen: "The square rounds into a disc.", motion: "Timer-driven corner change.", sound: "None.", layout: "hero", hero: "The corners round into a disc.", transition: "cut" },
      { t0: +(2 * third).toFixed(3), t1: durationSec, purpose: "Hold the line.", onScreen: "The copy line under the disc.", motion: "Hold.", sound: "None.", layout: "stage", hero: "The copy line settles under the disc.", transition: "end" },
    ],
    story: { expect: "A square that keeps drifting.", turn: "The square rounds into a disc mid-drift.", beat: 1, payoff: "The line settles under the disc." },
    protagonist: { name: "the square", kind: "object", look: "A flat signal-coloured square a fifth of the frame wide.", acts: [{ beat: 0, action: "Drifts and turns." }, { beat: 1, action: "Rounds into a disc." }, { beat: 2, action: "Rests above the line." }] },
    visualDevices: [{ kind: "shape", role: "subject", beats: [0, 1, 2] }, { kind: "icon", role: "support", beats: [2] }],
    sound: sound ?? { mode: "none", plan: "Silent: the panel plays muted." },
    copy: { source: "invented", lines: copy },
    inventions: ["Maru Seed Library (the name)", "the copy line"],
  });
  delete t.world;
  if (fps) t.fps = fps;
  return t;
}

/** A cover treatment (mode: cover) for the cover-mode tests; the fixture page draws LOOPTEST. */
export const coverTreatment = (over = {}) => ({
  mode: "cover",
  request: "An animated cover for the top of the LOOPTEST readme.",
  idea: "Bars drift one period per loop while a dot laps a ring beside a still word.",
  recipe: "own",
  recipeReason: "A test pattern with all three speed layers and nothing else.",
  hero: "The dot on its ring.",
  beat: "The dot pulses as it passes twelve o'clock.",
  brandWord: "LOOPTEST",
  aspect: "2:1",
  loopSec: 6,
  fps: 16,
  layers: { slow: "Bars drift one period per loop.", mid: "A dot laps its ring twice per loop.", beat: "The dot pulses once per lap." },
  system: { rule: "One bar rule.", copies: "Fourteen bars.", offset: "Each bar's x position." },
  title: { box: [0.06, 0.37, 0.56, 0.27], kind: "live" },
  ambition: "Every frame moves and the seam disappears in the decoded file.",
  ...over,
});

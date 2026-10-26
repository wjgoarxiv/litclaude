// The band's timeline: which animations are running and since when. The surface module keeps one
// timeline in its local state, folds every new model into it (advanceTimeline), samples it once per
// frame (sampleTimeline) and stops its frame timer as soon as nothing moves (timelineBusy). Times are
// the surface module's own frame clock in milliseconds; nothing here reads a wall clock.

import { EASE, TIMINGS, isSettled, phase, retarget, sample, still } from "./motion.mjs";

const PHASES = ["plan", "work", "review"];
// The count the bar follows: the workflow stage's n/m, else the plan or goal progress.
const countOf = (model) => model.workflow?.count ?? model.progress ?? null;
const fractionOf = (model) => {
  const count = countOf(model);
  return count && count.total > 0 ? Math.min(1, count.done / count.total) : 0;
};

// The live step's clock: the elapsed time the model carried and the frame it arrived on, so the
// surface counts on between models.
const stepOf = (model, now) => (model.step ? { name: model.step.name, base: model.step.elapsedMs, at: now } : null);

// The lanes' clock, kept the same way: the longest-running lane's time as the model carried it.
const lanesOf = (model, now) => {
  const times = (model.lanes?.list ?? []).map(({ elapsedMs }) => elapsedMs).filter(Number.isFinite);
  return times.length ? { base: Math.max(...times), at: now } : null;
};

const entryEnd = (profile) => 3 * profile.duration(TIMINGS.stagger) + profile.duration(TIMINGS.entry);

// One entry per chip: `at` is the firing the model reported, `arrivedAt` when this timeline saw
// that firing arrive (null for chips already there when the band appeared, so they do not shimmer),
// and the state crossfade from `from` to `state` starting at `changedAt`.
const chipsOf = (model, now, previous = null) => Object.fromEntries((model.skills ?? []).map((chip) => {
  const known = previous?.[chip.id];
  if (!known || known.at !== chip.at) {
    return [chip.id, { at: chip.at, arrivedAt: previous === null ? null : now, state: chip.state, from: chip.state, changedAt: now }];
  }
  if (known.state !== chip.state) return [chip.id, { ...known, from: known.state, state: chip.state, changedAt: now }];
  return [chip.id, known];
}));

// The ambient loop runs while the card shows LitClaude at work, so motion itself says "active",
// and while the rewind look lingers after a brief; `at` is when the current run began, so the loop
// does not restart on every new model.
const ambientOf = (model, now, profile, previous = null) => {
  const on = Boolean(profile.ambient) && model.visible && (!model.idle || model.rewind === true);
  return { on, at: on && previous?.on ? previous.at : now };
};

export const createTimeline = (model, now, profile) => {
  const restAt = now + entryEnd(profile);
  return {
    ambient: ambientOf(model, now, profile),
    enterAt: now,
    exitAt: null,
    fill: { from: 0, to: fractionOf(model), at: restAt, dur: profile.duration(TIMINGS.fill) },
    done: countOf(model)?.done ?? null,
    flashAt: null,
    step: stepOf(model, now),
    lanes: lanesOf(model, now),
    warn: still(model.ctxWarning ? 1 : 0),
    phases: Object.fromEntries(PHASES.map((id) => [id, { from: model.phases[id], to: model.phases[id], at: now }])),
    notice: model.notice ? { data: model.notice, at: restAt } : null,
    leaving: null,
    completion: model.completion ? { data: model.completion, at: now } : null,
    chips: chipsOf(model, now),
  };
};

export const advanceTimeline = (timeline, model, now, profile) => {
  const next = { ...timeline };
  if (!model.visible && timeline.exitAt === null) next.exitAt = now;
  if (model.visible && timeline.exitAt !== null) return createTimeline(model, now, profile);
  next.fill = retarget(timeline.fill, fractionOf(model), now, profile.duration(TIMINGS.fill));
  const done = countOf(model)?.done ?? null;
  if (done !== timeline.done) {
    next.done = done;
    if (timeline.done !== null && done !== null) next.flashAt = now;
  }
  next.warn = retarget(timeline.warn, model.ctxWarning ? 1 : 0, now, profile.duration(TIMINGS.crossfade));
  next.phases = Object.fromEntries(PHASES.map((id) => {
    const current = timeline.phases[id];
    return [id, current.to === model.phases[id] ? current : { from: current.to, to: model.phases[id], at: now }];
  }));
  const incoming = model.notice?.id ?? null;
  if (incoming !== (timeline.notice?.data.id ?? null)) {
    next.leaving = timeline.notice ? { data: timeline.notice.data, at: now } : timeline.leaving;
    next.notice = model.notice ? { data: model.notice, at: now } : null;
  }
  if ((model.completion?.id ?? null) !== (timeline.completion?.data.id ?? null)) {
    next.completion = model.completion ? { data: model.completion, at: now } : null;
  }
  next.chips = chipsOf(model, now, timeline.chips);
  next.ambient = ambientOf(model, now, profile, timeline.ambient);
  next.step = stepOf(model, now);
  next.lanes = lanesOf(model, now);
  return next;
};

/** True while the card shows a running clock (the live step or the lanes'); it ticks each second. */
export const clockShown = (timeline) => timeline.exitAt === null && Boolean(timeline.step || timeline.lanes);

/** True while the ambient loop runs; the surface module then keeps a slower frame timer going. */
export const ambientActive = (timeline, profile) => Boolean(profile.ambient) && timeline.exitAt === null && timeline.ambient.on;

// The rewind look's sparks: fixed seeds (a small LCG, so every surface draws the same sky), each a
// starting place, a drift speed and a twinkle offset.
const SPARK_SEEDS = (() => {
  let state = 13;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  return Object.freeze(Array.from({ length: 7 }, () => Object.freeze({ start: next(), speed: 0.6 + 0.8 * next(), twinkle: next() })));
})();

// Where each spark stands at `elapsed` (`x`, 0 to 1, drifting right to left) and which of the four
// ASCII sparks it shows (`glyph`, 0 to 3).
const sparksAt = (elapsed) => SPARK_SEEDS.map(({ start, speed, twinkle }) => {
  const x = start - (elapsed * speed) / TIMINGS.sparks;
  const t = elapsed / (TIMINGS.sparks / 4) + twinkle;
  return { x: ((x % 1) + 1) % 1, glyph: Math.floor((((t % 1) + 1) % 1) * 4) };
});

// One frame of the ambient loop: `breath` (0 to 1 and back over TIMINGS.breath), where the light
// stands on the active phase (`sweep`, null between passes), how far the comet has gone around
// the card (`comet`, 0 to 1: the top rule left to right, then the bottom rule right to left),
// where the bright head stands on the rail leaving the current stage (`flow`, 0 to 1), how far the
// rewind look's hue has turned (`hue`, 0 to 1 over TIMINGS.hue) and its sparks (`sparks`, full only).
const ambientSample = (timeline, now, profile) => {
  if (!ambientActive(timeline, profile)) return null;
  const elapsed = Math.max(0, now - timeline.ambient.at);
  const breath = 0.5 - 0.5 * Math.cos((2 * Math.PI * elapsed) / TIMINGS.breath);
  const pass = ((elapsed % TIMINGS.sweep) / TIMINGS.sweep) * 1.6 - 0.3;
  return {
    breath,
    sweep: profile.ambient.sweep && pass >= -0.2 && pass <= 1.2 ? pass : null,
    comet: profile.ambient.comet ? (elapsed % TIMINGS.comet) / TIMINGS.comet : null,
    flow: profile.ambient.sweep ? (elapsed % TIMINGS.flow) / TIMINGS.flow : null,
    hue: (elapsed % TIMINGS.hue) / TIMINGS.hue,
    sparks: profile.ambient.sweep ? sparksAt(elapsed) : null,
  };
};

export const timelineBusy = (timeline, now, profile) => {
  const d = profile.duration;
  if (timeline.exitAt !== null) return now < timeline.exitAt + d(TIMINGS.exit);
  if (now < timeline.enterAt + entryEnd(profile)) return true;
  if (!isSettled(timeline.fill, now) || !isSettled(timeline.warn, now)) return true;
  if (timeline.flashAt !== null && now < timeline.flashAt + d(TIMINGS.flash)) return true;
  if (PHASES.some((id) => timeline.phases[id].from !== timeline.phases[id].to && now < timeline.phases[id].at + d(TIMINGS.crossfade))) return true;
  if (timeline.notice && now < timeline.notice.at + d(TIMINGS.noticeIn)) return true;
  if (timeline.leaving && now < timeline.leaving.at + d(TIMINGS.noticeOut)) return true;
  if (timeline.completion && now < timeline.completion.at + d(TIMINGS.completion)) return true;
  return Object.values(timeline.chips).some((chip) => (chip.arrivedAt !== null && now < chip.arrivedAt + d(TIMINGS.shimmer))
    || (chip.from !== chip.state && now < chip.changedAt + d(TIMINGS.crossfade)));
};

/**
 * Everything one frame needs, as numbers: how far each pill has popped in (ease-out-back, so it may
 * pass 1 briefly), the bar's fill, the count flash, the amber mix, each phase's colour crossfade,
 * the notice row's offset in cells, the completion shimmer and embers, and per chip how far its
 * arrival has run (`arrive`, 0 to 1; 1 once settled), where full motion's light stands on its
 * name (`shimmer`, null when none) and its state crossfade.
 */
export const sampleTimeline = (timeline, now, profile) => {
  const d = profile.duration;
  const exit = timeline.exitAt === null ? 0 : EASE.inCubic(phase(now, timeline.exitAt, d(TIMINGS.exit)));
  const pills = [0, 1, 2, 3].map((index) => {
    const popped = profile.enterEase(phase(now, timeline.enterAt + index * d(TIMINGS.stagger), d(TIMINGS.entry)));
    return Math.max(0, popped * (1 - exit));
  });
  const rest = exit > 0 ? 0 : phase(now, timeline.enterAt + entryEnd(profile), 1);
  const flash = timeline.flashAt === null ? 0 : Math.sin(Math.PI * phase(now, timeline.flashAt, d(TIMINGS.flash)));
  const phases = Object.fromEntries(PHASES.map((id) => {
    const { from, to, at } = timeline.phases[id];
    return [id, { from, to, mix: from === to ? 1 : EASE.inOutCubic(phase(now, at, d(TIMINGS.crossfade))) }];
  }));
  let notice = null;
  if (timeline.notice) {
    const p = phase(now, timeline.notice.at, d(TIMINGS.noticeIn));
    notice = { data: timeline.notice.data, offset: Math.max(0, Math.round(14 * (1 - profile.noticeEase(p)))) };
  } else if (timeline.leaving && now < timeline.leaving.at + d(TIMINGS.noticeOut)) {
    notice = { data: timeline.leaving.data, offset: Math.round(40 * EASE.inCubic(phase(now, timeline.leaving.at, d(TIMINGS.noticeOut)))) };
  }
  let completion = null;
  if (timeline.completion) {
    const at = timeline.completion.at;
    completion = {
      data: timeline.completion.data,
      shimmer: profile.shimmer && now >= at + d(50) && now < at + d(50) + d(TIMINGS.shimmer)
        ? EASE.outCubic(phase(now, at + d(50), d(TIMINGS.shimmer))) * 1.3 - 0.15
        : null,
      embers: profile.embers ? phase(now, at, d(TIMINGS.embers)) : null,
      title: EASE.outCubic(phase(now, at + d(30), d(200))),
      detail: EASE.outCubic(phase(now, at + d(100), d(200))),
    };
  }
  const chips = Object.fromEntries(Object.entries(timeline.chips).map(([id, chip]) => {
    const arrive = chip.arrivedAt === null ? 1 : phase(now, chip.arrivedAt, d(TIMINGS.shimmer));
    return [id, {
      arrive,
      shimmer: profile.shimmer && arrive < 1 ? EASE.outCubic(arrive) * 1.3 - 0.15 : null,
      from: chip.from,
      to: chip.state,
      mix: chip.from === chip.state ? 1 : EASE.inOutCubic(phase(now, chip.changedAt, d(TIMINGS.crossfade))),
    }];
  }));
  return {
    pills,
    rest,
    exit,
    fill: sample(timeline.fill, now),
    fillGlow: isSettled(timeline.fill, now) ? 0 : Math.sin(Math.PI * phase(now, timeline.fill.at, timeline.fill.dur)),
    flash,
    warn: sample(timeline.warn, now),
    phases,
    notice,
    completion,
    chips,
    ambient: ambientSample(timeline, now, profile),
    step: timeline.step ? { name: timeline.step.name, elapsedMs: timeline.step.base + Math.max(0, now - timeline.step.at) } : null,
    lanes: timeline.lanes ? { elapsedMs: timeline.lanes.base + Math.max(0, now - timeline.lanes.at) } : null,
    spin: Math.floor(Math.max(0, now) / TIMINGS.spin) % 4,
  };
};

/** The final frame of a model, for motion off, surfaces without frame clocks and tests. */
export const settledSample = (model) => {
  const profile = { duration: () => 0, enterEase: EASE.linear, noticeEase: EASE.linear, shimmer: false, embers: false };
  return sampleTimeline(createTimeline(model, 0, profile), 1, profile);
};

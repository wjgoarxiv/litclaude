// The band's timeline: which animations are running and since when. The surface module keeps one
// timeline in its local state, folds every new model into it (advanceTimeline), samples it once per
// frame (sampleTimeline) and stops its frame timer as soon as nothing moves (timelineBusy). Times are
// the surface module's own frame clock in milliseconds; nothing here reads a wall clock.

import { EASE, TIMINGS, isSettled, phase, retarget, sample, still } from "./motion.mjs";

const PHASES = ["plan", "work", "review"];
const fractionOf = (model) => (model.progress && model.progress.total > 0 ? Math.min(1, model.progress.done / model.progress.total) : 0);

const entryEnd = (profile) => 3 * profile.duration(TIMINGS.stagger) + profile.duration(TIMINGS.entry);

export const createTimeline = (model, now, profile) => {
  const restAt = now + entryEnd(profile);
  return {
    enterAt: now,
    exitAt: null,
    fill: { from: 0, to: fractionOf(model), at: restAt, dur: profile.duration(TIMINGS.fill) },
    done: model.progress?.done ?? null,
    flashAt: null,
    warn: still(model.ctxWarning ? 1 : 0),
    phases: Object.fromEntries(PHASES.map((id) => [id, { from: model.phases[id], to: model.phases[id], at: now }])),
    notice: model.notice ? { data: model.notice, at: restAt } : null,
    leaving: null,
    completion: model.completion ? { data: model.completion, at: now } : null,
  };
};

export const advanceTimeline = (timeline, model, now, profile) => {
  const next = { ...timeline };
  if (!model.visible && timeline.exitAt === null) next.exitAt = now;
  if (model.visible && timeline.exitAt !== null) return createTimeline(model, now, profile);
  next.fill = retarget(timeline.fill, fractionOf(model), now, profile.duration(TIMINGS.fill));
  const done = model.progress?.done ?? null;
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
  return next;
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
  return false;
};

/**
 * Everything one frame needs, as numbers: how far each pill has popped in (ease-out-back, so it may
 * pass 1 briefly), the bar's fill, the count flash, the amber mix, each phase's colour crossfade,
 * the notice row's offset in cells, and the completion shimmer and embers.
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
  };
};

/** The final frame of a model, for motion off, surfaces without frame clocks and tests. */
export const settledSample = (model) => {
  const profile = { duration: () => 0, enterEase: EASE.linear, noticeEase: EASE.linear, shimmer: false, embers: false };
  return sampleTimeline(createTimeline(model, 0, profile), 1, profile);
};

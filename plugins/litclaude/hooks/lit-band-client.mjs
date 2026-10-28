// The LIT band's surface module: the `Client` element lit-mod.mjs draws above the prompt. It runs on
// the drawing thread with no mods API, keeps the band's timeline in its local state, and animates on
// the surface's own frame clock: fast while a transition plays, slower while the ambient loop says
// LitClaude is at work, once a second while only a clock (the live step's or the lanes') moves, and
// not at all once the card is idle and settled, when it stays still until the hooks module hands it
// a new model. The clocks count on here, so they move even when the hooks module holds the model
// still for a desktop drawing attached to the same session.

import { composeBand } from "../lib/mod/frame.mjs";
import { TIMINGS, motionProfile } from "../lib/mod/motion.mjs";
import { renderBand } from "../lib/mod/render.mjs";
import { advanceTimeline, ambientActive, clockShown, createTimeline, glintWait, sampleTimeline, timelineBusy } from "../lib/mod/timeline.mjs";

// The timeline lives in one holder object that the frame timer and every draw share. The timer
// never reads `surface.state` back, so a draw that folded in a new model is never overwritten by a
// tick that started from an older copy.
export default function LitBand(props, surface) {
  const profile = motionProfile(props?.motion);
  const model = props?.model;
  const empty = () => surface.elements.Box({ children: [] });
  if (!model) return empty();

  const holder = surface.state?.live ?? { now: 0, model: null, timeline: null, stop: null, interval: null };
  if (holder.timeline === null) {
    holder.timeline = createTimeline(model, 0, profile);
    holder.model = model;
  } else if (holder.model !== model) {
    holder.timeline = advanceTimeline(holder.timeline, model, holder.now, profile);
    holder.model = model;
  }

  // The club look's glint ticks only during a pass and otherwise sleeps until the next one.
  const interval = () => {
    if (timelineBusy(holder.timeline, holder.now, profile)) return TIMINGS.frame;
    if (ambientActive(holder.timeline, profile)) return TIMINGS.ambientFrame;
    const glint = glintWait(holder.timeline, holder.now, profile);
    const clock = clockShown(holder.timeline) ? TIMINGS.clock : null;
    return glint !== null && (clock === null || glint < clock) ? glint : clock;
  };
  const schedule = () => {
    const wanted = interval();
    if (wanted === holder.interval) return;
    holder.stop?.();
    holder.stop = null;
    holder.interval = wanted;
    if (wanted === null) return;
    holder.stop = surface.every(wanted, () => {
      holder.now += wanted;
      schedule();
      surface.setState({ live: holder, now: holder.now });
    });
  };
  schedule();
  if (surface.state?.live !== holder) surface.setState({ live: holder, now: holder.now });

  if (!model.visible && interval() === null) return empty();
  const frame = composeBand(model, sampleTimeline(holder.timeline, holder.now, profile), { columns: props.columns, glyphs: props.glyphs, accent: props.accent, color: props.color !== false });
  return renderBand(surface.elements, frame);
}

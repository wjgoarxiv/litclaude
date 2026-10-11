// The LIT band's surface module: the `Client` element lit-mod.mjs draws above the prompt. It runs on
// the drawing thread with no mods API, keeps the band's timeline in its local state, and animates on
// the surface's own frame clock only while something moves; once the timeline settles it stops its
// timer and the band stays still until the hooks module hands it a new model.

import { composeBand } from "../lib/mod/frame.mjs";
import { TIMINGS, motionProfile } from "../lib/mod/motion.mjs";
import { renderBand } from "../lib/mod/render.mjs";
import { advanceTimeline, createTimeline, sampleTimeline, timelineBusy } from "../lib/mod/timeline.mjs";

// The timeline lives in one holder object that the frame timer and every draw share. The timer
// never reads `surface.state` back, so a draw that folded in a new model is never overwritten by a
// tick that started from an older copy.
export default function LitBand(props, surface) {
  const profile = motionProfile(props?.motion);
  const model = props?.model;
  const empty = () => surface.elements.Box({ children: [] });
  if (!model) return empty();

  const holder = surface.state?.live ?? { now: 0, model: null, timeline: null, stop: null };
  if (holder.timeline === null) {
    holder.timeline = createTimeline(model, 0, profile);
    holder.model = model;
  } else if (holder.model !== model) {
    holder.timeline = advanceTimeline(holder.timeline, model, holder.now, profile);
    holder.model = model;
  }

  if (holder.stop === null && timelineBusy(holder.timeline, holder.now, profile)) {
    holder.stop = surface.every(TIMINGS.frame, () => {
      holder.now += TIMINGS.frame;
      if (!timelineBusy(holder.timeline, holder.now, profile)) {
        holder.stop?.();
        holder.stop = null;
      }
      surface.setState({ live: holder, now: holder.now });
    });
  }
  if (surface.state?.live !== holder) surface.setState({ live: holder, now: holder.now });

  if (!model.visible && !timelineBusy(holder.timeline, holder.now, profile)) return empty();
  const frame = composeBand(model, sampleTimeline(holder.timeline, holder.now, profile), { columns: props.columns, glyphs: props.glyphs });
  return renderBand(surface.elements, frame);
}

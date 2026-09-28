# Swimlane

**Catalog ID:** `swimlane`

## Purpose and selection

Use swimlanes for a cross-functional process whose key question is who owns each step and where work crosses between people, teams, or systems. Choose horizontal lanes for a left-to-right process or vertical lanes for a top-to-bottom one. Use Sequence when messages and timing between technical actors are the subject; use a flowchart for decision logic with no ownership axis.

## Content schema

Prepare a list of up to five named lanes, each with a stable owner id and optional role. List ordered process steps with a short action, owning lane, and optional duration or condition. Record directed handoffs from one step to the next, including branch outcomes and the lane boundary crossed. Declare the process start/end and whether any step is an external dependency.

## Deterministic layout recipe

1. Order lanes by the real workflow, not by alphabet or team hierarchy. Allocate equal lane widths/heights and label them in a fixed margin or header band.
2. Place process steps in chronological order along one shared axis. Each step belongs to exactly one lane and remains fully inside it. Use similarly sized cards for similar actions; allow a lane with one step to keep its empty space.
3. Draw lane dividers as quiet hairlines. Route ordinary progression mostly straight; route handoffs through short orthogonal turns with clear arrowheads. Give each handoff a visible exit and entry point on its lane boundary.
4. Reorder steps when their order is flexible to reduce back-and-forth connector crossings. Keep genuine returns and branches explicit; do not disguise a loop as a normal handoff.
5. Limit the figure to five lanes, nine steps, and twelve arrows under the global diagram budget. Split parallel teams or subprocesses into a second view when the crossings obscure ownership.

## Visual encoding

Lane headings carry ownership; node placement carries responsibility; arrows carry sequence and handoff. Use a single accent for the handoff with the greatest cost, risk, or latency, and label that reason in a callout or legend. Do not color every lane differently: lane position and heading already encode owner. Decision outcomes require text and visibly distinct branches.

## Korean text

Use Pretendard for lane names and action labels. Keep action wording short and consistent, for example verb-first steps in Korean. Use mono only for system identifiers, time codes, and ticket references. Keep step labels inside their lane without splitting a compound name at an awkward syllable boundary. Follow [Korean typography](korean-typography.md) for line breaks and mixed script.

## Light, dark, and full variants

Lane order, task positions, and handoff routing remain fixed across light, dark, and full variants. Change only semantic tokens between light and dark; verify the lane dividers still separate areas without dominating the process. A full editorial version can add a concise process title, one summary of the costly handoff, and a source or scope note; no additional lanes are implied by decorative framing.

## Accessibility

Include a title and description that name the process, lane owners, direction of progression, and any consequential handoff. Make lane headers visible in text and keep every step wholly within its owner's lane. Handoff arrows should cross boundaries clearly and include arrowheads; color is supplemental. Provide an ordered textual summary for screen readers and check that connector direction survives grayscale export.

## Verifier gates

Run `scripts/verify-diagram.mjs` for bounds, clipping, overlap, contrast, skin, text, and a11y checks. Run `scripts/verify-type.mjs --type=swimlane` for lane count, step ownership, and handoff geometry. Inspect lane crossings in both wide and portrait exports; verify that any sideways scrolling stays inside the diagram container.

## Anti-patterns

- An unlabeled lane or an action card straddling two owners.
- Too many colored lanes with no corresponding semantic distinction.
- Repeated back-and-forth crossings caused by a poor step order.
- Message-level protocol details that belong in Sequence.
- Handoffs indicated by proximity or color without a directed connector.
- A legend that calls attention to the accent but does not name its meaning.

## Related references

[Sequence](type-sequence.md) · [Flowchart](type-flowchart.md) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [Verifier guide](verifier-guide.md) · [Office export](office-pptx-docx.md) · [Export](export.md)

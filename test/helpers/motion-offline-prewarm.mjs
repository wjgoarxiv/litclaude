// Preloaded by `npm test` (node --test --import). The suite runs offline, and many tests run
// `litclaude-ai install` in a temporary HOME whose motion cache is empty; without this the
// installer's lit-typographic-motion pre-warm would try the network in every one of them. Tests of
// the pre-warm itself set LITCLAUDE_MOTION_PREWARM explicitly and use a local fixture mirror.
process.env.LITCLAUDE_MOTION_PREWARM ??= "0";

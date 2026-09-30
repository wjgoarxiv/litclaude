// Preloaded by `npm test` (node --test --import). The Jev skill hint is opt-in through shell
// variables, and a developer who has turned it on in their own shell would otherwise change every
// hook fixture that copies process.env and could send fixture prompts to a real service. Tests
// of the hint itself pass their own environment explicitly. The same holds for the automatic
// handoff variables, which would turn the Stop hook on in every fixture.
for (const name of Object.keys(process.env)) {
  if (name === "TYPESAFE_API_KEY" || name.startsWith("LITCLAUDE_JEV") || name.startsWith("LITCLAUDE_AUTO_HANDOFF")) delete process.env[name];
}

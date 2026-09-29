// Preloaded by `npm test` (node --test --import). The Jev skill hint is opt-in through shell
// variables, and a developer who has turned it on in their own shell would otherwise change every
// hook fixture that copies process.env and could send fixture prompts to a real service. Tests
// of the hint itself pass their own environment explicitly.
for (const name of Object.keys(process.env)) {
  if (name === "TYPESAFE_API_KEY" || name.startsWith("LITCLAUDE_JEV")) delete process.env[name];
}

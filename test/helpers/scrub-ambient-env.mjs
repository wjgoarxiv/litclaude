// Preloaded by `npm test` (node --test --import). The automatic handoff variables are opt-in
// through the shell, and a developer who has turned them on would otherwise switch the Stop hook
// on in every fixture that copies process.env. SessionStart fixtures that copy process.env run
// against the real product home, where a stale version cache would start a real registry
// request; tests of the update path remove this variable themselves.
for (const name of Object.keys(process.env)) {
  if (name.startsWith("LITCLAUDE_AUTO_HANDOFF")) delete process.env[name];
}
process.env.LITCLAUDE_NO_UPDATE_CHECK ??= "1";

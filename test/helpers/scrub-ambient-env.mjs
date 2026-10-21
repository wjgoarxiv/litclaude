// Preloaded by `npm test` (node --test --import). The automatic handoff variables are opt-in
// through the shell, and a developer who has turned them on would otherwise switch the Stop hook
// on in every fixture that copies process.env. SessionStart fixtures that copy process.env run
// against the real product home, where a stale version cache would start a real registry
// request; tests of the update path remove this variable themselves.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const name of Object.keys(process.env)) {
  if (name.startsWith("LITCLAUDE_AUTO_HANDOFF")) delete process.env[name];
}
process.env.LITCLAUDE_NO_UPDATE_CHECK ??= "1";
// The prompt hook remembers, per session id, which discipline it already activated. Tests reuse
// fixed session ids, so each test process gets its own record directory and a rerun starts clean.
if (!process.env.LITCLAUDE_ACTIVATION_STATE_ROOT) {
  const activationRoot = mkdtempSync(join(tmpdir(), "litclaude-activation-"));
  process.env.LITCLAUDE_ACTIVATION_STATE_ROOT = activationRoot;
  process.on("exit", () => rmSync(activationRoot, { recursive: true, force: true }));
}

# LitClaude Release Checklist

Status: `@litfamily/litclaude@1.0.21` is the current release candidate — README Studio
with a bounded multi-round design interview, GPT-6 model defaults, and the bilingual
family README layout; it also carries the exact canonical frontend corpus plus
Claude-native `autoresearch`, `autoconference`, and `wikify`
workflow-family integration. It byte-pins the frontend library, legal companions,
family source closures, and adapters through independent commitments and package
verification. It also carries G8 UI/UX capability and evidence hardening with
beta Design/Evidence schema authority, bounded lazy hook context, contract-bound
PNG inventory, and fail-closed
provenance, freshness, root, and capability blockers. It also carries restored
litwork, rules-engine, plan-scaffolding, litgoal-drift, structural-search,
comment-checker, and lit-team surfaces with tracked regression tests and
installed tamper coverage, plus packaged evidence-first UI/UX design intelligence, strict Design/Evidence/Review
contracts, bounded PNG and TUI inspection, tier-correct independent review, and
adversarial zero-false-PASS coverage. It also carries the quiet nonblocking npm
update notice with strict cache, concurrency, timestamp, opt-out, and
official-registry boundaries; optionless update preservation for the installed
permission mode and HUD accent; and a shared canonical skill catalog enforced
by source, install, installed-doctor, and Claude-details checks, with
`DOCTOR_FAIL` on missing installed skills, plus the
code-owned schema-3 start-work lifecycle with canonical bounded authority,
single-use resume grants, PreToolUse enforcement, root/subagent lane identity,
bounded Stop continuation receipts, and fail-closed release boundaries, plus guarded litgoal
creation and replacement, durable idempotent autoloop completion, and explicit
visual QA backend ownership, bounded waits, blocked states, and cleanup receipts,
plus root-owned scientific evidence records, DOI/PDF lifecycle receipts, bounded route coverage,
connection-pinned public-source reads, inert-content receipts, and deep secret
redaction, plus bundled
exact-source `lit-handoff` and `lit-scientific-visualization` skills with
Claude-native command routes, exact-bare hook invocation, visible LIT mark and reply-probe
banners, payload integrity checks, and read-only scientific dependency
diagnostics, plus explicit leading start-work activation guards and a structured five-stage interactive
installer with success/failure receipts and adaptive
planning, draft-plan review, and orchestration-safety release on top of the portable
details, public-read, litgoal-status, and evidence-wording release and the auxiliary
skill inventory and advisory-probe release and the full bare
skill-body prompt-hook routing release, planning-only Lit Crucible skill, and read-only `lit-recap`
session recap surface (command, skill, and bounded hook routing
including the Korean `리캡` trigger), the dry-run-first native `/goal`
worker launcher, WSL2 HUD gradient hotfix, Korean AI-slop removal workflow
release, litresearch activation and usability polish track, JS-only
public-source reader runtime, resilient public-source research pass, and
Claude-native goal/workflow/team route hardening. Recap activation stays
side-effect-free, the launcher starts only a separate Claude Code
print/background worker, and the release preserves the Korean polishing
command, strict multi-agent review pipeline, fidelity guardrails, package
hygiene checks, native route gates, and safe start-work handoff behavior.
`package.json` is aligned to `1.0.21`,
`plugins/litclaude/.claude-plugin/plugin.json` is aligned to `1.0.21`, and the
plugin-local MCP server reports `1.0.21`.

This release removes automatic skill review because it never completed a
review in practice. Existing `.litclaude/pending-review.json` and
`.litclaude/skill-loop-state.json` files are inert and may be deleted; no other
state is affected.

The 0.4.0 release added machine-readable output-channel declarations across the
shipped skill corpus and a `PostToolUse` hedge-feedback path. Two isolated A/B
experiments found no measurable behavior change from declaration prose alone,
so the declaration remains guard metadata rather than evidence that prose
instructions by themselves improve generated documents.

This release carries the v0.2.2 Dynamic workflow hardening surfaces:
`/litclaude:lit-loop`, `workflow-check --json`, native `/goal` fallback guidance,
subagent delegation mapping, `start-work-next`, context-pressure resume
guidance, precise post-edit mutated-file detection, and the v0.2.0
`review-work` / `litgoal` workflow parity surfaces, including the litgoal
runtime. It is the next publishable target when explicitly approved.

DO NOT publish a new version of LitClaude, run `npm publish`, push release
tags, or add a remote Claude Code marketplace entry without explicit user
approval.

This release path is for personal install convenience, not advertisement,
public repo promotion, or a public launch campaign.

Historical baseline anchors still covered by this checklist: `0.1.12` was the
publish-recovery baseline, `0.1.13` added LIT command trigger guardrails,
`0.1.14` added command-name HUD display, `0.1.15` introduced HUD brand color
selection, `0.1.16` added rate-limit reset countdown and deep-interview install
guidance, and `0.1.18` covered compact HUD bars and broader brand accent
behavior.

## Required Local Verification

- `npm test`
- `npm run validate:plugin`
- `npm run doctor`
- `npm run check:version`
- `npm run scan:legacy-tokens`
- `npm run pack:payload-guard`
- `npm run qa:tmux`
- `npm run qa:portable`
- `npm run qa:matrix`
- `npm run qa:tamper`
- `npm run qa:behaviors`
- `npm run qa:matrix-negative-control` (must exit non-zero)
- `npm run pack:dry-run`

## Local Checkout Use

Use this track when testing from the current checkout:

1. Run `npm test`.
2. Run `npm run validate:plugin`.
3. Run `npm run qa:tmux`.
4. Run `node bin/litclaude-ai.js workflow-check --json`.
5. Run `node bin/litclaude-ai.js litgoal --help`.
6. Start Claude Code with `claude --plugin-dir ./plugins/litclaude`.

No npm publication is required for this track.

## v0.3.37 Canonical Frontend Corpus and Workflow-Family Gates

Before requesting publication approval, confirm the `design`, `designpowers`,
`perfection`, and `ui-ux-db` frontend roots match their path/size/SHA-256
manifest, exact legal companions, independent commitments, no-extra inventory,
regular non-executable modes, and bounded read budgets. The unchanged
34-source/2,277-record normalized design dataset remains independently verified.

Confirm the complete `autoresearch`, `autoconference`, and `wikify` source
closures match their canonical manifest and independent tree commitments. Their
Claude-native skills and commands must expose the documented mode inventories,
safe leading bare and dollar hook routes, inert near misses, explicit publication
boundaries, and `BLOCKED_MULTI_AGENT_UNAVAILABLE` when an autoconference cannot
use root multi-agent capability.

Run `npm run check:runtime-closures`, `npm run check:skill-resources`,
`npm run validate:plugin`, and `npm run pack:payload-guard`. The payload guard
must compare the verified source snapshot with the temporary tarball by size,
SHA-256, and executable semantics for every canonical corpus file, legal
companion, source-closure file, manifest, and family adapter.

## v0.3.34 Evidence-First UI/UX and Visual QA Gates

Before requesting publication approval, confirm `frontend-ui-ux` ships the
2,277-record offline dataset, pinned source manifest, provenance, license
records, strict Design Contract schema, and bounded retrieval/import tools.
Confirm `visual-qa` ships strict Evidence Manifest and Review Receipt schemas,
bounded PNG and TUI analyzers, and stable capability blocker codes.

Smoke evidence must contain zero independent review receipts. Full and
reference-fidelity evidence must contain exactly two independent receipts from
the declared reviewer capabilities. A blocking P1 finding must invalidate
`PASS`, and the reviewer agents must expose only `Read`, `Grep`, and `Glob`.
TUI captures must reject inputs above 1 MiB or 4,096 lines before emitting
unbounded result arrays.

Confirm the source-checkout-only adversarial replay is labeled honestly while
the installed package can run its packaged visual CLI against caller-owned
captures. Source doctor, isolated install, installed doctor, canonical resource
integrity, scenario replay, and package-payload guards must all pass.

Confirm both interface reference packs ship and stay reachable. `npm run
validate:plugin` must print `SKILL_REFERENCE_ROUTER_PASS` with every shipped
`references/*.md` named in its own `SKILL.md`; a reference that is pinned and
installed but unreachable from its entrypoint is dead payload and blocks the
release. Run `npm run gen:skill-resources` after touching any reference, schema,
or script under either skill, and confirm `npm run check:skill-resources`
reports no drift.

Confirm the visual evidence lane still imports nothing from a sibling skill:
`grep -rn "frontend-ui-ux" plugins/litclaude/skills/visual-qa/` must return no
hits. The lane keeps its own Design Contract schema copy and its own shape
validator on purpose, so a manifest remains checkable from a partial install and
two independent readings of one shape can disagree visibly.

Confirm the blocker vocabulary is complete and honest. `BLOCKED_AUTH_UNAVAILABLE`,
`BLOCKED_RENDERER_UNAVAILABLE`, `BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE`,
`BLOCKED_TEST_ACCOUNT_UNSAFE`, `BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED`,
`BLOCKED_EVIDENCE_STALE`, `BLOCKED_EVIDENCE_FUTURE`, and
`BLOCKED_CLEANUP_INCOMPLETE` must each be emittable by the shipped validator,
not merely documented. A reviewer that returns a non-`PASS` verdict must produce
`FAIL`, never a blocker, and `BLOCKED` must outrank `FAIL` when both apply.

## Real-Surface QA Gates

`npm run qa:real-surface` must pass alongside `npm test`, not instead of it.
It runs three probes that drive the shipped runtime rather than importing a
reimplementation, so they survive a packaged install and outlive any test-tree
cleanup:

- `npm run qa:matrix` must print `NEGATIVE_GATE_MATRIX_PASS` with 17 rows and
  zero `FAIL` or `BLOCKED` rows. The matrix drives the real
  `validate-design-contract` CLI, the real `visual-qa` CLI, the shipped
  installer and doctor, and `tools/check-pack-payload.mjs`. It proves each
  blocker code above by emitting it from the shipped validator: a valid contract
  and evidence bundle pass; a duplicate-key contract, capture bytes changed after
  the manifest, and a same-context self-review fail; missing capture, stale and
  future-dated evidence, unavailable auth, unverified renderer ownership,
  incomplete cleanup, an unavailable reviewer, and an unsafe test account each
  block with their exact code; bounded PNG, TUI, and CJK cases pass; and the
  pack payload guard reports zero forbidden paths.
- `npm run qa:tamper` must print `INSTALLED_TAMPER_REPAIR_PASS`. It installs
  into isolated temp roots, proves the installed doctor passes, produces
  `RESOURCE_HASH_MISMATCH` from every byte tamper, and names the exact deleted
  path through either `RESOURCE_MISSING` or the earlier canonical-catalog
  `DOCTOR_FAIL` used for a missing `SKILL.md` entrypoint. It then proves each
  restoration returns the doctor to `DOCTOR_PASS`.
- `npm run qa:behaviors` must print `REAL_SURFACE_BEHAVIORS_PASS` with all four
  named behaviours reported `REPLACED`: portable install layout, postinstall
  isolated plugin/HUD setup, hook fixtures, and plugin validation. A behaviour
  that cannot be exercised is reported `NOT_REPLACEABLE` with its reason and
  fails the gate; it is never quietly downgraded to a pass.

`npm run qa:matrix-negative-control` is the matrix self-test and **must exit
non-zero**. It feeds one row a deliberately wrong expectation; a zero exit means
the matrix stopped comparing observed outcomes against expectations and every
other green result from it is void.

Every probe redirects `LITCLAUDE_HOME` and `CLAUDE_CONFIG_DIR` into temp roots,
never reads or writes a live profile, and ends with a cleanup receipt whose
state is measured after removal. A leaked temp root fails the gate.

## v0.3.33 Update Notice and Canonical Catalog Gates

Before requesting publication approval, confirm interactive `install`, `update`,
and `doctor` can show only the quiet stderr update notice while CI, JSON,
dry-run, non-TTY, `NO_UPDATE_NOTIFIER`, and `LITCLAUDE_NO_UPDATE_CHECK` remain
authoritative opt-outs. Confirm the cache accepts only stable official-package
metadata, preserves the last trusted result across failed refreshes, throttles
attempts for 24 hours, and fences stale owners from newer reservations.

Confirm source doctor, installation verification, installed doctor, and
`claude plugin details` consume the same exact canonical skill catalog. A
packed isolated install must emit `SKILL_CATALOG_PASS` and `DOCTOR_PASS`; after
one canonical `SKILL.md` is moved aside, doctor must exit nonzero with
`DOCTOR_FAIL` and must not print `DOCTOR_PASS`.

## v0.3.32 Bounded-Authority Start-Work Gates

Before requesting publication approval, confirm schema-3 state remains
monotonic and reconciled, semantic action/root grants are canonicalized,
forbidden release actions fail closed, and only the exact single-use
`/litclaude:start-work resume` UserPromptSubmit route can resume paused work.
Confirm PreToolUse denies unauthorized tools before execution, root/subagent
lane identity gates completion, fenced examples do not count as plan progress,
normal Stop events re-evaluate progress while `stop_hook_active: true` re-entry
never replays a stale block, and an exact invalid no-state resume creates no
`.litclaude` state. Confirm the zero-dependency GitHub Actions path uses neither
lockfile-only npm caching nor a dependency-install step.

## v0.3.31 Litgoal Lifecycle and Visual QA Gates

Before requesting publication approval, confirm duplicate objectives remain
byte-preserving, different active objectives require explicit replacement, and
empty criteria cannot complete. Confirm all-pass autoloops complete and disarm
once with repairable ledger receipts, corrupt counters remain untouched on the
fail-open path, and visual QA uses only an owned project Playwright setup or an
explicit current-session Chrome binding with bounded waits and observed cleanup.

## v0.3.30 LitResearch and Public Reader Gates

Before requesting publication approval, confirm the installed LitResearch body
keeps the journal root-owned, preserves stable claim and scientific lifecycle
receipts, distinguishes access failure from route exhaustion, and documents the
deliberate non-port boundary. Confirm the public-source reader pins every
validated DNS answer and redirect connection, rejects private and mapped
addresses, treats fetched content as inert untrusted data, and redacts source URL
secrets from every receipt and extracted metadata surface.

## v0.3.29 Bundled Skill Gates

Before requesting publication approval, confirm these artifacts from the current
checkout and from an isolated install of the packed tarball:

- `lit-handoff` ships the approved exact four-file canonical corpus plus license
  and provenance metadata, and exact bare `handoff` shows
  the plain `🔥 LIT IGNITED · lit-handoff 🔥` system mark plus the model probe
  `🔥 **LIT IGNITED · lit-handoff** 🔥` while quoted, fenced, mixed, slash, and
  explanatory near misses remain inert.
- `lit-scientific-visualization` ships the approved exact 16-file canonical
  corpus plus license and provenance metadata, and exact bare
  `lit-scientific-visualization` shows
  the plain `🔥 LIT IGNITED · lit-scientific-visualization 🔥` system mark plus the model probe
  `🔥 **LIT IGNITED · lit-scientific-visualization** 🔥` while quoted, fenced,
  mixed, slash, generic-visualization, and explanatory near misses remain inert.
- The scientific adapter reads the full canonical source, resolves packaged
  `scripts/` and `assets/`, and exposes the shipped style presets, figure export
  helpers, and color palettes from the installed package rather than checkout-only
  paths.
- Installed-payload integrity checks compare the immutable source records and
  fail closed on missing or changed bundled files.
- `litclaude-scientific-visualization-doctor.js --json` performs read-only
  dependency checks, never installs Python packages, and reports unsupported
  optional workflows as `DEGRADED` rather than claiming availability.
- `npm pack --dry-run --json` and an isolated consumer install include both
  command routes, both adapted skills, both canonical-source trees, provenance,
  licenses, scripts, assets, and the scientific dependency doctor.

## v0.2.2 Dynamic Workflow Hardening Gates

Before requesting publication approval, confirm these artifacts from the current
checkout:

- `package.json` version is `1.0.21`.
- `plugins/litclaude/.claude-plugin/plugin.json` version is `1.0.21`.
- `plugins/litclaude/bin/litclaude-mcp.js` reports server version `1.0.21`.
- Prompt-hook tests cover bundled `SKILL.md` body injection for bare `lit-crucible`, `litresearch`, `lit research`, `lit-init`, and explicit leading `$start-work`; diagnostic/copy mentions stay inert while leading natural-language `lit start work` stays BLOCKED.
- `lit search` and `lit query` route to `/litclaude:litresearch` without activating on slash mentions, code spans, or non-lit prompts.
- Litresearch web lanes require public API/feed preference, validator-first checks, route traces, prompt-injection quarantine, and honest auth/paywall/private-data stop reasons.
- `node bin/litclaude-ai.js public-read <public-url> --json` exposes the guarded JS runtime reader.
- MCP `tools/list` exposes `public_source_read`, and `tools/call` returns JSON content with `isError` set on safety stops plus machine-readable `contentSafety` flags.
- `plugins/litclaude/commands/lit-loop.md` documents subagent delegation.
- `node bin/litclaude-ai.js workflow-check --json` reports `status: pass`.
- `node bin/litclaude-ai.js workflow-check --json` reports
  `subagentReliability` and `commandHookAgreement` as true.
- `node bin/litclaude-ai.js start-work-next --session-id <claude-session> --json` is available for active
  `.litclaude/boulder.json` continuation state and returns idle when no task remains.
- PostToolUse hook tests cover patch-shaped mutated-file extraction.
- SessionStart hook tests cover context-pressure resume guidance.
- `plugins/litclaude/commands/review-work.md` documents the 5-lane review.
- `plugins/litclaude/commands/lit-plan.md` documents adaptive
  Action/Output/Verification checklists and a DoneClaim without fixed checklist
  padding.
- `plugins/litclaude/commands/review-work.md` distinguishes plan-review mode
  (`PASS | ITERATE | NEEDS-CONTEXT`, no implementation) from the completed-work
  5-lane review.
- `plugins/litclaude/commands/litgoal.md` documents durable goal state.
- `plugins/litclaude/lib/litgoal/` ships the runtime CLI/state modules.
- `node bin/litclaude-ai.js litgoal --help` prints durable state commands.
- `node bin/litclaude-ai.js --dry-run install --permission-mode balanced` reports
  the balanced preference while preserving dangerous-shell deny boundaries.
- `npm pack --dry-run --json` includes runtime payloads and excludes local
  `.litclaude/`, `.omc/`, and `evidence/` state.
- `.litclaude/lit-loop/evidence/v020-red-contracts.txt` or equivalent RED evidence
  exists for the workflow parity contracts before GREEN evidence.

## Fresh Machine NPM Install Use

Use this track after an approved npm package version exists:

1. Run `npm exec --yes --package @litfamily/litclaude -- litclaude install`.
2. Run `npm exec --yes --package @litfamily/litclaude -- litclaude doctor`.
3. Start Claude Code with the normal `claude` command.

The installer should register `litclaude@litclaude-ai` in Claude Code's user
plugin registry, `settings.json` `enabledPlugins`, and the LitClaude-managed
local marketplace metadata needed by `claude plugin details`. Do not ask users
to type a generated command that shells out to `npm exec --yes --package @litfamily/litclaude -- litclaude path` for
normal npm installs.

Run fresh-machine QA from a fresh directory, not from this repository checkout.
Inside the same-name source checkout, older published builds such as
`npx --yes litclaude-ai@0.1.11 install` could resolve the local package and
fail with `sh: litclaude-ai: command not found`. This checkout intentionally
does not track a `node_modules/.bin` shim. Use `cd /tmp` for the fresh directory
scenario, or use the explicit fresh-prefix form:

```bash
npm exec --prefix "$(mktemp -d)" --yes --package @litfamily/litclaude -- litclaude install
```

## Quiet Public NPM Package Release Or Update

Use this track only when the user explicitly approves making a new package
version installable through `npm`, `npx`, and `bunx`.

1. Confirm the target package name and version with the user.
2. Review `README.md`, `README_ko-KR.md`, `docs/migration.md`, and
   `docs/workflow-compatibility-audit.md` for neutral release wording.
3. Run `npm whoami` and confirm the intended npm account.
4. Re-run the full local verification set from a clean checkout:
   - `npm test`
   - `npm run validate:plugin`
   - `npm run doctor`
   - `npm run qa:tmux`
   - `npm run qa:portable`
   - `npm run pack:dry-run`
5. Inspect `npm pack --dry-run --json` and confirm package contents.
6. Ask for explicit user approval to publish.
7. Only after approval, perform the selected publication path in a separate,
   auditable release step.

### Two READMEs: GitHub page and npm page

`README.md` and `README_ko-KR.md` are the GitHub pages: the full guide, with every image
loaded by a relative path. The npm package page is a shorter card kept in `README_npm.md`
and `README_npm_ko-KR.md`, whose images are jsDelivr URLs pinned to the package version.
`tools/readme-for-npm.mjs` swaps the card in: `apply` backs up the GitHub pages under the
git-ignored `tmp/readme-for-npm/` and copies the npm files over them, `restore` puts the
originals back byte for byte, and `check` (`npm run check:npm-readme`) asserts the card's
invariants: pins at the package version, no relative targets, the GitHub full-guide link,
the same name and tagline, and size limits. The `README_npm*` sources never ship as extra
files.

`prepack` runs `apply` and `postpack` runs `restore`, so a plain `npm pack` produces a
tarball whose `README.md` is the npm card and leaves the working tree unchanged. That is
not enough for a publish: `npm publish` re-reads `README.md` from the working tree after
postpack, and a flow run with `--ignore-scripts` skips both hooks. The publish step must
therefore wrap the command explicitly (apply and restore nest, so the hooks inside
`npm publish` do not undo the outer apply):

```bash
npm run check:npm-readme
node tools/readme-for-npm.mjs apply
npm publish --access public
node tools/readme-for-npm.mjs restore
git status --short   # must be empty
```

If a run is interrupted while applied, `node tools/readme-for-npm.mjs restore` recovers
the GitHub pages.

For the scoped `@litfamily/litclaude` candidate, `publishConfig.access` is `public`.
Only after explicit release approval, the scoped package command is `npm publish --access public`.
Publication remains a separate, explicitly approved manual action. The scope and
version in this checkout are not evidence of registry availability.

## Accidental Publish Rollback

If the wrong package or version is published, stop and report the incident
before further mutation. Depending on npm policy and timing, choose one audited
rollback action with user approval:

1. `npm deprecate <package>@<version> "<message>"`
2. `npm unpublish <package>@<version>` only when allowed and explicitly approved
3. Publish a corrected patch version after verification

## Marketplace Boundary

Local checkout testing still uses `claude --plugin-dir ./plugins/litclaude`.
NPM installs should use the global Claude user plugin registry and normal
`claude` launches. A root Claude marketplace file is intentionally not shipped
because users may already have an OMC/omc marketplace or plugin installed. The
npm installer creates a LitClaude-managed local marketplace under
`LITCLAUDE_HOME` and registers only `litclaude-ai` in Claude's user marketplace
metadata so skills and hooks appear in `claude plugin details`. Do not add a
remote marketplace entry without explicit user approval. If user-level OMC
creates `.omc/` state during validation, keep it ignored and confirm it is
absent from the package dry-run.

## Rollback

If a local test load causes problems, stop Claude Code, restart without
`claude --plugin-dir ./plugins/litclaude`, and run `/reload-plugins` in any
remaining session that should drop the local plugin metadata.

If an npm-installed LitClaude copy causes problems, run:

```bash
npm exec --yes --package @litfamily/litclaude -- litclaude uninstall
```

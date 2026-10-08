# Changelog

## 1.0.20 - 2026-10-08

- `lit-pptx` now works out who will read a deck and how, then picks one of eight looks before it builds a slide. `ledger` is a dense, number-led review for reading at a desk, `signal` a short pitch with one hot accent, `atlas` a deck carried by pictures, `chalk` a lesson with numbered steps, `paper` a research talk with numbered figures and citations, `gazette` a Korean briefing page, `studio` an editorial grid, and `night` a dark style for a keynote screen. Each look brings its own colours, title positions and page layouts. The older AZURE and plain 4:3 templates still work when you ask for them by name.
- `lit-docx` now picks one of six looks before it writes a document. A short briefing for someone who has to decide gets Brief, a procedure gets Manual, and Report, Proposal, Memo and Journal cover the rest. All six keep a quiet, print-ready page. A journal manuscript can still use the Elsevier, ACS, IEEE, Nature or `korean-generic` profile instead.
- Both skills say in the reply which look they chose, why it fits, and two others that would also suit, so a wrong first guess takes one sentence to change.
- New checks read every slide and every page of the finished file. On a deck they look for empty areas and for a column much shorter than the one beside it. In a document they look for a heading left at the foot of a column or page, a short list split across two pages, a column that stops well short of its neighbour, and last-page columns of uneven length. The build fails until the layout is fixed.

## 1.0.19 - 2026-10-01

- Automatic handoff now finds the handoff it asked for after compaction even when the model formats the marker line, for example as a bullet, in backticks or in bold. A handoff from another session is still ignored.
- An upgrade no longer stops with an ownership conflict when a bundled Python script left a `__pycache__` folder in the installed plugin.

## 1.0.18 - 2026-09-30

- `gpt-6.1-sol` is now the recommended coding-lead alternative, since OpenAI lists `gpt-6-sol` as the previous generation. `gpt-6-sol` still works for anyone who already chose it. Claude Code picks the model and LitClaude sets no OpenAI route of its own, so this shows only in the model notes in the README (English and Korean) and in `docs/agents.md`.

## 1.0.17 - 2026-09-30

- Add automatic handoff, off until you turn it on. `lit-handoff auto on <percent>` (or `LITCLAUDE_AUTO_HANDOFF=1` with `LITCLAUDE_AUTO_HANDOFF_PERCENT`) picks the context percent, from 1 to 99; LitClaude has no built-in number. `lit-handoff auto off` and `lit-handoff auto status` turn it off and show its state, and `litclaude doctor` and the status line (`handoff@60%`) show when it is on.
- When the percent is reached, the Stop hook asks Claude once to write the handoff, and Claude writes the file. Claude Code gives a plugin no way to start compaction, so Claude ends with "Handoff saved. Run /compact now." and you run `/compact`, or you let Claude Code compact by itself. After the compaction, the session start hook reads the handoff back once.
- The README no longer shows the A/B comparison; one run per side was too little to support its verdicts.
- The GitHub pages (English and Korean) now show terminal pictures of what the installer, the session start, the `lit` activation, the status line and `litclaude doctor` print, and a new motion film set in Pretendard, with a Korean version on the Korean page.

## 1.0.16 - 2026-09-30

- The GitHub page (English and Korean) now has a short film about 25 seconds long under "Watch it in motion", and the README was rewritten again in plainer language.
- The GitHub page shows what the optional Jev skill hint looks like on screen when it is on, off or unavailable. Jev stays off unless you turn it on.

## 1.0.15 - 2026-09-29

- `litclaude install` and updates no longer fail with an ownership conflict while Claude Code is using the plugin. Claude Code marks the version it has in use with an empty `.in_use` folder inside the version folder, and LitClaude now leaves that folder out of its ownership check. A file with that name still counts as a change LitClaude did not make.
- README (English and Korean) and the npm install card: rewritten in plainer language, with the reason before the switches. The npm page stays a short install card that links to the full guide on GitHub.

## 1.0.14 - 2026-09-29

- A global `npm install -g` now actually pre-warms the motion runtime. The runtime's `npm ci` inherited the global-install settings that npm gives the postinstall step, and npm refused it; those settings are now dropped for that call and for the office runtime's first-use install.
- HUD: the Jev skill hint now sits right after the model name as `✦Jev` (`O5.5 ✦Jev → lit-humanizer` on a hinted turn, `O5.5 ✦Jev ⚠ key` without a key) instead of at the end of the line, and no longer shows the hint latency. Nothing changes while the hint is off.
- Jev skill hint: when the project's `.litclaude` or `.litclaude/jev` folder is a symlink, the hint no longer reads or writes through it; it stays silent and sends no request.
- Credential redaction no longer treats ordinary prose such as "basic understanding" as a `Basic` credential. A real `Basic` authorization value (base64) is still redacted.
- README (English and Korean): the install section now says that `litclaude install`, and the postinstall step of a global `npm install -g`, download the motion runtime's packages and fonts, and how to skip that.
- README (English and Korean): rewritten to read like a person explaining the tool, with the reason before the mechanism. The GitHub page keeps the full guide, the skills gallery and the A/B results, and now loads its images from the repository, so they show before a release is published. The npm page is a shorter install-first card (`README_npm.md`, `README_npm_ko-KR.md`) that links to the GitHub guide; `prepack` swaps it in and `postpack` puts the GitHub page back.

## 1.0.13 - 2026-09-28

- Add an optional Jev skill hint, off by default. Turn it on by setting `LITCLAUDE_JEV=1` and your own `TYPESAFE_API_KEY` in the environment that starts Claude Code. For a prompt that no route or skill name already covers, the prompt hook asks Jev, TypeSafe's hosted model, which LitClaude skill fits and adds one advisory line naming it; Claude still decides whether to load that skill.
- While it is on, each eligible prompt is sent to TypeSafe (typesafe.ai), cut to 2,000 characters, with home paths, e-mail addresses and token-shaped strings redacted, along with the LitClaude skill names and descriptions. Other text in the prompt, such as a hostname or a customer name, is sent as written. Slash commands, routed prompts and prompts that name a skill are never sent, and no files, tool output or history are sent. Requests are billed to your key, so use a key kept for this feature with a low spend limit.
- A request waits at most 1.5 seconds and the hint stops after 200 requests per session. On any failure the turn continues as before, with one short note the first time in a session.
- The first prompt of each session with the hint on shows one `✦ Jev skill hint ON ✦` line. The HUD status line then ends with `Jev ✓`, adds the skill and latency on a hinted turn, and shows `Jev ⚠ key missing` without a key. `litclaude doctor` reports `Jev skill hint: off`, `on`, or `flag on but TYPESAFE_API_KEY missing`. Unset `LITCLAUDE_JEV` to turn the hint off.

## 1.0.12 - 2026-09-28

- lit-pptx: the confidential stamp falls back to the bundled font.
- The repository no longer carries maintainer-only release tooling.

## 1.0.11 - 2026-09-28

- Replace `lit-korean` with the always-on `lit-humanizer`. It ships English and Korean rewrite references and checks changed text before it is written: high-confidence drafting residue is blocked, warnings stay advisory, and supported Office and PDF files are checked again after they are created.
- Route `/lit-korean` and its older aliases to `lit-humanizer`. An unmodified old copy is removed; a modified one is kept with its provenance and a warning.
- Research, explainer and interface-writing guidance keeps detailed evidence in internal records. A risk that matters to the reader appears once in the reply.
- Add `lit-pptx` and `lit-docx`. A bare `lit` with slide or report wording now produces a `.pptx` (AZURE-PRO with embedded Pretendard by default, four templates, native editable charts, KPI cards, template learning) or a `.docx` (a Korean profile for Korean text, plain or journal profiles otherwise, DOCX/PDF to Markdown, in-place edits). Each file passes a QA gate with rendered pages.
- The office skills install their pinned Node and Python dependencies into LitClaude's own cache on first use, and `litclaude doctor` reports whether they are ready. The runtime pins sharp 0.35.4 and image-size 2.0.4.
- Decks and documents can take their numbers from a small CSV or JSON file named in the frontmatter (`data:`). Totals and shares come from formulas, and declared checks must hold before a file is built.
- The deck and document gates fail half-empty slides, table-only decks, shapes cut off at the canvas edge, empty boxes, `[blank]` placeholders and frontmatter printed as text. Under a bare `lit`, a missing fact becomes a labelled example instead of a question. English decks number captions "Figure N." and "Table N.".
- Add `lit-diagram-drawer` for conceptual diagrams in slides and documents: 61 layout types in light, dark and full variants, draw.io, Mermaid and Excalidraw importers, and checks for geometry, labels, routes, arrowheads, contrast, accessibility and brief coverage. Start it with `/litclaude:lit-diagram-drawer`, a leading `lit-diagram-drawer` or `$lit-diagram-drawer`. PNG and SVG export uses a user-installed agent-browser 0.38.1 or newer and never installs software.
- `frontend-ui-ux` now measures the page it builds. The interface probe checks it at 320, 390, 768 and 1440 px, in dark mode, with reduced motion and at 200% zoom, and saves a screenshot per viewport with its findings. A craft floor and a register of common generated-interface faults load with the skill.
- In lit-loop, litwork, litgoal, native workflow and frontend-ui-ux turns, the Stop hook holds a turn that edited interface files until a clean interface probe run follows the last edit (twice at most, then it warns).
- `frontend-ui-ux` keeps the working content first on screens people work in; the pixel-art profile is only a small accent there. The skill also adds a motion guide for interface animation.
- `browser-drive` accepts `agent-browser` 0.34.0 and newer and labels versions above the verified range `beyond-verified`.
- Add `lit-typographic-motion`, which directs a short film from one request. It starts from a checked treatment, then takes the stage path (a page the model writes, captured frame by frame on a virtual clock) or the type path for films made of words, in 16:9 or 9:16.
- Each film exports a 1080p60 MP4, a preview under 3 MB, a poster and a reduced-motion still. A flash audit withholds every export when it fails. A generated sound bed is muxed by default, and a supplied track is always muxed.
- The Stop hook keeps a film turn open until look rounds on its stills are recorded. `litclaude-ai motion-runtime install` pre-warms the pinned dependencies and fonts (the installer tries it too), `status` reports them, and a render never installs anything. The type engine is adapted from mexicat/pdoom-video (MIT), commit `ca251e3`.
- Both README pages open on the robot motion cover.
- Both README pages show A/B results for ten tasks, with the maintainer's final verdict next to a blind judge's, and a skill table with a snapshot, the route and one line on what each skill produces.
- Research requests that end with `lit`, Korean ones included, now reach `litresearch` instead of `lit-loop`.
- Replies use the prompt's language even though the activation context is English.
- `litresearch` follows a source's pointer to the detail before it reports a gap.
- When the session's working directory has been deleted, the start-work check runs at the project root instead of denying every tool.

## 1.0.10

- Show the static robot family cover image directly under the motion hero in both README pages instead of hiding it behind a "View the static cover" / "정지 표지 보기" link, and remove the now-duplicate copy that lived further down near the LITFAMILY/Links section.

## 1.0.9

- Add README Studio with visual decoration patterns, cover depth, and a bounded multi-round design interview.
- Move new LitClaude OpenAI planning, review, lead, and helper routes to the GPT-6 family defaults.
- Align the English and Korean README pages to the family layout and pin npm-served asset URLs to this package version.
- Compare the ignition mark after stripping terminal color so the activation test checks visible text across styles.

## 1.0.8

- Paint the activation logo and its `🔥 LIT IGNITED · <discipline> 🔥` label with a bold truecolor gradient that runs from ignition orange through the HUD hot pink to electric cyan. The hook sets the colour depth itself because its output is always piped, so terminal detection cannot drop it to monochrome; `NO_COLOR` still prints plain text, and the reply line the model is asked to print stays free of escape codes.
- Show a bold, ignition-orange `🔥 LIT IGNITED · <discipline> 🔥` mark in the HUD status line whenever the prompt hook activates a LitClaude discipline. The prompt hook records the selected discipline per session under `litclaude-hud/` in the per-user temp directory (`LITCLAUDE_HUD_STATE_ROOT` overrides it; the repository state root and home directory stay untouched), and the HUD reads that record back, so the mark reflects the hook's decision rather than model output. Turns without an activation clear the record and the mark disappears.
- Ask model replies to start with `🔥 **LIT IGNITED · <discipline>** 🔥`, while hook messages and the HUD render the same activation mark without Markdown.

## 1.0.7

- Add the animated cover to both README pages, with a static cover for reduced-motion settings.
- Remove automatic skill review. It never completed a review in practice; existing .litclaude/pending-review.json and .litclaude/skill-loop-state.json files are inert and may be deleted. No other state is affected.
- Refuse npm publish when the test suite fails.
- Anchor project state at the repository root so sessions started in subdirectories no longer create another .litclaude/ directory. Existing directories stay where they are.

## 1.0.6

- Start UserPromptSubmit and SessionStart hook marks on their own line so Claude Code's host prefix does not misalign the artwork.

## 1.0.5

- Ignore host-generated task notifications and system reminders during prompt activation while preserving routes for genuine user text.
- Make scaffold-plan's paired-write cleanup tolerate transient sibling-draft churn without reporting refusal after a plan was written, while retaining replacement detection.

## 1.0.4

- Keep managing a native `litclaude@litclaude-ai` registration after a host rewrite
  of `installed_plugins.json` drops `installedBy` and `enabled`. Such installs of
  0.4.6 stopped with `INSTALL_OWNERSHIP_CONFLICT: native registration`; a different
  `installedBy`, extra keys, other scopes and unowned paths are still refused.

## 1.0.3

- Restore the original colored HUD as the default: with `LITCLAUDE_HUD_APPEARANCE`
  unset, model, context, usage, reset and Git text carry the accent again, usage
  percentages are colored by level, and the brand uses the neon gradient.
  `light` and `unknown` keep the default-foreground text introduced earlier.

## 1.0.2

- Accept a pristine install of the registry-published `litclaude-ai@0.4.6` as a
  migration baseline. 1.0.1 pinned digests from a locally rebuilt 0.4.6, so every
  published 0.4.6 installation stopped with `INSTALL_OWNERSHIP_CONFLICT`.
- Add a regression test that installs the published 0.4.6 tarball and upgrades it.

## 1.0.1

- Ship the landing cover, wordmark, clay mark and badges in the package and
  serve the bilingual README images from jsDelivr so they render on npmjs.
- Tighten the README safety notes.

## 1.0.0

- Prepare `@litfamily/litclaude` as the scoped major-version package, retaining
  the `litclaude` and `litclaude-ai` executables and native Claude plugin identities.
- Carry forward verified published-package migration, modified/foreign payload
  refusal, newer-active installation protection, and guarded update rollback.
- Align package, plugin, MCP, current documentation and release assertions;
  preserve historical migration baselines and unrelated example/fixture versions.
- Integrate the Ignition cover built from explicit vector geometry and outlined
  type, with a matching WebP fallback. Keep installation commands in editable
  bilingual README text.

### Included preparation

- Refuse older installer commands against newer active plugin, marketplace,
  current-pointer, or managed HUD state before writes; retain inactive caches.

- Prepare the scoped `@litfamily/litclaude` npm package with the existing
  executable aliases and native marketplace/cache identifiers. Scoped update
  checks reject legacy package metadata and retain native rollback paths.
- Refuse installer replacement or removal of modified or foreign payloads, preserve
  user HUD changes, and allow receipt-less migration only from the verified baseline.
- Add the native repository marketplace, explicit package-name migration notes,
  contribution/support/security/conduct guidance, issue and pull request templates,
  and source-grounded privacy documentation. This preparation retained the then-current release version.

- Add the approved Ignition cover as repository artwork and reorganize the bilingual
  README around installation, first use, routes and safety,
  with operational reference kept in expandable sections. Archive obsolete cover
  sources outside the product root; exclude repository covers and the release
  checklist from npm payloads.
- Apply the installer no-escape policy to progress, frame colors, HUD previews,
  and prompts, including empty CI/NO_COLOR values and dumb/non-UTF-8 terminals.
  Preserve explicit choices and static progress when terminal styling is disabled.
- Keep SessionStart ignition in the authoritative rules project root when cwd
  changes between nested directories and the root. Preserve invalid/symlinked
  cwd and state rejection without creating nested fallback receipts.
- Initially replace the CLI and README wordmark with the historical round6 LIT banner and
  product lockup, with ember-gradient letters, maroon block shadows, 256-color
  fallback, and plain text for non-UTF-8 or dumb terminals. Keep the install-plan
  frame and add `--help`. Respect NO_COLOR, piped output, JSON, and CI.
- Render a standard mark once per session through the SessionStart system message
  and an ignition mark with the discipline on prompt activation. Preserve the session
  receipt across resume and compaction. Model replies begin with exactly one
  `🔥 **LIT IGNITED · <discipline>** 🔥` probe line; the model does not redraw the harness logo.
  Refresh skill-resource pins and verify runtime closures before the major version transition.

- Rename skills: `hyperplan` → `lit-crucible`, `init-deep` → `lit-init`,
  `git-master` → `lit-commit`, `teammode` → `lit-team`, `remove-ai-slops` →
  `lit-burnoff`, `ai-slop-remover` → `lit-burnoff-file`,
  `korean-ai-slop-remover` → `lit-korean`, and `programming` → `lit-code`.
  Rename agents: `prometheus-planner` → `lit-planner`, `boulder-executor` →
  `lit-executor`, and `oracle-verifier` → `lit-verifier`. Remove the
  `dynamic-workflow` command; its typed-word alias routes to `lit-loop`.
  Keep old typed names and the two existing renamed slash commands as redirects
  for exactly one release, with one deprecation note; remove aliases in the next
  minor. Install/update replacement removes old skill directories from the active
  managed payload. Refresh resource pins and use a neutral debugging-agent example.
  Preserve saved verifier receipts without allowing alias names to count as
  independent reviewers. Keep live sibling freshness probes opt-in; local gates still check the committed
  parity manifest. The preparation retained the then-current package and plugin versions.

## 0.4.6 - 2026-09-03 — reader-facing communication boundary

- Add request-scoped `reader`, `technical`, and `audit` communication modes across
  Claude-native skills, commands, agents, hook context, child returns, and parent
  synthesis. Reader mode is the default and keeps result, material risk, required
  action, and explicitly requested detail while suppressing routine operational noise.
- Preserve detailed execution-plane records, evidence, ledgers, checkpoints, review
  packets, handoffs, and protected installer, doctor, status, debug, JSON, and audit
  outputs. Add contract and real-surface coverage without weakening verification.
- Keep enforcement honest: Claude Code exposes no supported final-response or
  child-result interceptor, so generated prose follows the native prompt contract
  advisory path rather than a generic scrubber or streamed-output rewrite.

## 0.4.5 - 2026-09-02 — vendored-corpus companions and Skill-id namespace

- Record Claude Code plugin-namespaced Skill tool ids (`plugin:skill`) as the
  unprefixed skill id so skill-loop consultations match `SKILL_ID`.
- Count vendor license, provenance, and NOTICE companions in family
  payload-parity so packed skills keep the material they name after the
  sibling vendor-layout moves.
- This is a local release candidate only; no publish, tag, or push was performed.

## 0.4.4 - 2026-09-02 — inode-reuse hardening and Linux rotation safety

- Bind regular-file reads and state transitions to ctime/birthtime-aware identities,
  and quarantine/content-check destructive cleanup across owner locks, rule/session/team
  state, skill-loop records, knowledge, observer, review, and scaffold paths. Add
  deterministic inode-reuse regression coverage for the affected readers and cleanup.
- Make directory pins Linux-safe: directory identity excludes mutable child-driven ctime
  and retained descriptors are compared with final pathname samples. Quarantine short-lived
  scaffold locks so a legitimate next owner can rotate in without being mistaken for residue.
- Keep browser-drive teardown fail-closed around process-group reuse while accepting
  already-gone or non-owned groups, and add regression coverage for concurrent observer
  first-use writers and normal rotation. Regenerate canonical resource hashes for the
  changed runtime assets so installer integrity checks cover the hardening.
- During convergence, three Linux-only false-denial cases were captured and resolved:
  directory ctime churn, process-group ID reuse, and lock rotation. Regular files pin
  ctime/birthtime; directories do not, because child creation legitimately changes
  directory ctime. This is a local release candidate only; no publish, tag, or push
  was performed.

## 0.4.3 - 2026-08-31 — packed-payload integrity and channel routing

- Add packed-payload substance, cross-product parity, and referenced-path checks so
  installed skills cannot silently lose the material they reference.
- Route post-compact rule re-injection through the channel Claude Code actually reads,
  so compacted sessions receive the intended rules again.
- Refresh the canonical legal attribution metadata without changing the four upstream
  attributions it records. This is a local release candidate only; no publish, tag, or
  push was performed.

## 0.4.2 - 2026-08-30 — coordinated major-update-v2 patch release

- Require `lit-plan` to persist `plans/<slug>.md` with executable checkbox tasks
  before a planning turn ends; approval gates execution after the plan exists.
- Add the shared installer frame, `--yes` path, and explicit host-owned model
  selection notice while preserving Claude's host routing authority.
- Remove the retired handoff name from model-facing guidance and keep the
  native handoff route available without a legacy user-skill path.
- This is a local release candidate only; no publish, tag, or push was performed.

## 0.4.1 - 2026-08-29 — approval-gated skill learning loop

- Observe validated skill consultations, bounded user corrections, tool
  iteration signals, and coverage gaps without persisting raw transcripts. A
  detached Stop review may queue at most three schema-valid pending proposals;
  it never applies them.
- Add explicit list, apply, reject, rollback, and curator commands. Apply is the
  only approval transition and may mutate only project
  `.claude/skills/<name>/SKILL.md` packages marked
  `litclaudeAgentGenerated: "true"`; bundled and unmarked user skills remain
  protected.
- Record exact before/after snapshots in the project-local decision ledger and
  content-addressed blob store. Rollback uses ownership, identity, and byte
  checks and fails closed on conflicts.
- Add a deterministic SessionStart curator for projects that already have
  skill-loop usage state. The default seven-day/two-hour schedule marks
  eligible skills stale after 30 days and archives them after 90 days only
  after backup; deletion, consolidation, and automatic apply remain disabled.
- Pin the complete skill-loop runtime and observer resources in the canonical
  manifest, keep local `.litclaude` state out of the package, and reject
  unpinned bundled-skill payload additions.

## 0.4.0 - 2026-08-27 — output-channel enforcement

- Add a standalone `#contract.output_channels` declaration to every shipped
  skill contract, with the byte-budgeted `frontend-ui-ux` and `visual-qa`
  declarations kept in their lazy `references/complete-contract.md` files.
- Enumerate the complete skill corpus in the documentation gate and enforce the
  five allowed artifact genres and their exact limitations-channel mappings.
- Add Claude-native `PostToolUse` hedge feedback. Claude Code can return
  model-visible `additionalContext` after a successful write, so the guard
  resolves the active skill's declared genre and inspects only bounded explicit
  write content from the host event. It never opens an artifact path, and asks
  for a revision when a client deliverable leaks absent-evidence or limitation
  prose.
- Record the validated scope honestly: two isolated A/B experiments found no
  measurable behavior change from the contract prose alone. The declaration is
  machine-readable metadata consumed by the guard; this release does not claim
  that the prose itself makes the model write cleaner documents.

## 0.3.48 - 2026-08-26 — version alignment

- Align the package, plugin manifest, MCP server, README surfaces, release
  checklist, and exact-version fixtures at `0.3.48` for G20 slice 19.

## 0.3.47 - 2026-08-23 — frontend, browser, and observer surfaces

- Add the frontend/UI/UX and Visual QA `litfamily.design-contract/v1beta2`
  surface with optional bounded `taste` dials for `variance`, `motion`, and
  `density`. Keep v1beta1 as an explicit compatibility input, and reject
  unknown fields or invalid taste values.
- Add the `browser-drive` capability probe. It reports a verified driver or a
  named blocked state, never substitutes a fetch, and never installs a driver.
- Add `skill-observer` proposal storage under
  `.litclaude/skill-observer/observations.jsonl`. Records remain bounded and
  carry `applied: false`.
- Harden secret redaction, path ownership, timeout cleanup, and fail-closed
  persistence checks across the observer and browser probe surfaces.
- Extend canonical resource, schema, focused test, and package coverage for
  the shipped assets.

## 0.3.46 - 2026-08-16 — ready-to-paste native `/goal` guidance

- Add structured `READY_TO_PASTE` guidance for unavailable native goal binding,
  including one bounded `/goal` condition that the user can submit manually in
  the current Claude Code session.
- Keep automatic slash-command submission unavailable and redact shell-like
  objective fragments before they reach hook context.

## 0.3.45 - 2026-08-15 — documentation surface refresh

- Simplify the English and Korean README guides and pin their packaged cover
  links to the exact release version.
- Keep the release, manifest, installer, and MCP version checks aligned at
  `0.3.45`.

## 0.3.44 - 2026-08-14 — provider-free activation speed guards

- Add provider-free activation and cache measurement contracts with deterministic
  pack and portable-surface coverage.
- Serialize the aggregate test runner to avoid source-root pack/portable races.

## 0.3.43 - 2026-08-12 — advisory evidence review guidance

- Add advisory evidence review guidance to the `frontend-ui-ux` skill.
- Add package resource and documentation coverage for the new guidance.

## 0.3.42 - 2026-08-11 — reviewed local Wikify knowledge

- Add LitClaude-native Wikify capture, save, review, query, and configuration
  flows through the CLI, command route, prompt hook, and MCP tools.
- Store bounded structured claims in the project-local knowledge ledger. New
  claims remain `review-needed`, and queries inject only accepted relevant
  claims with local provenance, bounded output, and fail-closed persistence.

## 0.3.41 - 2026-08-09 — foreground automatic updates

- Add a default-on SessionStart update barrier that installs an exact stable
  package candidate only after a cached check, runs doctor/version verification,
  records a transaction receipt, and fails closed when rollback is unknown.
- Keep the detached notifier cache-only, with sanitized npm environment,
  bounded locking, recursion/opt-out guards, and the documented
  `--no-auto-update` escape hatch.

## 0.3.39 - 2026-08-04 — executable plan validation

- Require planner handoff to use a generated plan that passes
  `PLAN_STRUCTURE_PASS`, and make start-work reject fresh initialization or a
  stale replay when the plan has zero executable top-level checkbox tasks.
  Rejection occurs before durable state creation or replay ledger
  reconciliation, with generated-plan-to-start-work contract coverage.

## 0.3.38 - 2026-08-02 — figure output safety

- `lit-scientific-visualization` now requires an explicit, user-approved output
  path and forbids overwriting a figure the task did not create. The immutable
  vendor examples it defers to save to fixed names (`figure1.pdf`, `figure1.png`,
  `multi_panel.pdf`), and figures are written through Bash rather than the file
  tools, so the harness read-before-write guard never sees them — copying an
  example literally could clobber a file in the user's working directory.

## Unreleased — output styles enrollment and `lit-comprehend` explainer artifacts

- Add output styles enrollment to the installer: a `chooseOutputStyle` prompt
  (mirroring `chooseHudAccent`) lets users pick `off`, `asd-ste100`,
  `asd-ste100-ko`, `eli5`, or `eli5-ko` on every install run, defaulted from
  the prior choice. The installer writes `settings.outputStyle` clobber-safely —
  skipping the write and printing a note when the field was changed outside
  LitClaude — and tracks `outputStyleChoice`/`outputStyleWrittenName` under
  the `litclaude` settings key for idempotent reinstall defaulting.

- Add the `lit-comprehend` skill, the `/litclaude:lit-comprehend` command, and the
  `lit-comprehend` / `comprehend` / `lit comprehend` / `$lit-comprehend` /
  `$comprehend` hook routes. The trigger surface is deliberately wider than the
  skill id — bare `comprehend` is what users type, the same reasoning that keeps
  bare `recap` routed to `lit-recap`.
- Gate execution instead of narrowing activation: being invoked is not permission
  to build. When the invocation names the file or commit set directly (a path, a
  git range, a branch, a PR) the skill proceeds; otherwise it proposes the scope,
  its countable size, what it excluded, and the rough cost, offers a one-sentence
  answer when the request deserves one, and waits. The proposal is derived from
  `git status` / `git diff --stat` / durable state, never by reading the tree — a
  gate that costs as much as the thing it gates is not a gate.
- Fix a routing defect found while wiring this: `lit comprehend` and
  `litwork comprehend` matched the bare `lit` / `litwork` tokens first and
  activated lit-loop, injecting the wrong skill body. The two-token phrase now
  resolves ahead of the leading-bare check, with a regression test.
- Where `lit-recap` answers *what happened*, `lit-comprehend` builds the artifact
  a reader needs to reason about the work: it anchors on what they already knew
  and explains only the delta, walks the change in conceptual rather than file
  order, ships an interactive micro-world, discloses what is **not** verified,
  and closes with a quiz framed as a speed regulator rather than a grade.
- Bundle `assets/explainer-scaffold.html` so the CSS, diagram components, and
  quiz engine are written once instead of per invocation, plus
  `references/artifact-template.md` and `references/micro-worlds.md`.
- Add `scripts/verify-explainer.mjs` as a real verification gate. It fails a
  phantom code quote, a quote attributed to a missing file, an external resource
  reference, a missing canonical section, an artifact written inside the
  worktree, a quiz option without feedback or with a positional tell, collapsed
  code blocks, and ASCII-art diagrams — the defect classes that leave a reader
  confidently wrong rather than merely uninformed.
- Pin the whole `skills/lit-comprehend` tree in the canonical resource manifest so
  the installer, install-time integrity gate, `doctor`, and package payload
  guard all cover the bundled scaffold and verifier.

## 0.3.37 - 2026-07-29 — canonical frontend corpus and workflow families

- Ship the exact canonical frontend library with byte-pinned manifests, legal
  companions, independent commitments, bounded reads, and source-to-tar payload
  verification while retaining the independent normalized design dataset.
- Add Claude-native `autoresearch`, `autoconference`, and `wikify` skills and
  command routes for their supported modes, including an explicit blocked state
  when root multi-agent capability is unavailable.
- Bind the three workflow-family adapters and their complete source closures to
  canonical manifests, immutable commitments, installed integrity checks, and
  package-payload verification.

## 0.3.36 - 2026-07-28 — G8 UI/UX capability and evidence hardening

- Promote the beta Design and Evidence schemas to runtime authority while
  retaining alpha inputs as migration-only.
- Bound natural-language UI/UX hook context with lazy contract documents and
  require contract-bound route, state, and viewport PNG inventory.
- Fail closed when renderer, auth, reviewer, or cleanup capabilities—or evidence
  freshness and root provenance—cannot be proved, with schema/runtime parity and
  adversarial real-surface coverage.

## 0.3.35 - 2026-07-26 — parity runtime release preparation

- Restore and enroll the complete `litwork`, rules-engine, plan-scaffolding,
  litgoal-drift, structural-search, comment-checker, and teammode surfaces.
- Resolve plan scaffolding from the installed plugin root while keeping the
  source-checkout command as a thin compatibility entrypoint.
- Track the nine release tests that exercise those surfaces while keeping local
  evidence and the litgoal autoloop test intentionally ignored.
- Extend canonical resource integrity and the isolated installed tamper probe to
  the new executable skill/runtime assets, including the teammode CLI, rules
  engine, installed scaffold executable, restored litwork body, and
  added-comment extraction runtime.
- Make `litwork`, `structural-search`, and `teammode` public skill inventory entries.
  Permission modes mutate global Claude settings `permissions.allow` and
  `permissions.deny`, preserve pre-existing entries, ownership-track only entries
  LitClaude inserted, and remove only those inserted entries on mode change or
  uninstall.

## 0.3.34 - 2026-07-25 — evidence-first UI/UX and visual QA

- Add the packaged `frontend-ui-ux` design-intelligence workflow with a
  2,277-record offline dataset, pinned source manifest, provenance and license
  records, a strict Design Contract schema, and bounded retrieval/import tools.
- Add strict visual evidence and independent-review schemas, bounded PNG and
  TUI analyzers, honest capability blockers, zero smoke review receipts, and
  exactly two independent receipts for full and reference-fidelity runs.
- Enroll both skills through the canonical catalog, CLI, doctor, installer,
  package guards, and adversarial scenario tests; prevent blocking P1 findings
  from retaining `PASS`, keep reviewers read-only, and bound TUI captures to
  1 MiB and 4,096 lines.
- Ship sixteen hash-pinned interface reference documents: fifteen design
  decision documents under `frontend-ui-ux/references`, each reachable from a
  router table in its skill entrypoint, and a per-channel capture playbook
  under `visual-qa/references`. `npm run validate:plugin` now emits
  `SKILL_REFERENCE_ROUTER_PASS` and fails when a shipped reference is not
  reachable from its own entrypoint.
- Give the visual evidence lane its own copy of the Design Contract schema and
  an independently written shape validator, so the evidence runtime imports
  nothing from a sibling skill and a manifest stays checkable from whatever
  subset of the package a caller installed. The two implementations agree
  across the strict contract corpus; coupling between lanes is by contract
  hash and evidence schema, never by skill name.
- Split future-dated evidence out of staleness as `BLOCKED_EVIDENCE_FUTURE`,
  add `BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED` for a capture environment that
  names no verified renderer or process owner, and make an honest incomplete
  cleanup representable as `BLOCKED_CLEANUP_INCOMPLETE` instead of a schema
  error. A cleanup status that contradicts its own resource list stays a
  `CLEANUP_INCOMPLETE` failure. Review failure remains `FAIL`; only an absent
  capability is `BLOCKED`, and `BLOCKED` continues to outrank `FAIL`.
- Rewrite both interface skill entrypoints as dense host-native contracts with
  invocation and selection rules, prerequisites, explicit non-goals, inert-data
  trust boundaries for reference and user-supplied text, manual QA steps,
  cleanup and handoff rules, and real install-verification output.

## 0.3.33 - 2026-07-24 — update notice and installed catalog verification

- Add a nonblocking npm update notice for interactive `install`, `update`, and
  `doctor`, backed by a strict product cache, atomic concurrent reservation,
  and bounded official registry refresh. Attempt timestamps throttle successful,
  offline, failed, and interrupted checks for 24 hours without discarding the
  last trusted result; stale trusted results may still notify, while future or
  noncanonical timestamps fail safe. Transition/recovery mutex ownership and
  per-attempt generation fencing prevent stale takeover or late-worker cache
  overwrite. CI/JSON/dry-run/non-TTY and environment opt-outs remain authoritative.
- Preserve the installed permission mode and HUD accent during an optionless
  reinstall while retaining explicit overrides.
- Make source doctor, install verification, installed doctor, and Claude plugin
  details share the exact canonical skill catalog. Missing installed skill
  payloads now fail with `DOCTOR_FAIL`, and packed-install corruption coverage
  proves the user-facing doctor cannot report success for an incomplete catalog.
- Add a narrow native `/goal` capability matrix for user/Remote Control,
  SDK-owned, separate print, and already-open TUI session boundaries without a
  plugin runtime bridge, including minimum client, workspace trust, policy/hook,
  and SDK-advertised command prerequisites.

## 0.3.32 - 2026-07-23 — bounded-authority start-work lifecycle

- Added a code-owned schema-3 start-work runtime with canonical authority roots,
  semantic grants, monotonic revisions, idempotency, lock ownership, and durable
  ledger reconciliation.
- Enforced active authority through Claude Code PreToolUse, exact single-use
  UserPromptSubmit resume grants, and fail-closed forbidden release boundaries.
- Bound root sessions, subagent lanes, Claude-owned worktrees, fenced-safe plan
  progress, and bounded Stop continuation receipts into completion checks.
- Kept zero-dependency CI executable without lockfile-only npm setup, made Stop
  re-entry non-blocking with fresh normal-event progress checks, and made invalid
  no-state resume attempts side-effect-free.

## 0.3.31 - 2026-07-22 — litgoal lifecycle and visual QA hardening

- Made duplicate litgoal creation byte-preserving, required explicit replacement
  for a different active objective, and rejected completion with empty criteria.
- Made all-pass autoloops complete and disarm durably with idempotent completion
  receipts, repairable ledger writes, and fail-open preservation of corrupt counters.
- Clarified visual QA backend ownership, authentication boundaries, bounded waits,
  advisory metrics, blocked states, and observed cleanup receipts.

## 0.3.30 - 2026-07-19 — LitResearch scientific records and public-reader hardening

- Added root-owned append-only claim/evidence records, bounded expansion and
  sequential fallback, DOI normalization, PDF byte proof, and separate
  metadata/acquisition/conversion/review states to LitResearch.
- Hardened public reads with connection-pinned DNS validation at every redirect,
  broader private-address rejection, inert-content receipts, content proof, and
  deep source-secret redaction.
- Removed installed CLI and MCP environment bypasses for private destinations
  and expanded invocation, package, reader, and security regression coverage.

## 0.3.29 - 2026-07-18 — bundled handoff and scientific visualization

- Bundle the approved exact-source `022_handoff` and
  `045_scientific-visualization` corpora with their licenses, provenance,
  scripts, assets, and canonical-source integrity records.
- Add Claude-native command and exact-bare prompt-hook routes for `handoff` and
  `lit-scientific-visualization`, including visible route-specific
  `🔥 LITBURN IGNITED` banners and inert near-miss handling.
- Verify installed-package skill discovery, immutable payload checks, script and
  asset path resolution, and honest read-only dependency diagnostics for the
  scientific visualization workflow without silently installing Python packages.

## 0.3.28 - 2026-07-14 — explicit start-work activation

- Require the `$start-work` shorthand and natural `lit start work` activation
  to be leading command phrases without changing other dollar routes.
- Keep diagnostic prose, copied blockquotes, and explanatory mentions of
  `$start-work` or `lit start work` inert while preserving explicit dollar,
  bare, natural, and native slash start-work routes.

## 0.3.27 - 2026-07-12 — structured interactive installer

- Present interactive installs as five persistent, numbered Claude-native
  stages with purpose and target details plus a live spinner during filesystem
  work.
- Add explicit `PREPARING INSTALL`, successful `INSTALL RECEIPT`, and failed
  `INSTALL STOPPED` summaries without changing dry-run or deterministic
  non-TTY `INSTALL_STEP` behavior.
- Respect `NO_COLOR`, retain CI-safe output, and verify the installed payload,
  Claude plugin registry, and compatibility pointer before reporting success.

## 0.3.26 - 2026-07-11 — planning quality and orchestration safety

- Make `lit-plan` checklist depth adaptive: one bounded objective, explicit
  non-goals, resolved or gated unknowns, Action/Output/Verification items,
  decision branches, proportionate evidence, and a replayable DoneClaim.
- Add `review-work` plan-review mode with scope, objective-achievability,
  checklist-atomicity, evidence, failure, and cleanup audits while preserving
  the completed-work 5-lane review and the planning-only no-implementation
  boundary.
- Harden orchestration readiness against disabled or malformed user, project,
  and managed-policy settings; remove delegation from the standalone planner
  and document bounded workflow lifecycle and cleanup behavior.

## 0.3.25 - 2026-07-09 — portable and public-read release prep

- Prepare `litclaude-ai@0.3.25` after aligning installed portable details,
  `public-read`, `litgoal status --json`, evidence wording, and release docs for
  manual npm publication.
- Preserve local `HANDOFF_litclaude.md` continuation state outside product
  commits.

## 0.3.24 - 2026-07-08 — auxiliary skill inventory and advisory probes

- Prepare `litclaude-ai@0.3.24` after aligning public auxiliary skill inventories for `frontend-ui-ux`, `git-master`, `lsp-setup`, and `visual-qa` without adding slash-command routes.
- Add non-mutating advisory probe coverage for shipped LSP setup and visual QA helper scripts while preserving local `HANDOFF_litclaude.md` state outside product commits.

## 0.3.23 - 2026-07-08 — full lit-family clean-room release prep

- Prepare `litclaude-ai@0.3.23` for npm publication after extending bare lit-family prompt-hook routes to inject the installed `SKILL.md` body.
- Keep the safe natural-language `lit start work` BLOCKED handoff while explicit bare skill routes carry full prompt context.

## 0.3.21 - 2026-07-07 — full bare skill-body routing

- Inject bundled `SKILL.md` bodies for bare `hyperplan`, `litresearch`, `lit research`, `init-deep`, and explicit `$start-work` prompt-hook routes so activation carries the same substantive skill contract as the installed payload.
- Add `/litclaude:init-deep` command coverage while preserving slash-command, code-span, fenced-code, near-miss, and natural-language `lit start work` BLOCKED handoff guards.

## 0.3.20 - 2026-07-07 — bare hyperplan prompt routing

- Route bare `hyperplan` prompts into the planning-only Hyperplan surface while preserving slash-command, code-span, fenced-code, and near-miss trigger guards.
- Align README release badges, install examples, and release wording with the published `litclaude-ai@0.3.20` package.

## 0.3.19 - 2026-07-05 — hyperplan adversarial planning skill

- Add the `hyperplan` skill for planning-only adversarial critique before implementation: independent read-only lanes, cross-review, defense/refinement, surviving insight bundle, and `lit-plan` handoff.
- Keep the workflow as a planning surface only: no file edits, no command execution beyond read-only inspection, and no implicit transition into implementation without a separate approved plan.

## 0.3.18 - 2026-07-04 — read-only lit-recap session recap

- Add the `/litclaude:lit-recap` command and `Skill(lit-recap)` for a read-only session recap: Korean-default fixed section headers with a `## ⚡ 요약` digest on `--brief` / `짧게` and an English body on request (`--en`).
- Route bounded hook triggers `lit recap`, `litrecap`, `recap`, `리캡`, and `$lit-recap` to the recap contract while rejecting near-miss substrings (`recapture`, `recaptcha`, `리캡처`), code spans/fences, and slash-command mentions.
- Keep recap activation side-effect-free — no ledger writes, no file creation, no mutating `litgoal` subcommands — and document the trigger surface in `docs/hooks.md` and both READMEs.

## 0.3.17 - 2026-07-01 — native `/goal` worker launcher

- Add `litgoal native-worker` as a dry-run-first launcher for a separate Claude Code print/background worker whose first prompt is `/goal <condition>`.
- Require explicit `--execute` before spawning `claude`, reject malformed or secret-like conditions, avoid shell interpolation, and propagate child worker failures.
- Document the capability boundary clearly: this does not arm an already-open TUI, does not inject tmux keystrokes, and does not mutate private transcript metadata.

## 0.3.16 - 2026-06-27 — WSL2 HUD gradient hotfix

- Restore truecolor neon gradient rendering for WSL2/Windows Terminal status lines when Claude Code drops `WT_SESSION` before invoking the HUD command.
- Keep the 256-color bright-magenta fallback for terminals without truecolor signals.

## 0.3.15 - 2026-06-26 — Korean AI-slop remover workflow

- Add `/korean-ai-slop-remover` as a Claude Code-native Korean prose polishing command with strict multi-agent routing from day one.
- Ship Korean style analysis, prose editing, meaning-preservation audit, native-flow review, and polish orchestration agents.
- Add the `korean-ai-slop-remover` skill references for fidelity checks, rewrite rules, and Korean style patterns while keeping the package surface free of upstream-port trace names.

## 0.3.14 - 2026-06-26 — litresearch activation polish

- Add bare `litresearch ...` prompt-hook activation while preserving slash/code/substr false-positive protections.
- Clarify read-only/no-write/transcript-only behavior before creating `.litclaude/litresearch/<slug>/` journals.
- Separate guaranteed JS-only public-source reader surfaces from host-dependent `Workflow`, `/deep-research`, browsing, and subagent orchestration.

## 0.3.13 - 2026-06-23 — public-source reader runtime

- Add a JS-only public-source reader core under `plugins/litclaude/lib/public-source-reader/` with http(s)-only validation, private/local target blocking, direct public fetch, metadata/OGP/JSON-LD extraction, text extraction, route evidence, and safe auth/paywall stop reasons.
- Add `litclaude public-read <url-or-query> --json` for machine-readable public-source reads without requiring Python, browser automation, credentials, or auto-installed dependencies.
- Expose MCP `public_source_read` so litresearch and external MCP clients can call the same guarded runtime surface.

## 0.3.12 - 2026-06-23 — resilient public-source research routing

- Add `lit search` and `lit query` natural-language routing to litresearch while preserving slash/code/near-miss trigger safety.
- Harden litresearch and librarian lanes with public API/feed preference, validator-first retrieval checks, compact route traces, metadata fallback, prompt-injection quarantine, and honest auth/paywall/private-data stop reasons.
- Add an A/B retrieval check so enhanced public-source retrieval is kept only when it improves evidence quality over the baseline search/fetch path.

## 0.3.11 - 2026-06-21 — native goal/workflow/team route hardening

- Add honest native `/goal` binding guidance with degraded-mode `BLOCKED:` fallback when Claude Code exposes no supported programmatic goal surface.
- Add safe natural-language workflow/team routes (`lit workflow`, `lit ultracode`, `lit team`) with disabled-surface gates and no phantom launch/spawn claims.
- Preserve slash/path false-positive protections and natural-language `lit start work` handoff safety.

## 0.3.10 - 2026-06-20 — build-decision gate and reuse self-review

- Add a pre-write minimum-first build-decision gate and a necessity/reuse self-review to the
  programming skill.

## 0.3.9 - 2026-06-19 — hook activation and mode-discipline parity

- Port the LitOpenCode v0.1.17 workflow contract into Claude Code-native surfaces without copying
  OpenCode-only hooks or permission objects.
- Rework `UserPromptSubmit` activation so natural language routes `lit`, `litwork`, `lit plan`,
  `lit review`, `lit research`, `lit goal`, and `lit start work` to distinct mode contracts while
  ignoring slash commands/mentions, code spans/fences, substrings, and compound tokens.
- Add safe natural-language `lit start work` behavior: the hook emits a `BLOCKED:` handoff that tells
  the user to run `/start-work` or `/litclaude:start-work` instead of pretending a prompt hook can
  switch Claude Code agents.
- Strengthen prompt contracts across lit-loop, lit-plan, start-work, review-work, litresearch, and
  litgoal; document primary order as `lit-loop`, `lit-plan`/`prometheus-planner`, then
  `start-work`/`boulder-executor`.
- Add installer permission preferences (`safe`, `balanced`, `yolo`) as Claude-native recorded
  settings. Balanced records routine automation preference while preserving dangerous-shell deny
  boundaries and planner read-only safeguards.

## 0.3.8 - 2026-06-16 — sibling-parity skill depth + goal/workflow feasibility reflection

- **Deepen eight skills to sibling parity.** A cross-sibling audit found several skill prompts were
  materially thinner than their counterparts. Re-authored brand-clean, in LitClaude's own Claude Code
  idiom (no foreign naming):
  - `refactor` (73 → ~437 lines) — a phased behavior-preserving playbook: intent gate → codebase
    analysis (LSP + read-only subagents) → codemap/impact zones → coverage-gated strategy
    (run/add-characterization/PAUSE/BLOCK) → per-step execute-verify-revert with a Failure Recovery
    Protocol → final regression sweep.
  - `remove-ai-slops` (52 → ~347) — a 10-category slop taxonomy with KEEP/REMOVE rules, a **test-first
    behavior-lock** safety invariant (pin behavior green *before* removing), a 5-gate quality table,
    risk-ordered cleanup, and a "when in doubt, SKIP" rule.
  - `programming` (106 → ~437) — a language gate that routes to the already-shipped per-language
    `references/`, a cross-language iron-list table, canonical-library/toolchain tables, a TDD pyramid
    + Given/When/Then + mock ladder, the 250-LOC ceiling with measurement, and a post-write self-review
    loop into `refactor` / `remove-ai-slops`.
  - `debugging` (70 → ~207) — now **activates the previously-orphaned `references/` library** (~1,500
    lines of runtime/tool/methodology depth) via routing tables, a phase loop with a ≥3-hypothesis
    floor + oracle-triple escalation, safety invariants, and a `.debug-journal.md` revert discipline.
  - `litresearch` (148 → ~228) — durable on-disk session journaling (wave digests + expansion-log +
    `SYNTHESIS.md`) for recovery-after-compaction, a search-craft operator playbook (≥10-query floor,
    English-first-then-local), and a richer worker roster.
  - `lit-plan` (125 → ~291) — task-tier classification, explore-first grounding, interview-the-unknowns,
    an approval gate, a templated success-criteria block, and a pre-finalize two-pass review.
  - `start-work` (131 → ~252) — LIGHT/HEAVY tiering, a per-checkbox A–E gate loop with a 9-class
    adversarial-QA taxonomy, a baseline-characterization gate, and an independent-verifier completion
    contract.
  - `review-work` (331 → ~519) — a Phase-0 context-gathering preamble, ready-to-paste per-lane launch
    prompts with fixed output schemas, the QA brainstorm-before-execute scenario method, and an
    expanded 10-category security checklist.
- **Add a LIGHT/HEAVY effort tier to `lit-loop`** — classify the task once at bootstrap and size the
  process to match (ratchet up only; when uncertain, treat as HEAVY). This closes the one litwork-tier
  gap relative to siblings without adding a duplicate skill.
- **Reflect the goal / dynamic-workflow feasibility finding.** Investigation confirmed: entering Claude
  Code's native `/goal` state from a plugin is **functionally impossible** (the host exposes no
  model-facing goal tools and a hook cannot type a slash command) — the litgoal **autoloop** remains the
  correct plugin-owned equivalent and is verified working. The Dynamic workflow path, by contrast, was
  **partially implemented**: the guidance told the model to call `Workflow` unconditionally, but the
  tool requires explicit user opt-in. The hook context, the `lit-loop` skill, the `dynamic-workflow` /
  `lit-loop` commands, and the README now **propose a Dynamic workflow and call `Workflow` only once the
  user opts in** — clarifying that this opt-in gate (not a host limitation) is why a Dynamic workflow
  starts only after the proposal.

## 0.3.7 - 2026-06-14 — litresearch skill + LITBURN ignition banner

- Add the **`litresearch`** skill (`plugins/litclaude/skills/litresearch/`) + command
  (`/litclaude:litresearch`) + hook trigger — a Claude-native maximum-saturation research
  orchestrator (the successor to the reference deep-research swarm concept, fully re-authored for
  Claude Code, brand-clean). It decomposes a research demand into atomic sub-questions, fans out
  parallel retrieval swarms via the `Workflow` tool and `litclaude:librarian-researcher` / `explore`
  subagents (plus `WebSearch`/`WebFetch` and the host `/deep-research` skill when exposed), recursively
  chases every lead to convergence through a mandatory `## EXPAND` reply-tail contract, verifies
  contested claims via `litclaude:oracle-verifier` or code runs, and synthesizes a fully cited answer
  (Phases 0–4, scale-to-demand tiers, stop rules). Activates only on an explicit research demand.
- Add the **`🔥 LITBURN IGNITED 🔥`** activation banner. Whenever a litwork trigger fires
  (`lit`/`litwork` and the `/lit-*`, `/litgoal`, `/litresearch`, `/start-work`, `/review-work`,
  `/dynamic-workflow` commands), the `UserPromptSubmit` hook now (a) sets the user-visible
  `systemMessage` to the banner and (b) instructs the model to open its reply with the exact
  `🔥 LITBURN IGNITED 🔥` line. (Deep-interview keeps its own non-litburn message.)

## 0.3.6 - 2026-06-14 — litgoal autoloop: a plugin-owned `/goal`-equivalent

- Add **litgoal autoloop** — a plugin-owned `Stop` hook
  (`plugins/litclaude/hooks/hooks.json` + `bin/litclaude-hook.js` `case "stop"`) that reproduces
  Claude Code `/goal`'s autonomous keep-running behavior **under plugin control**, driven entirely
  by the durable litgoal ledger. The model arms it with
  `litclaude-ai litgoal create-goals --brief "…" --autoloop`; on every Stop event the hook reads
  `.litclaude/litgoal/goals.json` and returns `decision: block` with a snapshot of the remaining
  criteria until **all criteria deterministically pass**, then allows the session to stop. This
  enables a `/goal`-equivalent execution loop via LitClaude skills + hooks **without the user typing
  `/goal`** (which is architecturally impossible for a plugin to invoke — see 0.3.5).
- Completion is a **pure function of recorded evidence** (stricter than the native small-model
  evaluator — it cannot be faked). New `lib/litgoal/autoloop.mjs` exposes a side-effect-free
  `evaluateAutoloop()` decision function plus a durable iteration counter (`autoloop.json`).
- **Four independent safety brakes** so the loop can never trap a session: opt-in `--autoloop`
  (default off — ordinary goals never block); `LITCLAUDE_GOAL_OFF=1` env kill switch; a durable hard
  cap (8 blocks / 30 min → `continue:false`); and fail-safe behavior (any unreadable ledger or
  un-writable counter ALLOWS stopping). Escape via `checkpoint --status blocked`/`--status complete`.
- Design + adversarial review captured in `docs/design/litclaude-goal-autoloop-design.md` (internal).
  Adds 13 tests (`test/litgoal-autoloop.test.mjs`) covering the decision function and the spawned hook.

## 0.3.5 - 2026-06-14 — correct the native `/goal` integration guidance

- Fix the native-goal guidance to match Claude Code reality. Claude Code's `/goal` (v2.1.139+) is a
  **user-typed slash command** that sets an autonomous completion condition — it is **not a
  model-facing tool**, and a hook or skill **cannot invoke it**. The previous guidance led with a
  `get_goal`/`create_goal`/`update_goal` "native goal tool" path that does not exist in any current
  Claude Code (a residue of retired non-Claude lineage), which buried the only real mechanism.
- Now, when a goal is worth binding (hook injection on `lit`/`litwork`/`/litgoal`, and the `lit-loop`,
  `lit-plan`, `start-work`, `litgoal` skills), LitClaude **proposes a concrete, ready-to-paste
  `/goal <completion condition>`** for the user and keeps the durable record in the local litgoal
  ledger. The `get_goal`/`create_goal`/`update_goal` path is retained only as an explicit
  forward-compat note ("if a future Claude Code build exposes model-facing goal tools, prefer them —
  none are exposed today"). LitClaude still never auto-types or sends `/goal`.

## 0.3.4 - 2026-06-14 — port visual-qa + lsp-setup; fix subagent namespace; recompress cover

- Add the `visual-qa` skill (`plugins/litclaude/skills/visual-qa/`), a Claude-adapted port of the
  reference dual-oracle visual QA: a bundled, dependency-free diff toolchain (PNG CRC/decoder,
  image-diff, ANSI + East-Asian-width, tui-grid, cli) plus two parallel read-only oracle passes
  (design-system + functional integrity; visual fidelity + CJK precision) synthesized into one
  verdict. Scripts run under Node 22.6+ (`--experimental-strip-types`) or bun, no install.
- Add the `lsp-setup` skill (`plugins/litclaude/skills/lsp-setup/`), a Claude-adapted multi-language
  LSP configurator: routes by file extension to `references/<lang>/README.md` for 20 languages
  (server choice, per-OS install, `.lsp.json` snippet, troubleshooting) and ships `detect-lsp.ts` +
  `verify-lsp.ts` (a real JSON-RPC diagnostics roundtrip) wired to LitClaude's `plugins/litclaude/
  .lsp.json`. Complements the existing quick-path `lsp` skill.
- **Fix subagent-delegation guidance** to use the `litclaude:` namespace. The injected hook text and
  the `dynamic-workflow` / `review-work` command docs now reference `litclaude:boulder-executor`,
  `litclaude:prometheus-planner`, etc. (the actual exposed `subagent_type`) instead of bare names that
  raised "Agent type 'boulder-executor' not found" when spawned literally.
- Losslessly recompress `cover.png` (2560×1280 preserved; ~3.74 MB → ~3.56 MB) and add
  `optimize=True, compress_level=9` to `generate_cover.py` so the generator emits the optimized form.

## 0.3.3 - 2026-06-14 — port the init-deep skill

- Add the `init-deep` skill (`plugins/litclaude/skills/init-deep/`), a Claude-adapted port of the
  reference hierarchical AGENTS.md generator: discovery → score → generate → review, with dynamic
  explore-subagent scaling, a weighted scoring matrix, AGENTS.md templates, and quality gates. All
  reference orchestration/LSP calls are re-authored to Claude Code surfaces (`Agent`/`Task` background
  subagents, the `LSP` tool, `Workflow` for parallel generation, `TodoWrite`) — no literal calls to
  missing tools, no non-Claude runtime tokens.
- Capture the portable parity audit in an internal plan, with `init-deep` completed and
  `visual-qa` / `lsp-setup` planned, while keeping public package surfaces brand-clean.

## 0.3.2 - 2026-06-14 — port the git-master skill

- Add the `git-master` skill (`plugins/litclaude/skills/git-master/`), a Claude-adapted port of the
  reference git-history specialist: mode-gated COMMIT / REBASE / HISTORY / STATUS workflows, atomic
  commit grouping with local message-style detection, `--force-with-lease` rebase safety, and
  `git log -S/-G` / `blame` / `bisect` / `reflog` history investigation. Aligned with LitClaude's
  publish boundary — no commit/push/history rewrite without explicit user authorization.

## 0.3.1 - 2026-06-14 — neon-HUD truecolor detection on Windows Terminal / WSL2

- Fix the `[🔥LITCLAUDE]` HUD falling back to flat 256-color magenta in Windows Terminal under WSL2.
  `supportsTruecolor` now also recognizes `WT_SESSION` (Windows Terminal, including WSL2, renders
  24-bit color but does not export `COLORTERM` into the shell), common 24-bit terminal programs
  (`TERM_PROGRAM` = vscode/hyper/wezterm/ghostty/iTerm.app), and direct-color terminfo entries
  (`TERM` matching `-direct`/`truecolor`). Terminals that export `COLORTERM=truecolor|24bit` are
  unchanged; genuine 256-color terminals still get the magenta fallback.

## 0.3.0 - 2026-06-14 — LitClaude rebrand + lit-family vocab + neon HUD

- Rename the retired trigger vocabulary to the **lit family**: `lit`, `litwork`, `lit-loop`,
  `lit-plan`, and `litgoal` end-to-end across hooks, skills, commands, and documentation.
- `lit` trigger now maps to `lit-loop` semantics with a soft-confirm step before long execution
  instead of falling through to a plain loop.
- Ship a neon `[🔥LITCLAUDE]` truecolor-gradient HUD (hot-pink → cyan gradient; bright-magenta
  fallback on 256-color terminals) branded with `[🔥LITCLAUDE vX.Y.Z]`.
- Rename the project to **LitClaude / `litclaude-ai`** end-to-end: npm package,
  `litclaude`/`litclaude-ai` bins, `plugins/litclaude/` payload, installer identifiers
  (`litclaude@litclaude-ai`), 13 `LITCLAUDE_*` env vars, per-project state dir `.litclaude/`,
  HUD banner `[LitClaude vX.Y.Z]`, and the 7 `litclaude:*` slash commands. See
  `docs/migration.md` for current install and state surfaces.
- Add a fail-closed guarded-token scanner (`tools/scan-legacy-tokens.mjs`) that keeps tracked
  and shipped surfaces free of retired identity, vocabulary, and source-trace terms.
- Add a no-publish CI workflow (`.github/workflows/ci.yml`, `permissions: contents: read`) plus
  version-lockstep, CI-integrity, and pack-payload hardening gates.
- Make the atomic state store durable (fsync), remove the ported `codex:` session-id residue (Claude
  host semantics), and replace brittle `import.meta.url.pathname` with `fileURLToPath` for
  spaced/`#`/non-ASCII workspace paths.

## 0.2.2 - 2026-06-07

- Harden Dynamic workflow delegation with an explicit child-assignment
  contract: `TASK:`, `DELIVERABLE`, `SCOPE`, and `VERIFY`, plus bounded wait and
  fallback rules for missing deliverables, acknowledgement-only replies, and
  `BLOCKED:` reports.
- Add `litclaude-ai start-work-next --json` so long `$start-work` runs can
  resume from `.litclaude/boulder.json` and `.litclaude/start-work/ledger.jsonl` without
  guessing the next unchecked top-level plan item.
- Make PostToolUse guidance name actual mutated files for write/edit/multiedit,
  notebook, and patch-shaped tool inputs, and add bounded SessionStart resume
  guidance when transcript context-pressure markers are detected.
- Extend `workflow-check --json` with subagent reliability and command/hook
  agreement checks.

## 0.2.1 - 2026-06-04

- Add a dedicated `/dynamic-workflow` route for Dynamic workflow bootstrap,
  native `/goal` fallback guidance, and Claude Code subagent delegation.
- Add `litclaude-ai workflow-check --json` so operators can verify goal,
  Dynamic workflow, hook route, and subagent delegation readiness before full QA.
- Fix the right-pane `test/` local-session ignore pattern so ad hoc Claude Code
  session artifacts stay out of git and package payloads.

## 0.2.0 - 2026-06-03

- Align the package and Claude plugin manifests to `litclaude-ai@0.2.0` for
  the workflow parity release candidate.
- Add the `review-work` 5-lane review route and document its scope/diff,
  tests/evidence, package/payload and code quality, security/provenance, and
  real-surface/docs readiness lanes.
- Add the durable goal CLI/runtime surface for criteria, evidence, checkpoints,
  steering, and review blocker records under `.litclaude/litgoal/`.
- Keep the release boundary explicit: this version is prepared for verification
  and publication approval, but no npm publish or marketplace publication is claimed
  here.

## 0.1.18 - 2026-06-02

- Shorten the HUD into compact HUD bars with a three-cell context gauge and
  two-cell rate-limit gauges for tighter Claude Code status-line space.
- Replace muted installer choices with vivid HUD color choices and shared
  mini-HUD previews for all ten brand accent themes.
- Apply the selected accent as a broader brand accent across separators,
  labels, brackets, reset text, and git metadata.

## 0.1.17 - 2026-06-02

- Render a dense bracketed context bar in the HUD, for example
  `ctx [▉░░░░░░░░░] 9%/1000k`.
- Show low non-zero rate-limit usage with partial bar glyphs so 1% and 7% no
  longer look empty, and add spacing before the `↻` reset countdown.
- Add more eye-catching installer color labels for animated `npx` installs
  while preserving deterministic plain `INSTALL_STEP` output in CI.

## 0.1.16 - 2026-06-02

- Show compact HUD rate-limit reset countdowns with a `↻` suffix and parse
  Claude Code's epoch-second `rate_limits.*.resets_at` fields as well as ISO
  timestamps.
- Add `/deep-interview`, `$deep-interview`, and
  `/litclaude:deep-interview` routing for a Socratic requirements mode before
  planning or implementation.
- Ship the `deep-interview` skill and its progress renderer, plus English and
  Korean README guidance for when to chain it into the planning or execution routes.

## 0.1.15 - 2026-06-01

- Add an install-time LitClaude HUD brand color picker with immediate ANSI
  previews for each `[LitClaude vX.Y.Z]` choice.
- Persist the selected HUD accent in Claude `settings.json` and inject it into
  the managed `statusLine` command through `LITCLAUDE_HUD_ACCENT`.
- Allow noninteractive installs to keep the default LitClaude cyan accent
  without hanging CI, postinstall, or fresh-machine smoke tests.

## 0.1.14 - 2026-06-01

- Ignore Claude Code command XML transcript packets such as
  `<command-name>...</command-name>` when selecting the HUD's latest user prompt
  preview, so command metadata never appears as the second HUD line.
- Add the sleepy LitClaude HUD prefix `[LitClaude vX.Y.Z]` while preserving
  the compact context, rate-limit, and git segments.

## 0.1.13 - 2026-06-01

- Fix short slash route handling so planning, execution, and `/start-work`
  map to their matching LitClaude disciplines instead of falling through to a
  plain loop activation.
- Preserve punctuation-delimited short triggers while ignoring hyphenated
  near-misses.
- Round HUD context/rate-limit percentages before rendering, so floating-point
  values such as `7.000000000000001%` never leak into the status line.
- Ignore transcript entries that start with `<local-command-stdout>` or
  `<local-command-stderr>` when selecting the HUD's latest user prompt preview.
- Document the short slash aliases in English/Korean README and hook docs.

## 0.1.12 - 2026-06-01

- Recover from the npm publish rejection for already-published `0.1.11` by
  preparing a new `litclaude-ai@0.1.12` package version.
- Include the source-checkout npx shim so same-name checkout installs can
  resolve the package-name executable.
- Add installer progress output with animated TTY spinner frames and
  deterministic CI-safe `INSTALL_STEP` logs.

## 0.1.11 - 2026-06-01

- Add `litclaude-ai --version` / `litclaude-ai -v` for quick package smoke
  checks without requiring install state.
- Align package, plugin, README, HUD examples, release checklist, and cover image
  generation to `litclaude-ai@0.1.11`.
- Refresh README, reference metadata, and workflow
  compatibility audit wording.
- Deepen trigger-specific hook routing for planning, execution, and `$start-work`,
  with safer post-edit diagnostic guidance.

## 0.1.10 - 2026-06-01

- Install a LitClaude-branded Claude Code statusLine HUD automatically during
  `litclaude install`, with safe previous-statusLine restoration on uninstall.

## 0.1.8

- Teach `litclaude doctor` to separate LitClaude's own LSP declaration from
  external Claude Code LSP plugin binary warnings.

## 0.1.7

- Expand the workflow compatibility audit beyond skill frontmatter into portable
  component coverage.
- Ship the original `ai-slop-remover` skill alias alongside the LitClaude
  `remove-ai-slops` skill.
- Include LitClaude programming and debugging auxiliary reference packs so the
  Claude plugin carries the same deep language/runtime guidance, not only short
  summary skills.

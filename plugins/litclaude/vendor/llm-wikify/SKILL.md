---
name: llm-wikify
description: |
  Convert the current working directory into a task-local LLM-maintained wiki.
  Use when the user wants to organize project knowledge, ingest files or URLs into
  a local markdown wiki, bootstrap a wiki structure in-place, maintain an existing
  mini wiki, or build a repo-scoped knowledge base instead of a giant global vault.
  Also use when scientific papers, PDFs, TeX bundles, bibliographies, or research
  corpora should be ingested into a maintained local wiki with provenance and
  citations, subject to extraction quality and available metadata.
  Trigger on phrases like "wiki this repo", "ingest raw/", "build a local wiki",
  "maintain this knowledge base", "turn this directory into an LLM wiki", or when
  repeated project knowledge needs to compound across sessions. DO NOT TRIGGER when:
  the user only wants a one-shot summary, a global PKM redesign, or generic markdown
  cleanup with no persistent wiki intent.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - WebFetch
  - WebSearch
---

# llm-wikify

Turn the **current working directory** into a mini LLM wiki that compounds project knowledge over time.

The key difference from a giant second-brain vault is scope discipline: this skill treats the active task directory as the wiki boundary unless the user explicitly asks for something broader.

---

## Core Rule

**The working directory is the wiki.**

- Do **not** assume one universal knowledge base.
- Do **not** create a sprawling personal-vault taxonomy unless the user asks.
- Do **not** flatten the wiki into one giant markdown file.
- Do build a small, legible, repo-local structure that helps future agents and humans navigate the task.

If the user gives you one project, one working directory, or one repo, then default to a **task-local wiki**.

### Locality boundary rules

- Never create or reorganize wiki content outside the current working directory unless the user explicitly expands scope.
- In a monorepo, default to the subproject or folder the user is actively working in, not the whole monorepo, unless they clearly ask for repo-wide coverage.
- Do not silently pull in parent-directory PKM structure, sibling projects, or a pre-existing personal vault.
- If the boundary is ambiguous, prefer the narrowest valid scope and state that assumption in the created `schema/wiki-rules.md`.

---

## When to Use

Use this skill when the user wants any of the following:

- bootstrap a wiki in the current repo or task folder
- ingest new sources dropped into `raw/`
- ingest scientific papers, PDFs, TeX bundles, bibliographies, or already-converted paper Markdown into a local research wiki
- keep summaries, concepts, decisions, entities, and references synchronized over time
- answer project questions against a persistent local markdown knowledge base
- lint or maintain an existing local wiki
- organize research, due diligence, product notes, technical docs, meeting notes, or mixed-source project knowledge without building a global PKM system

Do **not** use this skill when:

- the user only wants a one-shot summary or memo
- the task is ordinary docs cleanup with no persistent knowledge workflow
- the user explicitly wants a cross-project or personal-vault redesign
- there is no desire to maintain a persistent markdown artifact

---

## Operating Modes

### 0. Novice Socratic onboarding mode
Use when the user wants a local wiki but sounds uncertain, starts from an empty folder, asks "how do I use this?", or would be overwhelmed by implementation details. This is the default first-run experience for new users.

Your job:
- hide internal mechanics at first; do not open with folder taxonomy, schema rules, bridge packets, Graphify, graph databases, or vault concepts
- ask only the minimum useful questions, then act
- default to this exact three-question onboarding script:

  ```text
  I can organize this folder into a maintained local wiki. I will keep the internal structure out of your way first.

  1. What should this wiki remember over time?
  2. What source material exists now, and what kind of sources will keep arriving?
  3. How autonomous should I be while organizing it?
     A) Do it and show results
     B) Show key takeaways before shaping
     C) Process one source at a time with review
  ```
- use adaptive questioning: stop after those three if there is enough signal; ask follow-ups only when execution would otherwise be fake-grounded
- if the folder is empty or has almost no sources, offer a starter pack first, then ask for seed content:
  - personal knowledge
  - research/deep dive
  - project handoff
  - book/course notes
  - business/team wiki
  - then: "Give me three things this wiki should remember first."
- after bootstrapping, point the user to the single start page (`wiki/home.md`)
- mention bridge/promotion, graph lenses, global export, or external tools only after the first useful wiki exists or when the user explicitly asks about cross-project reuse or relationship maps

Non-goals for novice mode:
- do not make the user learn `raw/wiki/schema/bridge` vocabulary before the first useful result
- do not force more than three questions unless ambiguity blocks execution
- do not silently write into a global wiki, graph database, external vault, sibling repo, or external store
- do not modify raw source files

### Agent decision boundaries

The agent may decide these without asking once the user has answered the novice onboarding questions or provided enough source context:

- local folder/page naming inside the current working directory
- whether to create or update topic, entity, source, index, home, schema, or log pages
- how to summarize, link, and route source material into the local wiki
- when to mark uncertainty, contradictions, weak provenance, or review-needed items
- whether to draft a local bridge packet as a candidate artifact

The agent must ask for explicit approval before:

- writing outside the current working directory
- exporting to a global wiki, another repository, an external vault, a graph database, or any external system
- modifying raw source files
- doing destructive or large-scale reorganization
- turning an optional graph/relationship lens into a dependency

### Public-repo portability and privacy rules

This skill is meant to be cloned or forked by many users. Keep docs, examples, templates, and evals universal:

- use neutral placeholders such as `<repo-url>`, `<project-name>`, `<source-file>`, and `<destination-wiki>`
- do not include personal names, private paths, private chat exports, credentials, tokens, API keys, machine-specific paths, or organization-internal examples
- examples should work for an arbitrary project directory, not one user’s local setup
- when discussing sensitive inputs, say how to preserve provenance and boundaries without copying private raw content into reusable templates

### Optional graph / relationship lens

Graph-style analysis can be useful after a wiki has enough pages to analyze relationships. Treat it as an optional advanced lens, not a first-run requirement. A graph-compatible workflow may read the maintained local wiki, produce relationship maps or reports inside the current working directory, and feed useful findings back into local topic pages or bridge candidates. It must not require a graph backend and must not write to external stores without explicit approval.

### 1. Bootstrap mode
Use when the working directory has **no clear wiki structure yet**.

Your job:
- inspect what already exists
- create the smallest useful wiki structure
- preserve existing docs and point to them instead of duplicating them
- seed a home page, index, and only the minimum grounded pages needed
- write down the chosen locality boundary in `schema/wiki-rules.md`

### 2. Ingest mode
Use when the user adds new files, notes, exports, or URLs into `raw/`.

Your job:
- treat `raw/` as immutable source material
- extract useful knowledge into the wiki
- preserve provenance for claims and summaries
- update related pages incrementally rather than rewriting everything

### 2a. Scientific paper ingest mode
Use this advanced ingest sub-mode when `raw/` contains scientific papers or research corpora: PDFs, TeX/LaTeX bundles, arXiv source exports, already-converted paper Markdown, `.bib` files, supplements, figures, tables, or curated bibliography exports.

This mode borrows structured research-wiki patterns without turning the local wiki into a fixed global research platform.

Your job:
- keep original paper files and TeX bundles immutable under `raw/`
- convert or linearize sources only into derived working files or wiki notes, never by rewriting raw inputs
- create or update one stable paper source note per paper or source bundle, preferably using `assets/paper-source-note-template.md` when available
- extract bibliographic metadata when available: title, authors, venue, year, DOI, arXiv ID, source files, bibliography file, and citation-source confidence
- preserve paper structure where extraction quality allows: abstract, problem, method, assumptions, datasets, experiments, results, limitations, open questions, figures/tables, equations, and references
- route durable concepts, methods, datasets, claims, limitations, and open questions into existing topic/shared pages instead of creating a page for every section
- run a deduplication pass before creating new topic/entity pages: compare intended page titles and claims against existing index/topic/source pages; merge when overlap is likely
- use paper importance to limit wiki growth: low-importance papers should usually create at most one new topic and one new claim/concept; high-importance papers may justify more, but only when navigation improves
- record uncertainty for missing metadata, unresolved TeX macros, broken includes, incomplete bibliography, OCR/conversion artifacts, inaccessible figures, weak claims, or contradicted results
- update `wiki/index.md`, `wiki/home.md`, and `log/log.md` only for real persistent additions or changes

Optional local research artifacts, created only when useful and inside the current working directory:
- `.ingest-manifest.json` for resumable batch paper ingestion
- `wiki/graph/edges.jsonl` for semantic relationships such as `builds_on`, `uses_method`, `supports`, `contradicts`, `extends`, or `replicates`
- `wiki/graph/citations.jsonl` for bibliographic citation edges from parsed `.bib`, paper references, Semantic Scholar, or manual review
- `wiki/gaps.md` for open questions, limitations, weakly supported claims, and future-work leads aggregated from paper/source/topic pages
- `wiki/context.md` for a compact reading brief summarizing paper count, key concepts, active gaps, and recent changes

Do not make these optional artifacts first-run requirements. They are scale tools for research wikis that have enough papers to benefit from them.

### 3. Query mode
Use when the user asks questions against the local wiki.

Your job:
- read the index first
- follow the most relevant local pages
- answer with citations to wiki pages and raw sources where appropriate
- file high-value analyses back into the wiki when they would be useful later

### 4. Lint / maintain mode
Use when the wiki already exists and needs health checks.

Your job:
- detect stale pages, orphan pages, broken links, duplicate topics, inconsistent naming, weak summaries, and unresolved ingestion leftovers
- make targeted fixes
- leave a short maintenance report with what changed and what still needs human review

### 5. Bridge / promote mode
Use when local knowledge has become useful beyond this project, or when the user asks how this project relates to another wiki, repo, domain, or global knowledge base.

Your job:
- keep the local wiki authoritative for project-specific facts
- identify only the durable concepts, patterns, decisions, comparisons, or entities worth promoting
- create a local export packet under `wiki/bridges/` rather than silently writing into an external/global vault
- preserve provenance back to local pages and raw/source notes
- recommend the destination and merge shape for a global wiki, but do not cross the locality boundary unless the user explicitly authorizes it

---

## Default Folder Contract

If no wiki exists, bootstrap this minimal structure inside the current working directory:

```text
raw/                 # immutable source material dropped in by the user
wiki/
  index.md           # content-oriented catalog of the wiki
  home.md            # start-here overview for humans and agents
  topics/            # concept/topic pages
  entities/          # companies, tools, people, systems, components when relevant
  sources/           # per-source summaries or source notes
  bridges/           # optional export/promote packets for cross-project/global synthesis
schema/
  wiki-rules.md      # local conventions for this wiki
log/
  log.md             # append-only ingest/query/lint history
```

This is the **default**, not a law. If the repo already has a better local structure, adapt to it instead of forcing this exact layout.

If the domain is simpler, reduce it. For small tasks, `wiki/index.md`, `wiki/home.md`, `wiki/topics/`, and `raw/` may be enough.

Do not create every folder just because it appears in this example. Create `entities/`, `sources/`, `bridges/`, or `log/` only when they serve the actual project.

### Optional category palette (evidence-gated)

Beyond `topics/` and `entities/`, a richer business-/team-oriented palette is available when real material justifies it. Treat these as an **opt-in palette, not auto-created scaffolding**. `init` / bootstrap must **not** create them up front; add a folder only when sources, decisions, or repeated queries prove it earns its place, and record the choice in `schema/wiki-rules.md`.

```text
wiki/
  decisions/      # decisions + rationale + decision-maker (owner) + date
  errors/         # failed approaches and risks that must not be retried
  projects/       # per-project working context and deliverables
  design/         # design principles, IA, screen/design guides
  dev-tasks/      # development task units, dependencies, implementation notes
  conversations/  # session handoff notes so a fresh agent can resume (see `save`)
```

These categories are an evidence-gated extension only when justified; the minimal-first default still governs first-run bootstrap.

### Optional umbrella-domain / clustered wiki pattern

For one large but coherent domain inside the current working directory, a flat `wiki/topics/` layer may eventually become hard to navigate. In that case, you may add an umbrella-domain structure with cluster mini-wikis, but only when source material, existing pages, or repeated user queries prove that stable sub-domains exist.

This is an **advanced optional pattern**, not the default. Keep novice onboarding simple and start flat unless the user explicitly asks for a large-domain structure or the inspected material clearly justifies clusters.

Stay with the flat default when:
- the wiki has one main audience and one maintenance cadence
- `wiki/home.md`, `wiki/index.md`, and `wiki/topics/` are still easy to navigate
- sources do not repeatedly belong to stable sub-domains
- shared glossary or comparison pages are enough
- cluster folders would mostly mirror speculative categories

Use umbrella clusters when:
- the working directory intentionally covers one large coherent domain, such as Gas Hydrates, LLM Agents, or Process Simulation
- at least two stable sub-domains recur across sources, topics, or queries
- each sub-domain has enough material to justify a cluster home page or repeated local pages
- readers need both an umbrella map and cluster-specific reading paths
- cross-cluster concepts can stay local in `wiki/shared/` without becoming a global vault
- the clusters share the same local boundary, ownership, audience, and maintenance loop

Split into a separate project wiki or ask before reorganizing when:
- a cluster has independent ownership, lifecycle, audience, confidentiality boundary, source stream, or maintenance cadence
- keeping it inside the umbrella wiki would create noise, privacy risk, or misleading provenance
- the cluster needs its own raw inputs, schema rules, log, bridge policy, or working-directory boundary
- the user explicitly asks for a separate wiki

Optional clustered shape:

```text
raw/
wiki/
  home.md                 # umbrella start page
  index.md                # umbrella catalog and cluster map
  topics/                 # umbrella-level topics only when cross-cluster or domain-wide
  entities/               # optional umbrella-level entities/systems/tools
  sources/                # optional source notes that are domain-wide or not cluster-specific
  shared/                 # glossary, canonical concepts, shared comparisons, shared decisions
  clusters/
    <cluster>/
      home.md             # cluster start page and reading path
      topics/             # cluster-local topic pages, only if justified
      sources/            # cluster-local source notes, only if provenance benefits
      comparisons/        # cluster-local comparisons, only if repeatedly useful
  bridges/                # local promotion/export packets; external writes still require approval
schema/
  wiki-rules.md
log/
  log.md
```

`wiki/shared/` is not a `misc/` folder. Use it only for concepts that genuinely cross clusters: glossary terms, canonical definitions, shared decision records, reusable comparisons, or domain-wide relationship notes.

Graph or relationship maps may analyze umbrella and cluster links after the wiki has enough maintained pages, but graph tooling remains optional. Keep graph outputs inside the current working directory unless the user explicitly approves an external destination.

### Optional research graph / citation layer

For scientific-paper wikis, a lightweight local graph can be useful once multiple papers and topics exist. Keep it file-based and optional:

```text
wiki/
  graph/
    edges.jsonl       # semantic relationships between local pages
    citations.jsonl   # bibliographic citation edges and metadata provenance
  gaps.md             # optional aggregated open questions / research gaps
  context.md          # optional compact query brief
.ingest-manifest.json # optional resumable batch ingest manifest
```

Rules:
- Semantic edges and citation edges are different. A paper may cite another paper without supporting it, and a paper may semantically contradict another even if it does not cite it.
- Each graph JSON line should include enough provenance to audit it: `from`, `to`, `type`, `evidence`, `confidence`, and `source` when known.
- Relationship files are local wiki artifacts, not an external graph database. External graph export requires explicit approval.
- If graph files become stale, maintenance should either rebuild them from wiki pages or mark them stale; do not silently trust old relationship data.

---

## MECE Structuring Heuristic

When bootstrapping or reorganizing, aim for **mutually exclusive, collectively exhaustive enough** categories — but only to the scale justified by the project.

Good:
- `topics/` for ideas, mechanisms, workflows
- `entities/` for named actors or systems
- `sources/` for source-level summaries and provenance

Bad:
- `misc/`
- `random-notes/`
- `things/`
- 20 top-level folders created before the directory is understood

If two folders are hard to distinguish, merge them.

---

## Schema, Metadata, and Taxonomy Discipline

Keep metadata lightweight, but make long-lived pages inspectable. For any durable topic/entity/source/bridge page, include a small grounding block near the top when useful:

```markdown
Type: topic | entity | source | decision | comparison | bridge
Status: draft | active | stale | candidate | exported | rejected
Built from: README.md, raw/source.md, [[sources/source-note]]
Last reviewed: YYYY-MM-DD
Confidence: high | medium | low
```

For pages that benefit from machine-readable headers (and for parity with portable wiki templates), the same grounding may instead be written as **YAML frontmatter** at the very top of the page:

```markdown
---
type: decision | source | concept | error | project | design | dev-task | handoff
date: YYYY-MM-DD
status: draft | active | stale | superseded
source: optional raw/ path or [[sources/source-note]]
---
```

Use either the grounding block or the YAML frontmatter consistently within a wiki; record which one in `schema/wiki-rules.md`.

Rules:
- Do not force metadata onto tiny scratch pages, but add it to pages expected to survive across sessions.
- If the local wiki uses tags, define the allowed vocabulary in `schema/wiki-rules.md` before spreading it across pages.
- New page types or status labels must be recorded in `schema/wiki-rules.md`; do not let each page invent its own taxonomy.
- Contradictions should be surfaced where a reader will see them: source note caveats are not enough if a topic page repeats the contested claim.
- If source hashes, timestamps, or file mtimes are available, record enough drift signal to notice later changes. Do not silently normalize changed sources.
- Global taxonomy can inspire the local schema, but must not distort the project-local structure. If global alignment is desired, use a bridge packet.

---

## Non-Negotiable Conventions

### 1. Raw is immutable
`raw/` is source material. Read from it. Do not rewrite it unless the user explicitly asks.

### 2. Wiki is generated and maintained
`wiki/` is the maintained knowledge artifact. This is where synthesized understanding lives.

### 3. Provenance is preserved
Every important claim, summary, or extracted insight should point back to a raw source note, source file, or URL when practical.

Each created topic/entity page should also declare its **grounding inputs** near the top, for example:

```markdown
Built from: README.md, raw/interview-2026-04-06.md, src/api/
```

### 4. Incremental updates beat rewrites
When a new source arrives, update the relevant pages and log the change. Do not regenerate the entire wiki unless the structure is badly broken.

Repeated ingestion should be idempotent:

- one stable source note per source or source bundle
- update existing pages when the same source is re-processed
- do not create duplicate topic pages just because wording changed slightly

### 5. The wiki stays local
Do not silently widen scope from the current project to a personal knowledge base.

### 6. Navigation must stay legible
Every page should have an obvious path in and out: from `home.md`, `index.md`, a topic page, or a source note.

### 7. Local-to-global promotion is explicit
Project-local pages may mention global relevance, but they must not silently reorganize or write into a personal/global wiki. When knowledge should travel, create a bridge packet that summarizes the promotion candidate, evidence, target destination, and merge risks. The user decides whether to apply it outside the current directory.

---

## Save Filters

Indiscriminate saving pollutes the wiki. Before persisting anything durable (the `save` action, or filing a query result back into `wiki/`), require that **at least one** of these five filters is true:

1. **Reusable** — will this information be reused in future work?
2. **Handoff** — must another agent or teammate read it to continue the project (continuity)?
3. **Decision** — is there a decision whose rationale and decision-maker (owner) need to be traceable later?
4. **Failure-risk** — is this a failed approach or risk that must not be retried?
5. **Shared rule** — is this a team-wide rule, convention, or design guide everyone must align on?

If none of the five hold, it is a **one-off** answer, impression, or trivial rewording — do **not** save it. When you decline to save, briefly state why.

This filter is what keeps a compounding wiki from degrading into a noisy dump.

## Session Handoff (`save`)

The `save` action persists durable working context so a fresh agent or a teammate can resume cleanly. When something passes the save-filters:

- route the durable knowledge to the right page (topic / decision / error / etc.) with provenance and standard frontmatter
- write or update a **session handoff note** under `wiki/conversations/` capturing: what was done, the key decisions, what is still unresolved, and which pages the next agent should read first
- update `wiki/index.md` for any new persistent page and append a record to `log/log.md`

`save` is realistic, not magic: it persists what is judged durable under the filters, not a verbatim dump of the whole session.

## Page Types

### `wiki/home.md`
The start page for a human or agent entering the wiki cold.

Should include:
- what this wiki is about
- what the current focus is
- where to start reading
- the most important linked pages

### `wiki/index.md`
The catalog. Organize pages by section with one-line descriptions.

### `wiki/sources/*.md`
One page per important source or source bundle.

Should capture:
- source identity
- short summary
- what changed in the wiki because of it
- open questions or contradictions

For scientific papers, source notes should also capture paper metadata, key claims, methods, evidence anchors, citation context, limitations, and re-ingest drift. Use a dedicated paper source-note template when available.

### `wiki/topics/*.md`
Persistent concepts, workflows, comparisons, decisions, or thematic summaries.

Create a new topic page only if at least one of these is true:

- the concept appears across multiple sources or repo landmarks
- the concept is important enough to be linked from more than one page
- the material would make an existing page overloaded or incoherent

Otherwise, extend an existing page instead of creating a new one.

### `wiki/entities/*.md`
Named systems, tools, people, teams, products, services, code components, or organizations when entity pages are actually useful.

Do **not** create entity pages just because the folder exists.

Entity pages should be rare in small repos. If the entity is mentioned only once or adds no navigation value, keep it inside a topic or source page.

### `wiki/bridges/*.md`
Promotion or export packets for knowledge that may belong in another project wiki, a global `llm-wiki`, or a higher-level concept map.

Bridge pages are not a second wiki. They are handoff artifacts. Include:
- local source pages and topic pages that justify the export
- the distilled claim, pattern, decision, or comparison worth promoting
- proposed destination page(s) or target domain
- conflicts, confidence level, and merge risks
- clear status: `candidate`, `approved-to-export`, `exported`, or `rejected`

---

## Bootstrap Workflow

When no wiki exists:

1. Inspect the working directory first.
2. Identify existing docs, configs, code structure, notes, exports, and obvious landmarks.
3. Create the smallest useful folder structure.
4. Create `schema/wiki-rules.md` describing the local contract.
5. Create `wiki/home.md` and `wiki/index.md`.
6. Create only a few grounded pages tied to the actual directory contents.
7. Log the bootstrap in `log/log.md`.

Before creating any page, ask:

- What exact files, folders, notes, or sources justify this page?
- Would updating an existing page be better than creating a new one?
- Will this page improve navigation, or is it just tidy-looking scaffolding?

Bootstrap should feel like laying down navigational rails, not building a cathedral.

---

## Ingest Workflow

When new material appears in `raw/`:

1. Read the new source.
2. Decide what kind of source it is: article, paper, transcript, meeting notes, product doc, export, mixed scratch notes, etc.
3. Create or update a source page in `wiki/sources/`.
4. Update related topic/entity pages with the durable knowledge from that source.
5. Mark uncertainty where the source is ambiguous, partial, or contradictory.
6. Update `wiki/index.md` if a new persistent page was added.
7. Append an ingest record to `log/log.md`.

If one source touches many pages, that is normal.

Do not treat provenance as a decorative backlink. Major sections should make it clear which source note or raw input they came from.

### Scientific paper ingest workflow

When the new source is a paper PDF, TeX bundle, paper Markdown, bibliography, or supplement:

1. **Classify the source bundle**: PDF, TeX entry file, included TeX sections, figures, tables, bibliography, supplements, converted Markdown, or metadata-only citation export.
2. **Extract safely**:
   - For PDFs, prefer a clean Markdown conversion path such as MarkItDown or a paper-conversion skill/tool when available.
   - For TeX, read the entry file and included section files directly when possible; preserve equations, labels, captions, and bibliography keys as evidence anchors.
   - If extraction is incomplete, continue with visible uncertainty instead of fabricating missing content.
3. **Create or update one stable paper source note** in `wiki/sources/` for the paper or source bundle. Do not create duplicate notes for corrected PDFs, revised TeX exports, or updated `.bib` files.
4. **Capture paper metadata**: title, authors, venue/year, DOI/arXiv ID, source path(s), conversion path, bibliography path, date ingested, confidence, and source drift signal when available.
5. **Extract the research map where accessible**: problem, key idea, method, assumptions, datasets, experiments, results, limitations, open questions, important equations, figures/tables, and references. Mark items that could not be extracted as uncertain or missing.
6. **Deduplicate before page creation**: search existing wiki index/source/topic pages for similar concepts, methods, claims, datasets, and acronyms. Merge into existing pages unless a new page clearly improves navigation.
7. **Apply an importance budget**: record paper importance or relevance. Low-importance papers should mostly update the source note and existing topics; high-importance papers may create a small number of new topic/shared pages.
8. **Update durable pages**: add only reusable concepts, methods, claims, datasets, limitations, comparisons, and open questions to topic/shared pages with backlinks to the paper source note.
9. **Optionally update local relationship artifacts**: append semantic edges, citation edges, a gap-map entry, context brief notes, or an ingest manifest entry if the local wiki already uses those artifacts.
10. **Log the ingest** in `log/log.md` with source identity, pages created/updated, conversion caveats, and review-needed items.

---

## Query Workflow

When the user asks a question that should compound into the wiki:

1. Read `wiki/index.md` first.
2. Follow the relevant topic/entity/source pages.
3. Check whether the maintained wiki is actually sufficient for the question.
4. If it is not sufficient, read the missing raw/source material, update the wiki first, then answer.
4. If the answer creates a valuable new artifact — comparison, synthesis, decision memo, glossary, taxonomy, timeline — file it back into `wiki/`.
5. Log the query if it materially changed the wiki.

High-value answers should not disappear into chat history if they would clearly help later.

---

## Bridge / Promotion Workflow

Use this when the project-local wiki has knowledge that should inform another repo, a global `llm-wiki`, an external vault, or a cross-project synthesis.

1. **Prove local grounding first**: read `wiki/index.md`, relevant topic/entity/source pages, and raw evidence anchors if needed.
2. **Classify the candidate**:
   - `concept`: reusable idea, pattern, method, or failure mode
   - `decision`: architecture or process choice that may guide other projects
   - `comparison`: reusable side-by-side evaluation
   - `entity`: named tool/system/org/person worth tracking globally
   - `anti-pattern`: failure mode that should become a future warning
3. **Create a bridge packet** in `wiki/bridges/<slug>.md` only when at least one is true:
   - the idea appears in multiple local pages or sources
   - the user explicitly asks for cross-project/global synthesis
   - the knowledge would prevent future rework in another project
   - the pattern is portable beyond this repo's file structure
4. **Do not write outside the current directory by default.** The bridge packet is the safe artifact. External/global updates require explicit user approval and a destination path.
5. **Record merge instructions**: proposed global page title, tags/taxonomy suggestions, outbound links, and what must remain local-only.
6. **Log the bridge action** in `log/log.md`.

### Bridge packet template

```markdown
# Bridge: <candidate title>

Status: candidate
Type: concept | decision | comparison | entity | anti-pattern
Proposed destination: <destination-wiki>/<page-or-slug>.md or <unknown>
Confidence: high | medium | low

## Local grounding
- Built from: [[topics/...]], [[sources/...]], raw/...

## Portable knowledge
- What should travel beyond this local wiki?

## What must stay local
- Repo-specific paths, transient implementation notes, or context that should not pollute the global wiki.

## Merge risks / contradictions
- Existing global pages that may conflict
- Claims needing human review

## Suggested global links/tags
- Related global pages or likely tags
```

---

## Maintenance Workflow

Periodically check for:

- broken or stale links
- orphan pages with no inbound path
- duplicate or near-duplicate topics
- weak openings that do not tell the reader what the page is for
- source notes that were never integrated into topic pages
- pages that became obsolete after newer sources arrived
- index drift, where `index.md` no longer reflects reality
- bridge drift, where `wiki/bridges/` candidates were exported or rejected but not marked
- tag/schema drift, where pages invent incompatible labels or page types
- contradiction drift, where conflicting claims are noted in source pages but not surfaced in topic pages
- source drift, where raw/source files changed since the source note was created when hashes or timestamps are available

Fix what is clearly safe. Flag what needs human judgment.

Always leave a concise maintenance report.

### Lightweight health gates

When maintaining a wiki, check these before claiming success:

| Gate | Pass condition |
|---|---|
| Boundary | No page silently widens scope beyond the current directory |
| Navigation | Important pages are reachable from `wiki/home.md` or `wiki/index.md` |
| Provenance | Durable claims point to source notes, raw files, or repo landmarks |
| Paper ingest | Paper metadata, claims, methods, citations, figures/tables, limitations, and open questions are traceable to source notes or raw files |
| Promotion | Cross-project claims are represented as bridge packets, not hidden external edits |
| Cluster boundaries | Clustered wiki sections, if present, are evidence-driven and still inside the current working directory |
| Shared pages | `wiki/shared/` contains cross-cluster concepts, not a catch-all `misc` dump |
| Contradictions | Conflicting claims are explicitly marked and routed to human review when unsafe |
| Drift | Source/hash/timestamp changes are flagged instead of silently normalized |

---

## Provenance Pattern

Use lightweight provenance. Do not turn every sentence into citation soup.

Good enough patterns include:

- `Source: [[sources/article-name]]`
- `Derived from: raw/interview-2026-04-06.md`
- `Evidence: [[sources/vendor-api-notes]]`
- `Uncertain: this claim appears in one partial transcript only`

When sources conflict, say so explicitly.

At minimum, each durable page should let a future reader answer:

- which sources or repo landmarks shaped this page?
- where should I go to verify the main claims?

---

## Minimal `log/log.md` Format

Use parseable headings so recent activity is easy to scan.

```markdown
## [2026-04-06] bootstrap | initialized local wiki
- Created wiki/home.md, wiki/index.md, schema/wiki-rules.md
- Seeded topic pages for project structure and workflow

## [2026-04-06] ingest | vendor-api-export
- Added source page: wiki/sources/vendor-api-export.md
- Updated topics/integration-pitfalls.md
```

Keep it append-only.

---

## `schema/wiki-rules.md` Must Capture

When bootstrapping, document the local rules for future sessions:

- the scope boundary of the wiki
- the exact locality boundary (current folder, subproject, or full repo)
- what belongs in `raw/` vs `wiki/`
- page naming conventions
- whether wiki links or normal markdown links are preferred
- provenance style
- when a new page is allowed versus when an existing page must be updated
- how repeated ingest updates existing pages without duplication
- how maintenance reports should be recorded
- whether bridge packets are allowed, where they live, and what approval is required before external export
- whether umbrella-domain clusters are allowed, what justifies a cluster, and when a cluster should split into a separate wiki
- what may live in `wiki/shared/`, if that folder exists
- whether scientific-paper mode is used, which paper metadata fields are required, and whether local graph/citation/gap/context artifacts are enabled
- the local tag/type vocabulary if the wiki needs one; keep it small and document new labels before using them widely
- how contradictions, confidence, and source drift should be represented

This is what turns a generic markdown pile into a disciplined maintained wiki.

---

## Anti-Patterns

Do **not** do these:

- create a giant universal vault when the user asked about one project
- dump all ingested knowledge into one long summary page
- duplicate existing README content without adding navigation value
- invent folders and pages with no grounding in the actual directory
- create scaffolding that mirrors folder names or README headings without adding synthesis
- rewrite `raw/` as if it were polished wiki content
- treat a scientific paper as a giant standalone summary with no metadata, methods, evidence anchors, citation context, or topic integration
- create a new topic page for every paper section, figure, acronym, or citation without deduplication and navigation value
- erase uncertainty from partial or conflicting sources
- merge pages aggressively when overlap might reflect different purposes
- add indexes everywhere; add them only where navigation actually benefits
- silently write into a global wiki because a local pattern seems broadly useful
- refuse all cross-project synthesis because the wiki is local; create a bridge packet instead
- let every project invent incompatible bridge/status/confidence labels without recording the local convention

---

## Good Output Standard

After using this skill, the working directory should feel like this:

- a future agent can open `wiki/home.md` and orient quickly
- the wiki structure is small, local, and legible
- new sources can be added without redesigning everything
- important claims can be traced back to source notes or raw material
- the wiki gets richer over time instead of noisier
- cross-project/global relevance is captured as explicit bridge packets rather than leaking across boundaries

That is the point of llm-wikify: **persistent, compounding project knowledge without the cost of maintaining a giant all-purpose knowledge base.**

# Cora review — obsidian-semantic-memory

Date: 2026-03-31
Reviewer: Cora
Status: **RESOLVED 2026-03-31** — all Priority 1 and Priority 2 items addressed (see git log)

## Resolution summary

| Priority | Item | Status |
|----------|------|--------|
| P1 | README.md | ✅ Added |
| P1 | Version alignment (package.json vs CLI) | ✅ Fixed (1.0.0) |
| P1 | Provider support truthful (local accepted, not stubbed) | ✅ Fixed |
| P1 | API trust assumptions documented | ✅ In README |
| P1 | `author` in package.json | ✅ Fixed |
| P2 | MCP `osm mcp` command | ✅ Added |
| P2 | Graph chunk selection query (ROW_NUMBER OVER PARTITION) | ✅ Fixed |
| P2 | Versioned migration system | ✅ Added |
| P2 | Local provider wired into CLI setup() | ✅ Fixed |
| P3 | gpt-tokenizer (precise token counts) | ✅ Done |
| P3 | H3 heading support in chunker | ✅ Done |
| P3 | Time-decay recency (replaced path-based) | ✅ Done |

Remaining open (P3, non-critical for v1):
- Entity resolution: cross-note deduplication
- Fact representation: LLM facts still use semi-structured object_text
- Reranking / retrieval evaluation framework
- Query tokenization for multilingual text

---

## Scope and honesty policy

This review is based on direct inspection of the repository structure and these files:

- `package.json`
- `tsconfig.json`
- `src/cli.ts`
- `src/config.ts`
- `src/db/schema.ts`
- `src/indexer/parser.ts`
- `src/indexer/chunker.ts`
- `src/indexer/pipeline.ts`
- `src/retrieval/orchestrator.ts`
- `src/api/server.ts`
- `tests/config.test.ts`
- `tests/edge-cases.test.ts`
- ignore files and top-level structure

I did **not** fully inspect every source file in the repo, so anything below should be read as:

- confident where I point to code I actually read
- moderately confident where I infer architecture from naming and call sites
- explicitly uncertain where I would need another pass or runtime testing

I am not going to flatter this project. It is promising, but there are clear product, architecture, and retrieval-quality gaps. It already looks more serious than a throwaway prototype, but it is not yet something I would call robust or production-hardened.

---

## Executive summary

My overall assessment:

- **Concept:** strong
- **Architecture direction:** good
- **Implementation maturity:** mid-stage prototype / early serious system
- **Retrieval sophistication:** better than naive semantic search, but still fairly shallow
- **Operational polish:** weak
- **Documentation and user entrypoint:** poor
- **Long-term maintainability:** decent bones, but some contracts are currently misleading

The project has a real shape:

1. ingest Obsidian notes
2. parse frontmatter / body / links
3. chunk and index
4. store structured artifacts in SQLite
5. store embeddings in a vector index
6. retrieve via semantic + entity + graph + fact boosts
7. expose via CLI / watcher / HTTP API

That is a legitimate memory architecture. I like the direction.

But there are also clear signs that the system is still half product, half experiment:

- missing documentation
- incomplete provider abstraction
- retrieval heuristics that are useful but rough
- some DB and query choices that are “works for now” rather than principled
- API surface that assumes trust
- facts model that is only partially normalized

If I had to compress the whole review into one sentence:

> This is a smart and credible prototype with good instincts, but it still needs one hard pass focused on contracts, retrieval quality, and product rigor before I would trust it as a durable personal-memory foundation.

---

## What is genuinely good

## 1. The project has a coherent architecture

This is probably the strongest thing about it.

The code layout suggests clear subsystem separation:

- config
- db schema / client
- parser / chunker / walker / pipeline
- embeddings provider and vector index
- retrieval orchestration
- watcher
- HTTP API
- memory writer

That separation matters. A lot of “semantic memory” projects become unmaintainable because indexing, retrieval, storage, and API logic blur together into one giant script. This one does not appear to be doing that.

That does **not** mean every boundary is clean. But the architectural intent is visible and mostly sane.

## 2. SQLite is the right default for this kind of project

Using `better-sqlite3` plus a local vector index is a strong choice for a personal Obsidian memory system.

Why I think this is right:

- local-first fits the problem
- easy inspection and backup
- low operational burden
- simpler than standing up pgvector / qdrant / milvus / whatever
- good enough scale for a personal vault in most cases

There is a lot of cargo-culting around vector databases. For a personal memory assistant, SQLite is often the adult choice.

## 3. Retrieval is not purely embedding-driven

This is one of the best signs in the code.

In `src/retrieval/orchestrator.ts`, retrieval is not just:

- embed query
- cosine similarity
- return top k

Instead there is an attempt to combine:

- semantic hits
- priority path boost
- entity match boost
- graph expansion via relations
- fact-aware boosting
- slight recency bump for `/Daily/`

That is good instinct. Personal memory retrieval usually fails if you treat everything as anonymous chunks in vector space.

The current implementation is still rough, but the *shape* is right.

## 4. The code shows evidence of learning from real failure modes

The pipeline code in `src/indexer/pipeline.ts` is probably the strongest file I reviewed.

Specifically:

- old vectors are deleted after transaction commit, not before
- note hashes are handled in two phases when embeddings are involved
- embedding count mismatch is at least logged
- `LIKE` patterns escape `%`, `_`, and `\\`

Those are not cosmetic improvements. They look like fixes that came from actual contact with bugs.

That gives me more confidence than pristine-looking code with no scars.

## 5. Test coverage includes meaningful edge cases

The tests I saw are not amazing coverage overall, but they are pointed in useful directions:

- Unicode aliases
- Arabic / Cyrillic / CJK content
- wikilink edge cases
- chunking edge cases
- ignore patterns in walking the vault
- config validation

That is better than the classic “1 trivial parser test and vibes.”

---

## Major criticisms

## 1. Missing README is not a cosmetic issue — it is a product failure

There is no `README.md` at the repo root.

That sounds small. I do not think it is small.

For a project at this stage, the README should answer at minimum:

- what the system does
- what the architecture is
- what features are complete vs experimental
- how to install dependencies
- required env vars
- how to run `index`
- how to run `watch`
- how to run `serve`
- where data is stored
- whether the API is localhost-only
- what embedding providers are actually supported
- known limitations

Without that, the project has no trustworthy entrypoint. That hurts:

- future-you
- contributors
- operational repeatability
- debugging
- any realistic adoption beyond “the author currently remembers how it works”

A missing README at this maturity level usually means one of two things:

1. the author is still changing the mental model too quickly to document it
2. the author knows the system locally, but has not yet done the work of turning it into a stable tool

Neither is fatal, but both mean the product boundary is still weak.

### Why I care so much about this

Semantic-memory systems are already cognitively slippery. They involve:

- embeddings
- indexing policy
n- chunking behavior
- storage layout
- recency semantics
- trust and privacy assumptions

If you do not document those, people will infer the wrong model and mis-use the system.

---

## 2. The provider abstraction is misleading

In `src/config.ts`:

- `embeddingProvider` is typed as `'openai' | 'local'`
- but `local` immediately throws as unimplemented

This is a bad public contract.

### Why this is a real problem

An interface should represent supported reality. Right now the config shape implies there are two provider modes, but only one actually exists.

That causes several problems:

- it lies to users and future maintainers
- it encourages conditionals around a non-existent capability
- it creates the illusion of modularity without delivering it
- it delays the moment when the code is forced to confront the real provider interface

### What this says architecturally

The project wants to be provider-abstracted, but it is not actually there yet.

That is fine. What is not fine is pretending the abstraction exists when it does not.

### My blunt recommendation

Pick one:

- **Option A:** remove `local` from the public config until it exists
- **Option B:** implement a real local embedding provider now

Do not keep the fake branch around unless it is behind an explicitly experimental flag and documented as stubbed.

---

## 3. Startup/setup path is too tightly coupled to OpenAI

In `src/cli.ts`, `setup()` does this immediately:

- loads config
- opens DB
- runs migrations
- creates `OpenAIEmbeddingProvider(config.openaiApiKey!)`
- creates vector index
- maybe creates a fact extractor using OpenAI client

This means the whole runtime is strongly coupled to OpenAI at setup time.

### Why I dislike this

The project presents itself as a memory system, but operationally it behaves like an OpenAI-powered memory system first and a general local memory substrate second.

That leads to avoidable brittleness:

- commands become harder to run in degraded/offline modes
- the provider abstraction loses credibility
- testing and tooling become more annoying
- “just inspect the DB / run a local retrieval mode / run maintenance” becomes entangled with network provider assumptions

Even if today all user-facing flows require embeddings, the setup contract is still too eager.

### More subtle issue

The codebase appears to want layered responsibilities, but this setup path collapses concerns:

- config validation
- storage setup
- embedding backend selection
- extraction model wiring

Those do not all need to happen at the same point.

A more mature design would instantiate only what a command actually needs.

---

## 4. Chunking is practical but crude, and retrieval quality will hit this ceiling

In `src/indexer/chunker.ts`, token estimation is:

```ts
const tokens = (s: string) => Math.ceil(s.length / 4);
```

That is an acceptable rough heuristic for a prototype. It is **not** something I would trust as the long-term basis for chunk sizing if retrieval quality matters.

### Problems with char-count token estimation

It will distort differently across:

- English prose
- Russian text
- mixed markdown
- code blocks
- lists
- YAML frontmatter-ish structures
- URLs and wikilinks

The result is not just “slightly imprecise.” It can create unstable chunk boundaries, which then affects:

- embedding quality
- retrieval relevance
- overlap utility
- consistency across reindex runs when content changes

### Heading strategy is also quite narrow

`splitByHeadings()` only splits on `#` and `##`.

This is a pragmatic simplification, but Obsidian notes often carry important semantic structure in:

- `###` sections
- callouts
- bullet groups
- task lists
- block references
- frontmatter fields
- tables
- quoted excerpts

Ignoring deeper heading structure may be fine for broad notes, but it will underperform on detailed project notes or technical notes.

### Overlap implementation is serviceable, but still heuristic-heavy

The paragraph-overlap logic is understandable and not insane. But it is another sign the project is tuned by intuition rather than measurement.

That is okay early on. It becomes a problem if retrieval relevance starts disappointing and you no longer know whether the issue is:

- chunk size
- overlap size
- paragraph boundaries
- heading boundaries
- semantic model quality
- ranking logic

### Summary

Current chunking is not “wrong.” It is simply a bottleneck waiting to become visible.

---

## 5. Retrieval ranking is promising but under-principled

`src/retrieval/orchestrator.ts` is a good start, but it currently feels like a set of hand-tuned boosts rather than a stable ranking framework.

### What it currently does well

- merges several useful signals
- boosts likely relevant domains via `priorityPaths`
- adds graph expansion
- checks facts for lexical overlap

### What feels weak

#### a) Score calibration is arbitrary

Examples:

- `+0.1` for priority paths
- `+0.2` for entity match
- `+0.05` for daily notes
- `+0.15` for fact match
- graph hits get flat `0.3`

These may be fine as initial heuristics, but they are not grounded in evaluation.

That means a future bug report like “search feels wrong for project notes” will be hard to debug because the system is essentially a pile of additive magic numbers.

#### b) Graph expansion quality is weak

`getBestChunksForNotes()` does:

```sql
SELECT ...
FROM chunks WHERE note_path IN (...)
GROUP BY note_path
ORDER BY token_count DESC
LIMIT ?
```

That is suspicious.

In SQLite, `GROUP BY note_path` without clear aggregation on the selected chunk columns does not mean “best chunk per note” in a semantically principled way. It usually means “some representative row,” with behavior that is often implementation-dependent or at least not meaningfully tied to relevance.

So graph expansion exists, but the chunk selected from related notes may be effectively arbitrary.

This is one of the biggest concrete quality concerns I saw.

#### c) Fact matching is lexical and shallow

The fact-aware boost checks whether lowercased query words appear in:

- `object_text`
- `predicate`

That is easy to implement, but it is only lightly semantic.

You end up with a hybrid system where facts are structured in the DB but queried mostly as strings.

That may still help, but it means the facts subsystem is not yet pulling its full weight.

#### d) Recency is under-modeled

`/Daily/` notes get a flat bump. That is not really recency modeling. It is path-based prior.

A more serious memory system probably wants some combination of:

- actual note modified date
- actual memory write date
- time decay by age
- stronger recency for recent days, weaker beyond threshold
- task-specific recency weighting

Right now the model is only lightly pretending to care about time.

### The good news

This area is fixable. The architecture is open enough that ranking can be improved incrementally.

### The bad news

Today’s retrieval quality is likely more fragile than it appears from the code structure.

---

## 6. Facts are only half normalized

The schema for `facts` is actually decent-looking at first glance:

- `subject_entity_id`
- `predicate`
- `object_text`
- optional `object_entity_id`
- provenance-ish fields
- validity-ish fields

That is promising.

But then the pipeline underuses that structure.

### Frontmatter extraction

The frontmatter extraction of:

- owner
- status
- updated
- tags

is straightforward and probably useful.

### LLM facts

For LLM-extracted facts, the code inserts:

```ts
`${fact.subject}: ${fact.object}`
```

into `object_text`, while the actual `subject_entity_id` is the note-level entity.

This is a compromise that sacrifices structure.

### Why I think this is a problem

It means the fact system wants to be a graph-ish store, but the extraction path dumps semi-structured text back into strings.

Consequences:

- harder filtering
- harder deduplication
- harder conflict resolution
- weaker entity resolution later
- weaker temporal reasoning
- harder UI explanation of “why this fact exists”

### Is this acceptable for v1?

Yes, as a bootstrapping move.

### Is this where the design will start hurting if the project grows?

Also yes.

This is one of those areas where you can get away with mushy representation for a while, then suddenly every improvement becomes harder because your data model is semantically ambiguous.

---

## 7. Entity model is likely too simplistic for durable personal memory

What I saw suggests one note creates one canonical entity row sourced from that note:

- type from frontmatter kind or `note`
- canonical name from parsed title
- aliases from frontmatter aliases
- source note = current file

That is reasonable for a first pass. But for real-world personal knowledge, entity identity is where systems get complicated fast.

### Potential problems

- same person across multiple notes
- note rename causing canonical drift
- aliases overlapping with other entities
- projects and people sharing names or short aliases
- note title not being the best canonical entity name
- unresolved links remaining disconnected until later indexing order catches up

None of these are unusual. They are normal.

The current model may work well enough for a curated vault, but it does not yet look ready for messy organic note collections.

### What worries me most

The relation lookup path for wikilinks resolves target entities by:

- matching note path via `LIKE %/<wikilink>.md`
- or canonical name exact match

This is pragmatic, but brittle.

It can produce ambiguity and false positives, especially in larger vaults or with repeated names.

---

## 8. API surface assumes a trusted environment too casually

`src/api/server.ts` exposes endpoints including:

- POST `/retrieve-context`
- GET `/entity/:name`
- GET `/facts/:entityId`
- GET `/search`
- POST `/memory/daily`

I did not see authentication, authorization, or explicit localhost-only enforcement in the inspected code.

### If this is intended as localhost-only

Then that assumption should be made explicit in:

- docs
- startup logs
- maybe even code defaults

### Why I care

A memory system is not a toy API. It may expose:

- private notes
- relationship information
- facts about the user
- task/project state
- daily logs

And `/memory/daily` is a write endpoint.

Even if the current deployment is safe, I strongly dislike memory systems that behave securely only because the operator happens not to expose the port.

### I am not saying this is a disaster

I am saying the project should decide which it is:

- **strictly local developer tool**
- **private network service**
- **something intended for wider exposure**

Right now it feels like category 1 implemented in a way that could easily drift toward category 2 without enough guardrails.

---

## 9. Operational ergonomics are weak

This is where the project still feels early.

### Signs:

- no README
- env-var-heavy setup
- incomplete provider story
- no visible example config
- no obvious health/status command
- no clear migration/versioning story beyond schema creation

### Why it matters

Personal memory systems are long-lived systems. They need:

- recoverability
- inspectability
- debuggability
- low-friction reindexing
- confidence about what is indexed and what is ignored

The project does some of this, but it does not yet *present* itself as a durable operator-friendly tool.

It still presents more like “a capable internal prototype.”

---

## 10. Testing is pointed, but coverage still seems strategically uneven

The tests I saw are useful, but the strongest risk areas are not where most of the testing effort appears concentrated.

### Tested reasonably well:

- config validation
- parser Unicode edge cases
- chunker edge cases
- vault walking ignore behavior

### What I would still worry about:

- transactional correctness under repeated reindex
- vector/index DB consistency after failures
- watcher behavior on rapid file edits / renames / deletes
- retrieval ranking regressions
- relation resolution ambiguity
- API behavior under malformed inputs
- rebuild correctness
- concurrency edge cases in indexing

The current test suite signals care, but not full confidence.

---

## File-by-file criticism

## `package.json`

### Good

- scripts are minimal and clear
- dependencies broadly match project goals

### Criticism

- `description` is empty
- `author` is empty
- `main` is `index.js`, which looks odd if the actual built entry is `dist/cli.js`
- there is no obvious packaging clarity around whether this is a CLI, library, or service

This is small, but it contributes to the overall “not fully productized” feel.

---

## `src/config.ts`

### Good

- validation exists
- chunk params are checked sensibly
- concurrency is clamped

### Criticism

#### Misleading provider union

Already covered above. Biggest design issue in this file.

#### Priority paths default is very opinionated

```ts
priorityPaths: (process.env.PRIORITY_PATHS ?? 'OpenClaw Memory/,Projects/,Infrastructure/').split(',')
```

This bakes in assumptions about vault structure that may be correct for your use case, but it is not generic.

That is fine if the project is intentionally personal-first. Less fine if you want reuse.

#### LLM extraction as boolean flag is too coarse

`LLM_EXTRACTION === 'true'` works, but it does not model:

- extraction provider
- model
- rate limiting
- extraction scope
- max note size
- retry policy
- cost control

Not a bug, just a sign this subsystem is immature.

---

## `src/cli.ts`

### Good

- command surface is understandable
- `index`, `search`, `watch`, `serve`, `rebuild` is a sensible first set

### Criticism

#### Setup is too eager and too global

Already discussed. I would strongly consider command-specific wiring instead of one monolithic `setup()`.

#### `rebuild` is destructive in spirit, but UX is blunt

This is a local dev tool, so maybe that is okay. Still, `rebuild`:

- drops vector table
- clears derived tables
- reindexes

That is acceptable, but it would benefit from:

- explicit logging of what is being deleted
- maybe `--yes` or confirmation for interactive use
- a dry-run or stats mode elsewhere in CLI

#### Version mismatch

`program.version('0.1.0')` while `package.json` says `1.0.0`

This is small but sloppy. It suggests release/version discipline is not settled.

That is exactly the kind of thing that causes confusion later.

---

## `src/db/schema.ts`

### Good

- schema is actually not bad
- normalized enough to be useful
- separate notes/chunks/entities/facts/relations is the right instinct

### Criticism

#### Migration system is really just DDL-if-not-exists bootstrapping

`runMigrations()` just iterates `CREATE TABLE IF NOT EXISTS` and indexes.

That is okay at the beginning, but it is not a true migration system.

Once schema evolution starts, this approach gets painful.

#### Missing indexes may become visible later

I did not audit query plans, but based on retrieval paths I would expect future need for indexes on things like:

- `relations.source_entity_id`
- `relations.target_entity_id`
- `entities.source_note`
- maybe `chunks.note_path, token_count`
- `facts.subject_entity_id`

Maybe some are unnecessary today. But I would not be surprised if retrieval cost degrades as the vault grows.

#### No uniqueness or dedupe constraints where they may eventually matter

For example, duplicate facts or duplicate relations may creep in depending on reprocessing strategy and future pipeline changes.

---

## `src/indexer/parser.ts`

### Good

- simple and readable
- title detection is straightforward
- wikilink normalization strips aliases and headings

### Criticism

#### Simplicity may hide semantic loss

`title` comes from first `# heading` or basename.

That is often fine, but in Obsidian some notes intentionally use:

- frontmatter title
- no H1 title
- different display name conventions

This parser is simple enough that some vault conventions will not be modeled faithfully.

#### Wikilink parsing is intentionally narrow

Again, not wrong. But things not obviously handled include:

- embeds vs links semantics
- block refs
- transclusions
- escaped brackets in weird content
- alias-heavy linking conventions

This may be acceptable for current goals, but it is not a complete Obsidian semantic parser.

---

## `src/indexer/chunker.ts`

### Good

- compact and understandable
- overlap support exists
- heading-aware segmentation exists

### Criticism

Already covered above, but additional notes:

#### Returning a whitespace chunk fallback is slightly awkward

If a note body is empty/whitespace, the fallback chunk can still be pretty low-value. That may be okay for pipeline invariants, but it is likely to produce junk rows for some notes.

#### Line offsets under overlap and paragraph recomposition deserve suspicion

I did not fully verify line/offset correctness through all overlap paths. This is an area where off-by-one or misleading provenance can creep in.

I would want tests specifically focused on start/end line integrity after overlap-induced backtracking.

---

## `src/indexer/pipeline.ts`

### Good

This is the most impressive file I inspected.

Reasons:

- tries to separate transactional DB work from async embedding work
- avoids one obvious vector consistency trap
- handles unchanged-file skip
- captures frontmatter facts and link relations
- includes some thoughtful comments explaining fixes

### Criticism

#### Still complex enough to be fragile

This function is accumulating multiple responsibilities:

- read file
- hash and change detection
- parse note
- upsert note/chunks/entities/facts/relations
- vector deletion
- embedding generation and insert
- LLM fact extraction

It is still manageable, but it is becoming a “core god-function.”

That is the file I would watch most closely for future complexity creep.

#### Embedding mismatch handling is only partial

Logging mismatch is better than silence, but the system can still continue into a partially indexed state.

Maybe that is acceptable. Maybe not. But it is a real consistency tradeoff.

#### Entity creation strategy may be too eager

Every indexed note appears to create a fresh entity row tied to itself. That is simple, but it may over-entity-ize the vault, especially for notes that are not actually “entities” in any meaningful semantic sense.

#### Frontmatter fact predicates are hard-coded

```ts
const FACT_PREDICATES = ['owner', 'status', 'updated', 'tags'] as const;
```

That is okay for a personal project, but architecturally it is brittle.

Either the system should:

- clearly document that these are the only canonical extracted predicates
- or make the mapping configurable

Right now it sits in between.

#### Relation resolution by `LIKE %/<wikilink>.md` can get weird

You already guarded the pattern escaping, which is good. But semantic correctness is still questionable when multiple notes can satisfy the tail-path pattern.

This is one of those “good enough until the vault gets messier” decisions.

---

## `src/retrieval/orchestrator.ts`

### Good

This file has the right ambition.

### Criticism

#### `GROUP BY` query for representative chunks is not trustworthy

This is the single most concrete retrieval bug risk I noticed.

If the intention is “one best chunk per related note,” the current SQL does not convincingly implement that.

#### Ranking logic is encoded as ad hoc mutation

That makes experimentation easy, but explainability and regression control harder.

A next step might be to structure ranking as explicit signal computation, then weighted combination, then optional rerank.

#### Query tokenization is weak

```ts
query.toLowerCase().split(/\s+/)
```

That is very rough for:

- punctuation
- multilingual text
- quoted entities
- special path-like terms
- abbreviations

Not catastrophic, but shallow.

---

## `src/api/server.ts`

### Good

- minimal and straightforward
- useful endpoints for early integration

### Criticism

#### No visible trust boundary

This is the big one.

#### `/memory/daily` as append endpoint is powerful and under-governed

This could be great, but it also means external callers can shape the memory corpus. That is something I would want treated as a deliberate, audited capability, not just “here’s a route.”

#### Error handling is basic

Fine for local use. Not robust for broader deployment.

---

## `tests/config.test.ts`

### Good

Solid practical validation coverage.

### Criticism

This file is better than the project docs, which is mildly funny and not ideal.

Some of the config contract is clearer from the tests than from any human-facing project description.

---

## `tests/edge-cases.test.ts`

### Good

This test file reflects real-world note weirdness better than many projects do.

### Criticism

The project may currently be over-invested in parser/chunker edge cases relative to retrieval evaluation.

That is not bad, but I would now want more tests around:

- ranking outcomes
- relation correctness
- consistency after update/rebuild cycles
- deletion semantics

---

## Strategic concerns

## 1. The project does not yet clearly decide whether it is personal-specific or reusable

There are signs pointing both ways.

### Personal-specific signs

- default priority paths assume a particular vault shape
- Obsidian memory context looks very tailored
- overall concept is tied to a specific assistant workflow

### Reusable-tool signs

- generic CLI naming (`osm`)
- provider abstraction attempt
- API surface
- tests written as if this is a standalone package

It can be both eventually, but right now it feels undecided.

That indecision leaks into design:

- some defaults are highly personal
- some abstractions are generic but unfinished
- docs are absent, so intended audience is unclear

This is not fatal. But I think the project would improve if it picked one of these identities first:

- **my personal memory engine**
- **a reusable Obsidian semantic memory tool others can install**

The implementation details differ.

---

## 2. The project has “clever prototype” energy more than “reliable memory substrate” energy

This is not an insult. It is an accurate maturity read.

What I mean:

- strong ideas are present
- useful structure exists
- several pragmatic fixes have already happened
- but system contracts still feel fluid
- product boundaries are underdocumented
- reliability assumptions are not made explicit enough

For a memory system, reliability and clarity matter more than cleverness.

If this becomes a true personal memory backbone, the next phase should optimize for:

- trustworthiness
- explicit behavior
- explainability
- recoverability
- boring correctness

not just more retrieval tricks.

---

## 3. Local embeddings are not optional in the long run

This is one of my strongest strategic opinions.

For a project called something like `obsidian-semantic-memory`, a future without local embeddings is weak.

Reasons:

- privacy
- cost
- latency
- offline resilience
- bulk reindex practicality
- independence from provider churn

OpenAI support is fine. Depending on it as the only real path is not where I would want this project to stay.

---

## What I would fix first

## Priority 1 — Make the project honest

1. Add a real `README.md`
2. Align versioning (`package.json` vs CLI version)
3. Make provider support truthful
4. Explicitly document trust assumptions for API

## Priority 2 — Improve reliability contracts

5. Refactor setup so commands instantiate only needed dependencies
6. Improve graph chunk selection query
7. Add more retrieval/regression tests
8. Add true migration/versioning story before schema drift starts hurting

## Priority 3 — Improve memory quality

9. Rework chunking/token estimation or at least make it swappable
10. Improve fact representation and entity resolution
11. Add stronger time/recency modeling
12. Add optional reranking or evaluation framework

---

## Specific things I would not overreact to

To keep this fair: not everything rough here is a crisis.

I would **not** call these urgent problems yet:

- using heuristic token counts in v1
- hard-coded frontmatter predicates in early versions
- simple Express handlers for local-only use
- one-file orchestration functions in an early-stage codebase

Those are acceptable *if* the project is honest about being early and local-first.

The real problems are where the project currently implies more maturity or generality than it fully delivers.

---

## My real bottom line

I think this is a good project.

Not “polished,” not “finished,” and not “I trust every retrieval result yet.” But good.

It has the two hardest things to fake:

- a useful architectural shape
- signs of contact with real bugs and real use

That said, I would not lie to you: if I were adopting this as a serious external memory layer today, I would still be cautious.

Why?

Because the weak points are exactly the ones that matter in a memory system:

- retrieval trust
- semantic consistency
- operational clarity
- explicit contracts
- privacy boundary assumptions

So my honest rating is something like:

- **idea:** 8/10
- **current implementation quality:** 6.5/10
- **retrieval sophistication:** 6/10
- **future potential:** 8.5/10
- **current product readiness:** 5.5/10

That is not a dunk. It is a serious compliment with serious caveats.

If you want, I can do a second pass and turn this into:

- a prioritized issue list
- a concrete refactor plan
- or a PR-sized roadmap with suggested file changes

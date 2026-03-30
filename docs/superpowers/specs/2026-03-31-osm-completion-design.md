# obsidian-semantic-memory: Completion & MCP Design

**Date:** 2026-03-31
**Status:** Approved
**Scope:** Universalize the project, add MCP server for agent connectivity, improve retrieval quality, add local embeddings, fill test gaps.

---

## 1. MCP Server

### Overview
MCP server as the primary interface for AI agents (Claude Code, Cursor, etc.). Uses stdio transport. Reuses existing subsystems directly — no HTTP layer in between.

### Entry point
New file: `src/mcp/server.ts`
New CLI command: `osm-memory mcp` (starts MCP server on stdio)

### Tools (6 total)

**Read tools:**

| Tool | Input | Output | Maps to |
|------|-------|--------|---------|
| `memory_search` | `{ query: string, topK?: number }` | Array of hits with notePath, text, score, reason | `retrieval/orchestrator.ts` |
| `memory_entity` | `{ name: string }` | Entity object or null | `retrieval/entityLookup.ts` |
| `memory_facts` | `{ entityName: string }` | Array of facts | DB query: facts by entity name lookup |
| `memory_status` | `{}` | `{ notes, chunks, entities, facts, relations }` counts | DB count queries |

**Write tools:**

| Tool | Input | Output | Maps to |
|------|-------|--------|---------|
| `memory_remember` | `{ text: string, date?: string, source?: string }` | `{ ok: true, path: string }` | `memory/writer.ts` |
| `memory_store_fact` | `{ subject: string, predicate: string, object: string, confidence?: number }` | `{ ok: true, factId: number }` | DB insert: entity lookup/create + fact insert |

### Dependencies
- `@modelcontextprotocol/sdk` — MCP protocol implementation

### Setup for agents
Users add to `claude_desktop_config.json` or `.claude/settings.json`:
```json
{
  "mcpServers": {
    "osm-memory": {
      "command": "node",
      "args": ["path/to/dist/mcp/server.js"],
      "env": {
        "VAULT_PATH": "/path/to/vault",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

---

## 2. Local Embeddings

### Provider
New file: `src/embeddings/local.ts`
Implements existing `EmbeddingProvider` interface.

### Model
- Library: `@xenova/transformers` (ONNX runtime, runs locally)
- Default model: `Xenova/all-MiniLM-L6-v2` (384 dimensions, ~23MB)
- Model cache: `~/.cache/osm-memory/models/`
- Configurable via `EMBEDDING_MODEL` env var

### Config changes
- `EMBEDDING_PROVIDER=local` now works (no longer throws)
- `EMBEDDING_MODEL` — optional override (default: `Xenova/all-MiniLM-L6-v2`)
- `OPENAI_API_KEY` no longer required when provider is `local`

### Dimension handling
Vector index already takes dimensions from provider. On provider switch, user must `rebuild` (dimensions change: 1536 vs 384). Rebuild command logs a warning if existing embeddings have different dimensions.

---

## 3. Universalization

### Default changes
| Setting | Old default | New default |
|---------|------------|-------------|
| `PRIORITY_PATHS` | `OpenClaw Memory/,Projects/,Infrastructure/` | empty string (no boosts) |
| Memory dir (daily notes) | hardcoded `OpenClaw Memory/Daily/` | `MEMORY_DIR` env var, default `Memory/Daily/` |

### Config additions
| Env var | Default | Description |
|---------|---------|-------------|
| `MEMORY_DIR` | `Memory/Daily/` | Relative path within vault for daily memory notes |
| `EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Model name for local embeddings |

### package.json
- `bin`: `{ "osm-memory": "dist/cli.js" }` for global CLI install
- `keywords`: `["obsidian", "semantic-memory", "mcp", "embeddings", "knowledge-graph"]`

### CLI lazy init
Refactor `setup()` into composable parts:
- `setupDb(config)` — open DB + run migrations
- `setupStack(config, db)` — create provider + vector index + fact extractor
- Each command calls only what it needs

---

## 4. Retrieval Quality

### Token estimation
- Replace `Math.ceil(s.length / 4)` with `gpt-tokenizer` encode().length
- `gpt-tokenizer` is lightweight, offline, accurate BPE tokenization
- Affects: chunker token counting, chunk size decisions

### Chunking: H3 support
- Add `###` to `splitByHeadings()` regex
- Heading stack becomes: H1 > H2 > H3
- Minimal change, meaningful improvement for technical/structured notes

### Recency: time decay
Replace path-based recency (`if includes('/Daily/')`) with actual time decay:
```typescript
const daysSince = (Date.now() - new Date(note.modified_at).getTime()) / 86400000;
const recencyBoost = Math.max(0, 0.1 * (1 - daysSince / 30));
```
- Linear decay over 30 days
- Max boost: +0.1 for notes modified today
- Zero boost after 30 days
- Uses `modified_at` from notes table (already stored)

---

## 5. Schema & Migrations

### Migration system
New table: `schema_version` with single `version INTEGER` field.

Migration runner:
1. Read current version (0 if table doesn't exist)
2. Apply migrations with version > current, in order
3. Update version after each successful migration
4. All inside a transaction

### Migrations
- `001_initial` — current DDL (CREATE TABLE IF NOT EXISTS for all tables + existing indexes)
- `002_uniqueness_constraints` — add UNIQUE constraints:
  - `UNIQUE(source_entity_id, relation, target_entity_id)` on relations
  - `UNIQUE(subject_entity_id, predicate, object_text)` on facts

### Implementation
Migrations are functions in `src/db/migrations/` directory, registered in order. `runMigrations(db)` applies pending ones.

---

## 6. Tests

### API server tests (`tests/api/server.test.ts`)
- All 5 endpoints: POST /retrieve-context, GET /entity/:name, GET /facts/:entityId, GET /search, POST /memory/daily
- Input validation: missing query, invalid topK, bad date
- Error responses: 400, 404, 500
- Stack: supertest + in-memory SQLite with seeded data

### MCP server tests (`tests/mcp/server.test.ts`)
- All 6 tools
- Input validation for each tool
- Error handling (invalid args, missing entity)
- Uses `@modelcontextprotocol/sdk` test utilities or direct function calls

### Watcher tests (`tests/watcher/watcher.test.ts`)
- File add triggers indexing
- File change triggers re-indexing
- File delete triggers cleanup
- Debounce: rapid edits produce single index call
- Stack: temp directory + mocked indexFile

### Local embeddings tests (`tests/embeddings/local.test.ts`)
- Provider implements EmbeddingProvider interface
- Returns correct dimensions
- Embed produces vectors of correct length
- Mock model (don't download real model in tests)

---

## 7. Out of Scope (v2)

- Cross-note entity resolution
- Fact normalization (proper subject/object entity linking)
- Reranking / evaluation framework
- Config file (staying with env vars)
- npm publish
- CLI tests (thin wrapper)
- Auth on HTTP API (localhost-only is sufficient)

---

## 8. New Dependencies

| Package | Purpose | Dev? |
|---------|---------|------|
| `@modelcontextprotocol/sdk` | MCP server protocol | no |
| `@xenova/transformers` | Local ONNX embeddings | no |
| `gpt-tokenizer` | Accurate BPE token counting | no |
| `supertest` | HTTP API testing | yes |

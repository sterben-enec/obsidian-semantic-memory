# obsidian-semantic-memory

Semantic memory layer for Obsidian vaults. Indexes your notes into a local SQLite database with vector embeddings and provides multi-signal retrieval (semantic similarity + entity matching + graph expansion + fact-aware boosting).

## Status

Early-stage tool (v1.0.0). Works, but retrieval heuristics are rough and some abstractions are incomplete. Currently requires OpenAI API for embeddings.

## Architecture

```
Obsidian vault
  -> parse notes (frontmatter + body + wikilinks)
  -> chunk by headings / token budget
  -> generate embeddings (OpenAI text-embedding-3-small)
  -> store in SQLite (better-sqlite3 + sqlite-vec)
  -> extract entities, relations, facts
  -> retrieve via multi-signal ranking
  -> expose via CLI / file watcher / HTTP API
```

## Requirements

- Node.js 18+
- OpenAI API key (for embeddings and optional fact extraction)

## Installation

```bash
git clone <repo-url>
cd obsidian-semantic-memory
npm install
npm run build
```

## Configuration

All configuration is via environment variables.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VAULT_PATH` | yes | - | Absolute path to your Obsidian vault |
| `OPENAI_API_KEY` | yes | - | OpenAI API key for embeddings |
| `DB_PATH` | no | `$VAULT_PATH/.semantic-memory/index.db` | Path to SQLite database |
| `EMBEDDING_PROVIDER` | no | `openai` | Embedding provider (only `openai` supported) |
| `CHUNK_MAX_TOKENS` | no | `400` | Maximum tokens per chunk |
| `CHUNK_OVERLAP_TOKENS` | no | `50` | Token overlap between chunks |
| `PRIORITY_PATHS` | no | `OpenClaw Memory/,Projects/,Infrastructure/` | Comma-separated vault paths to boost in retrieval |
| `LLM_EXTRACTION` | no | `false` | Enable LLM-based fact extraction (GPT-4o-mini) |
| `INDEX_CONCURRENCY` | no | `5` | Parallel indexing workers (1-20) |

## Usage

```bash
# Index entire vault
npx tsx src/cli.ts index

# Semantic search
npx tsx src/cli.ts search "what do I know about project X"

# Watch for file changes and index incrementally
npx tsx src/cli.ts watch

# Start HTTP API (localhost only, port 3456)
npx tsx src/cli.ts serve
npx tsx src/cli.ts serve -p 8080

# Destructive: clear all derived data and reindex from scratch
npx tsx src/cli.ts rebuild
```

## MCP Server

The MCP server (stdio transport) exposes 6 tools for agent connectivity — use it as a Claude Code plugin or with any MCP-compatible client.

```bash
# Start via CLI (stdio, for MCP config)
npx tsx src/cli.ts mcp
```

Add to your Claude Code / MCP client config:

```json
{
  "mcpServers": {
    "obsidian-memory": {
      "command": "npx",
      "args": ["tsx", "/path/to/obsidian-semantic-memory/src/cli.ts", "mcp"],
      "env": {
        "VAULT_PATH": "/path/to/your/vault",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

| Tool | Description |
|------|-------------|
| `memory_search` | Semantic search over vault chunks |
| `memory_entity` | Look up entity by name or alias |
| `memory_facts` | Get all facts about an entity |
| `memory_status` | Index statistics (notes/chunks/entities/facts/relations) |
| `memory_remember` | Append text to daily note |
| `memory_store_fact` | Store structured subject-predicate-object fact |

## API Endpoints

The HTTP API binds to `127.0.0.1` only.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/retrieve-context` | Main retrieval. Body: `{ query, topK? }` |
| GET | `/entity/:name` | Lookup entity by name or alias |
| GET | `/facts/:entityId` | Get facts for an entity |
| GET | `/search?q=...` | Shorthand for retrieve-context |
| POST | `/memory/daily` | Append to daily memory note. Body: `{ date, text, source? }` |

## Security

The API server listens on `127.0.0.1` (localhost only) with no authentication. It exposes your vault contents including private notes, entities, and facts. **Do not expose the port to a network.**

The `/memory/daily` endpoint is a write endpoint that appends content to daily notes in your vault.

## Data Storage

SQLite database is stored at `$VAULT_PATH/.semantic-memory/index.db` by default. Vector embeddings are stored in a `sqlite-vec` virtual table within the same database.

The `.semantic-memory/` directory should be added to your `.gitignore`.

## Known Limitations

- Local embeddings (`EMBEDDING_PROVIDER=local`) use `Xenova/all-MiniLM-L6-v2` (384-dim) — first run downloads ~25MB model to `~/.cache/osm-memory/models`
- Token estimation is heuristic (`length / 4`), not precise tokenization
- Chunking only splits on H1/H2 headings, ignores deeper structure
- Entity resolution is one entity per note (no cross-note deduplication)
- Fact matching in retrieval is lexical, not semantic
- Recency boosting is path-based (`/Daily/`), not time-decay based
- No authentication on the API
- Schema migrations are bootstrap-only (`CREATE IF NOT EXISTS`), no versioned evolution

## License

ISC

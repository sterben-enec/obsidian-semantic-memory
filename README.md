# obsidian-semantic-memory

Semantic memory for Obsidian — local-first indexing, semantic retrieval, FTS, entities, facts, and MCP tools for agents.

[![CI](https://github.com/sterben-enec/obsidian-semantic-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/sterben-enec/obsidian-semantic-memory/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](./LICENSE)

**[Русская версия → README.ru.md](README.ru.md)**

## What it is

`obsidian-semantic-memory` turns an Obsidian vault into a local memory layer that agents and tools can query.

It indexes Markdown notes into SQLite + vector search and exposes a retrieval stack that combines:

- semantic similarity
- BM25 full-text search
- entity lookup
- graph relations
- structured facts
- recency-aware ranking

It is built for **local-first personal knowledge systems** — not cloud dashboards, not hosted SaaS search.

## Why use it

- **Private by default** — local embeddings, local DB, localhost API
- **Better than plain vector search** — semantic + FTS + graph + facts
- **Agent-friendly** — MCP tools for OpenClaw, Claude Code, and other MCP clients
- **Obsidian-native** — works directly on Markdown notes and wikilinks
- **Live updates** — watcher reindexes changes in seconds

## Features

- **Local-first embeddings** via `@xenova/transformers`
- **Multi-signal retrieval** with semantic vectors + BM25 FTS + graph/fact boosts
- **MCP server** with 7 tools
- **HTTP API** for local integrations
- **Structured memory** with entities, relations, and facts
- **`.semanticignore`** support for excluding private/noisy paths

## Quick start

```bash
git clone https://github.com/sterben-enec/obsidian-semantic-memory
cd obsidian-semantic-memory
cp .env.example .env
npm install
npm run build
```

Set `VAULT_PATH` in `.env`, then:

```bash
# full rebuild
node dist/cli.js rebuild

# incremental indexing
node dist/cli.js index

# semantic retrieval
node dist/cli.js search "what do I know about project X"

# watch for changes
node dist/cli.js watch

# local HTTP API
node dist/cli.js serve

# MCP server
node dist/cli.js mcp
```

## Architecture

```text
Obsidian vault (.md files)
  → parse (frontmatter + body + wikilinks)
  → chunk by headings / token budget
  → embed (local or OpenAI)
  → SQLite: notes, chunks, entities, facts, relations
  → FTS5 keyword index
  → sqlite-vec vector index
  → multi-signal ranking
  → CLI / MCP / HTTP API
```

## Requirements

- Node.js 18+
- For local embeddings: ~560 MB model cache on first run
- For OpenAI embeddings: `OPENAI_API_KEY`

## Configuration

All configuration is environment-based. Start from `.env.example` for local development.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VAULT_PATH` | yes | — | Absolute path to your Obsidian vault |
| `EMBEDDING_PROVIDER` | no | `openai` | `local` or `openai` |
| `EMBEDDING_MODEL` | no | `Xenova/multilingual-e5-base` | Model name for local embeddings |
| `OPENAI_API_KEY` | if openai | — | OpenAI API key |
| `DB_PATH` | no | `$VAULT_PATH/.semantic-memory/index.db` | SQLite database path |
| `MEMORY_DIR` | no | `Memory/Daily` | Vault-relative daily memory path |
| `CHUNK_MAX_TOKENS` | no | `400` | Maximum tokens per chunk |
| `CHUNK_OVERLAP_TOKENS` | no | `50` | Token overlap between chunks |
| `PRIORITY_PATHS` | no | `""` | Comma-separated vault paths to boost |
| `LLM_EXTRACTION` | no | `false` | Enable LLM fact extraction |
| `INDEX_CONCURRENCY` | no | `5` | Parallel indexing workers |

### Recommended local models

| Model | Dims | Size | Notes |
|-------|------|------|-------|
| `Xenova/multilingual-e5-base` | 768 | ~560 MB | Best default, multilingual |
| `Xenova/multilingual-e5-small` | 384 | ~120 MB | Faster, lighter |
| `Xenova/all-MiniLM-L6-v2` | 384 | ~25 MB | English-only, very fast |

E5 models automatically use asymmetric `query:` / `passage:` prefixes.

## MCP tools

The MCP server exposes 7 tools over stdio:

- `vault_search` — semantic retrieval
- `vault_fts` — BM25 keyword/phrase search
- `vault_entity` — entity lookup by name or alias
- `vault_facts` — facts for an entity
- `vault_status` — index counts and health snapshot
- `vault_remember` — append text to a daily memory note
- `vault_store_fact` — write a structured fact

Example MCP config:

```json
{
  "mcpServers": {
    "obsidian-memory": {
      "command": "node",
      "args": ["/path/to/obsidian-semantic-memory/dist/cli.js", "mcp"],
      "env": {
        "VAULT_PATH": "/path/to/your/vault",
        "EMBEDDING_PROVIDER": "local",
        "EMBEDDING_MODEL": "Xenova/multilingual-e5-base"
      }
    }
  }
}
```

## HTTP API

The HTTP API binds to `127.0.0.1` only.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/retrieve-context` | Semantic retrieval `{ query, topK? }` |
| `GET` | `/search?q=...` | Shorthand retrieval endpoint |
| `GET` | `/entity/:name` | Lookup entity by name or alias |
| `GET` | `/facts/:entityId` | Facts for an entity |
| `POST` | `/memory/daily` | Append to daily note `{ date, text, source? }` |

## `.semanticignore`

Create `.semanticignore` in your vault root to exclude files from indexing:

```text
# Secrets
config/secrets.md
private/env.md

# Directories
Templates/
Archive/old/
```

Patterns are matched against vault-relative paths.

## macOS launchd example

Create `~/Library/LaunchAgents/com.yourname.osm-watcher.plist` and run the watcher at login:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.yourname.osm-watcher</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/local/opt/node@24/bin/node</string>
      <string>/path/to/obsidian-semantic-memory/dist/cli.js</string>
      <string>watch</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>VAULT_PATH</key>
      <string>/path/to/your/vault</string>
      <key>EMBEDDING_PROVIDER</key>
      <string>local</string>
      <key>EMBEDDING_MODEL</key>
      <string>Xenova/multilingual-e5-base</string>
      <key>HOME</key>
      <string>/Users/yourname</string>
      <key>PATH</key>
      <string>/usr/local/opt/node@24/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
  </dict>
</plist>
```

## Security model

- HTTP API binds to `127.0.0.1` only
- MCP transport is stdio-only
- private notes and secrets should be excluded via `.semanticignore`
- local `.env` files should never be committed

See [SECURITY.md](SECURITY.md) for reporting guidance.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## GitHub About

Suggested repo description:

> Local-first semantic memory for Obsidian: SQLite + vector search + FTS + entities + facts + MCP tools.

Suggested topics:

`obsidian`, `semantic-search`, `mcp`, `knowledge-graph`, `sqlite`, `vector-search`, `local-first`, `typescript`

## License

ISC

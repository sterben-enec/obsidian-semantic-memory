# obsidian-semantic-memory

Semantic memory layer for Obsidian vaults. Indexes notes into a local SQLite database with vector embeddings and provides multi-signal retrieval: semantic similarity + FTS keyword search + entity matching + graph expansion + fact-aware boosting.

**[Русская версия → README.ru.md](README.ru.md)**

## Features

- **Local-first** — embeddings run fully offline via `@xenova/transformers` (no API key required)
- **Multi-signal retrieval** — semantic vectors + BM25 FTS + entity graph + structured facts + recency decay
- **MCP server** — 7 tools for agent connectivity (Claude, OpenClaw, any MCP client)
- **Live watcher** — vault changes indexed within seconds via chokidar
- **Structured memory** — entities, relations, subject-predicate-object facts
- **`.semanticignore`** — exclude files with secrets or noise from the index

## Architecture

```
Obsidian vault (.md files)
  → parse (frontmatter + body + wikilinks)
  → chunk by headings / token budget (gpt-tokenizer)
  → embed (local multilingual-e5-base or OpenAI)
  → SQLite: notes, chunks, entities, facts, relations
  → FTS5 virtual table (BM25 keyword search)
  → sqlite-vec virtual table (vector similarity)
  → multi-signal ranking (semantic + FTS + entity + graph + facts + recency)
  → MCP server / CLI / HTTP API
```

## Requirements

- Node.js 18+
- For local embeddings: ~560 MB disk for model cache (downloaded on first run)
- For OpenAI embeddings: `OPENAI_API_KEY`

## Installation

```bash
git clone https://github.com/sterben-enec/obsidian-semantic-memory
cd obsidian-semantic-memory
cp .env.example .env
npm install
npm run build
```

Set `VAULT_PATH` in `.env` before running the CLI against a real vault.

## Configuration

All configuration is via environment variables.

You can start from `.env.example` for local development.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VAULT_PATH` | yes | — | Absolute path to your Obsidian vault |
| `EMBEDDING_PROVIDER` | no | `openai` | `local` or `openai` |
| `EMBEDDING_MODEL` | no | `Xenova/multilingual-e5-base` | Model name (local provider) |
| `OPENAI_API_KEY` | if openai | — | OpenAI API key |
| `DB_PATH` | no | `$VAULT_PATH/.semantic-memory/index.db` | SQLite database path |
| `MEMORY_DIR` | no | `Memory/Daily` | Vault-relative path for daily memory notes |
| `CHUNK_MAX_TOKENS` | no | `400` | Maximum tokens per chunk |
| `CHUNK_OVERLAP_TOKENS` | no | `50` | Token overlap between chunks |
| `PRIORITY_PATHS` | no | `""` | Comma-separated vault paths to boost in retrieval |
| `LLM_EXTRACTION` | no | `false` | Enable LLM fact extraction (requires `OPENAI_API_KEY`) |
| `INDEX_CONCURRENCY` | no | `5` | Parallel indexing workers (1–20) |

### Local embedding models

| Model | Dims | Size | Notes |
|-------|------|------|-------|
| `Xenova/multilingual-e5-base` | 768 | ~560 MB | Default. Best quality, multilingual |
| `Xenova/multilingual-e5-small` | 384 | ~120 MB | Faster, lower RAM |
| `Xenova/all-MiniLM-L6-v2` | 384 | ~25 MB | English only, very fast |

E5 models use asymmetric query/passage prefixes automatically — no manual configuration needed.

## Usage

```bash
export VAULT_PATH="/path/to/your/vault"
export EMBEDDING_PROVIDER=local
export EMBEDDING_MODEL=Xenova/multilingual-e5-base

# Full index (first run or after schema changes)
node dist/cli.js rebuild

# Incremental index (only changed files)
node dist/cli.js index

# Semantic search
node dist/cli.js search "what do I know about project X"
node dist/cli.js search "project X" --topK 10

# Watch vault for changes (runs continuously)
node dist/cli.js watch

# Start HTTP API (localhost:3456)
node dist/cli.js serve
node dist/cli.js serve -p 8080

# Start MCP server (stdio transport)
node dist/cli.js mcp
```

## MCP Server

7 tools exposed via stdio transport. Compatible with Claude Code, OpenClaw, and any MCP client.

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

| Tool | Description |
|------|-------------|
| `vault_search` | Semantic search — ranked by similarity + entity + graph + facts + recency |
| `vault_fts` | Full-text keyword search (BM25). Use for exact terms and phrases |
| `vault_entity` | Look up entity by name or alias (supports partial matching) |
| `vault_facts` | Get all structured facts about an entity |
| `vault_status` | Index statistics: notes / chunks / entities / facts / relations |
| `vault_remember` | Append text to daily memory note |
| `vault_store_fact` | Store structured fact: subject → predicate → object |

## HTTP API

Binds to `127.0.0.1` only (localhost, no network exposure).

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/retrieve-context` | Semantic retrieval. Body: `{ query, topK? }` |
| `GET` | `/search?q=...` | Shorthand for retrieve-context |
| `GET` | `/entity/:name` | Look up entity by name or alias |
| `GET` | `/facts/:entityId` | Get facts for an entity |
| `POST` | `/memory/daily` | Append to daily note. Body: `{ date, text, source? }` |

## Auto-start on macOS (launchd)

Create `~/Library/LaunchAgents/com.yourname.osm-watcher.plist`:

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
    <key>ThrottleInterval</key>
    <integer>5</integer>
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
    <key>StandardOutPath</key>
    <string>/path/to/logs/osm-watcher.log</string>
    <key>StandardErrorPath</key>
    <string>/path/to/logs/osm-watcher.err.log</string>
  </dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.yourname.osm-watcher.plist
```

`KeepAlive: true` restarts the watcher automatically on crash. `RunAtLoad: true` starts it at login.

## Ignoring files

Create `.semanticignore` in your vault root to exclude files from indexing (both `rebuild`/`index` and the live watcher):

```
# Credentials and secrets
path/to/env.md
config/secrets.md

# Directories
Templates/
Archive/old/
```

Patterns are matched against vault-relative paths. Directory patterns exclude recursively.

## Security

- API server listens on `127.0.0.1` only — not accessible from the network
- Use `.semanticignore` to keep credentials and private files out of the index
- The MCP server runs as stdio — no network port

## Data Storage

- SQLite database: `$VAULT_PATH/.semantic-memory/index.db`
- Model cache: `~/.cache/osm-memory/models/`
- Add `.semantic-memory/` to `.gitignore`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

ISC

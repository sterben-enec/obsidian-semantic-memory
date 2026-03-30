# OSM Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Universalize obsidian-semantic-memory with MCP server for agent connectivity, local embeddings, retrieval quality improvements, schema migrations, and test coverage.

**Architecture:** Add MCP server (stdio transport) as primary agent interface alongside existing HTTP API. Add local embedding provider via @xenova/transformers. Improve chunking (gpt-tokenizer, H3 support), recency (time decay), and schema (versioned migrations). Fill test gaps for API, MCP, and watcher.

**Tech Stack:** TypeScript, better-sqlite3, sqlite-vec, @modelcontextprotocol/sdk, @xenova/transformers, gpt-tokenizer, vitest, supertest

**Spec:** `docs/superpowers/specs/2026-03-31-osm-completion-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `src/mcp/server.ts` | MCP server with 6 tools, stdio transport |
| `src/embeddings/local.ts` | Local embedding provider using @xenova/transformers |
| `src/db/migrations.ts` | Versioned migration runner + migration definitions |
| `tests/api/server.test.ts` | HTTP API endpoint tests |
| `tests/mcp/server.test.ts` | MCP server tool tests |
| `tests/watcher/watcher.test.ts` | File watcher tests |
| `tests/embeddings/local.test.ts` | Local embedding provider tests |

### Modified files
| File | Changes |
|------|---------|
| `src/config.ts` | Add `local` provider, `MEMORY_DIR`, `EMBEDDING_MODEL`; empty PRIORITY_PATHS default |
| `src/cli.ts` | Add `mcp` command; lazy init via `setupDb()` + `setupStack()` |
| `src/indexer/chunker.ts` | Replace char/4 with gpt-tokenizer; add H3 heading support |
| `src/retrieval/orchestrator.ts` | Replace path-based recency with time-decay |
| `src/memory/writer.ts` | Use configurable MEMORY_DIR instead of hardcoded path |
| `src/db/schema.ts` | Replace DDL bootstrap with migration runner call |
| `package.json` | New deps, bin field, keywords |
| `README.md` | MCP setup, local embeddings, updated env var docs |
| `tests/config.test.ts` | Tests for new config options |

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install production dependencies**

Run:
```bash
cd /path/to/obsidian-semantic-memory
npm install @modelcontextprotocol/sdk @xenova/transformers gpt-tokenizer
```

- [ ] **Step 2: Install dev dependencies**

Run:
```bash
npm install -D supertest @types/supertest
```

- [ ] **Step 3: Add bin and keywords to package.json**

Edit `package.json` — add after `"type": "commonjs"`:
```json
"bin": {
  "osm-memory": "dist/cli.js"
},
"keywords": ["obsidian", "semantic-memory", "mcp", "embeddings", "knowledge-graph"],
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add MCP, local embeddings, tokenizer dependencies"
```

---

### Task 2: Versioned migration system

**Files:**
- Create: `src/db/migrations.ts`
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Create migrations.ts**

Create `src/db/migrations.ts`:
```typescript
import Database from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: (db) => {
      const ddl = [
        `CREATE TABLE IF NOT EXISTS notes (
          path TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          kind TEXT,
          note_hash TEXT NOT NULL,
          modified_at TEXT NOT NULL,
          frontmatter_json TEXT NOT NULL DEFAULT '{}'
        )`,
        `CREATE TABLE IF NOT EXISTS chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          note_path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
          heading_path TEXT NOT NULL DEFAULT '',
          text TEXT NOT NULL,
          start_line INTEGER NOT NULL,
          end_line INTEGER NOT NULL,
          token_count INTEGER NOT NULL,
          chunk_hash TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS entities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          canonical_name TEXT NOT NULL,
          aliases_json TEXT NOT NULL DEFAULT '[]',
          source_note TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
          confidence REAL NOT NULL DEFAULT 1.0,
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS facts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          subject_entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
          predicate TEXT NOT NULL,
          object_text TEXT,
          object_entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL,
          source_path TEXT NOT NULL,
          source_chunk_id INTEGER REFERENCES chunks(id) ON DELETE SET NULL,
          confidence REAL NOT NULL DEFAULT 1.0,
          valid_from TEXT NOT NULL,
          valid_to TEXT,
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS relations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          relation TEXT NOT NULL,
          target_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          source_note TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 1.0
        )`,
        `CREATE TABLE IF NOT EXISTS write_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          note_path TEXT NOT NULL,
          action TEXT NOT NULL,
          summary TEXT,
          created_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_chunks_note ON chunks(note_path)`,
        `CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(canonical_name)`,
        `CREATE INDEX IF NOT EXISTS idx_facts_source ON facts(source_path)`,
        `CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_entity_id)`,
        `CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_entity_id)`,
        `CREATE INDEX IF NOT EXISTS idx_entities_source_note ON entities(source_note)`,
        `CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject_entity_id)`,
      ];
      for (const sql of ddl) db.prepare(sql).run();
    },
  },
  {
    version: 2,
    name: 'uniqueness_constraints',
    up: (db) => {
      db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_unique ON relations(source_entity_id, relation, target_entity_id)`).run();
      db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_facts_unique ON facts(subject_entity_id, predicate, object_text)`).run();
    },
  },
];

export function runMigrations(db: Database.Database): void {
  // Ensure schema_version table exists
  db.prepare(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`).run();

  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
  let currentVersion = row?.version ?? 0;

  // If DB has no version but has tables (existing install), assume v1
  if (currentVersion === 0) {
    const hasNotes = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notes'").get();
    if (hasNotes) {
      // Existing DB — run migration 1 DDL (IF NOT EXISTS is safe) and mark as v1
      migrations[0].up(db);
      currentVersion = 1;
    }
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;
    db.transaction(() => {
      migration.up(db);
      if (currentVersion === 0 && migration.version === 1) {
        db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version);
      } else {
        db.prepare('UPDATE schema_version SET version = ?').run(migration.version);
      }
    })();
    currentVersion = migration.version;
    console.log(`[migrations] applied: ${migration.version}_${migration.name}`);
  }
}
```

- [ ] **Step 2: Update schema.ts to re-export from migrations**

Replace entire content of `src/db/schema.ts`:
```typescript
export { runMigrations } from './migrations';
```

- [ ] **Step 3: Run existing tests to verify backward compatibility**

Run: `npm test`
Expected: All 86 tests pass (migrations produce identical schema)

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations.ts src/db/schema.ts
git commit -m "feat: replace DDL bootstrap with versioned migration system"
```

---

### Task 3: Config universalization

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Update Config interface and loadConfig**

Replace entire `src/config.ts`:
```typescript
export interface Config {
  vaultPath: string;
  dbPath: string;
  embeddingProvider: 'openai' | 'local';
  openaiApiKey?: string;
  embeddingModel?: string;
  chunkMaxTokens: number;
  chunkOverlapTokens: number;
  priorityPaths: string[];
  memoryDir: string;
  llmExtraction: boolean;
  indexConcurrency: number;
}

export function loadConfig(): Config {
  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) throw new Error('VAULT_PATH environment variable is required');

  const rawProvider = process.env.EMBEDDING_PROVIDER ?? 'openai';
  if (rawProvider !== 'openai' && rawProvider !== 'local') {
    throw new Error(`Invalid EMBEDDING_PROVIDER "${rawProvider}": must be "openai" or "local"`);
  }
  const embeddingProvider = rawProvider as 'openai' | 'local';

  if (embeddingProvider === 'openai') {
    const key = process.env.OPENAI_API_KEY;
    if (!key || key.trim() === '') {
      throw new Error('OPENAI_API_KEY is required when EMBEDDING_PROVIDER is "openai"');
    }
  }

  const chunkMaxTokens = Number(process.env.CHUNK_MAX_TOKENS ?? 400);
  if (!Number.isFinite(chunkMaxTokens) || chunkMaxTokens <= 0) {
    throw new Error('CHUNK_MAX_TOKENS must be a positive number');
  }

  const chunkOverlapTokens = Number(process.env.CHUNK_OVERLAP_TOKENS ?? 50);
  if (!Number.isFinite(chunkOverlapTokens) || chunkOverlapTokens < 0) {
    throw new Error('CHUNK_OVERLAP_TOKENS must be a non-negative number');
  }

  if (chunkOverlapTokens >= chunkMaxTokens) {
    throw new Error('CHUNK_OVERLAP_TOKENS must be less than CHUNK_MAX_TOKENS');
  }

  const indexConcurrency = Number(process.env.INDEX_CONCURRENCY ?? 5);

  const rawPriorityPaths = process.env.PRIORITY_PATHS ?? '';
  const priorityPaths = rawPriorityPaths ? rawPriorityPaths.split(',').map(p => p.trim()).filter(Boolean) : [];

  return {
    vaultPath,
    dbPath: process.env.DB_PATH ?? `${vaultPath}/.semantic-memory/index.db`,
    embeddingProvider,
    openaiApiKey: process.env.OPENAI_API_KEY,
    embeddingModel: process.env.EMBEDDING_MODEL,
    chunkMaxTokens,
    chunkOverlapTokens,
    priorityPaths,
    memoryDir: process.env.MEMORY_DIR ?? 'Memory/Daily',
    llmExtraction: process.env.LLM_EXTRACTION === 'true',
    indexConcurrency: Math.max(1, Math.min(20, indexConcurrency)),
  };
}
```

- [ ] **Step 2: Update config tests**

Update `tests/config.test.ts` — the test for `local` provider should now NOT throw:
- Change test `'throws when EMBEDDING_PROVIDER is "local" (unsupported)'` to `'accepts EMBEDDING_PROVIDER "local" without OPENAI_API_KEY'` — set `EMBEDDING_PROVIDER=local`, do NOT set OPENAI_API_KEY, expect no throw, verify `config.embeddingProvider === 'local'`
- Add test: `'defaults PRIORITY_PATHS to empty array'` — unset PRIORITY_PATHS, verify `config.priorityPaths` is `[]`
- Add test: `'defaults MEMORY_DIR to Memory/Daily'` — verify `config.memoryDir === 'Memory/Daily'`
- Add test: `'reads MEMORY_DIR from env'` — set `MEMORY_DIR=Notes/Journal`, verify `config.memoryDir === 'Notes/Journal'`
- Add test: `'reads EMBEDDING_MODEL from env'` — set `EMBEDDING_MODEL=custom-model`, verify `config.embeddingModel === 'custom-model'`
- Update any existing tests that assert on old PRIORITY_PATHS default

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: universalize config — local provider, MEMORY_DIR, empty priority paths default"
```

---

### Task 4: Local embedding provider

**Files:**
- Create: `src/embeddings/local.ts`
- Create: `tests/embeddings/local.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/embeddings/local.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @xenova/transformers before import
vi.mock('@xenova/transformers', () => {
  const mockPipeline = vi.fn().mockResolvedValue(
    vi.fn().mockImplementation((texts: string[], opts: any) => ({
      tolist: () => texts.map(() => Array.from({ length: 384 }, () => Math.random())),
    }))
  );
  return { pipeline: mockPipeline, env: { cacheDir: '' } };
});

import { LocalEmbeddingProvider } from '../../src/embeddings/local';

describe('LocalEmbeddingProvider', () => {
  it('implements EmbeddingProvider interface', () => {
    const provider = new LocalEmbeddingProvider();
    expect(provider.dimensions).toBe(384);
    expect(typeof provider.embed).toBe('function');
  });

  it('returns embeddings with correct dimensions', async () => {
    const provider = new LocalEmbeddingProvider();
    const result = await provider.embed(['hello world', 'test']);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(384);
    expect(result[1]).toHaveLength(384);
  });

  it('handles empty input', async () => {
    const provider = new LocalEmbeddingProvider();
    const result = await provider.embed([]);
    expect(result).toEqual([]);
  });

  it('accepts custom model name', () => {
    const provider = new LocalEmbeddingProvider('Xenova/custom-model');
    expect(provider.dimensions).toBe(384);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/embeddings/local.test.ts`
Expected: FAIL — module `../../src/embeddings/local` not found

- [ ] **Step 3: Implement local embedding provider**

Create `src/embeddings/local.ts`:
```typescript
import { pipeline, env } from '@xenova/transformers';
import type { EmbeddingProvider } from './types';
import path from 'path';
import os from 'os';

export class LocalEmbeddingProvider implements EmbeddingProvider {
  dimensions = 384;
  private modelName: string;
  private extractor: any = null;

  constructor(modelName?: string) {
    this.modelName = modelName ?? 'Xenova/all-MiniLM-L6-v2';
    env.cacheDir = path.join(os.homedir(), '.cache', 'osm-memory', 'models');
  }

  private async getExtractor() {
    if (!this.extractor) {
      this.extractor = await pipeline('feature-extraction', this.modelName);
    }
    return this.extractor;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.getExtractor();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    return output.tolist() as number[][];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/embeddings/local.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/embeddings/local.ts tests/embeddings/local.test.ts
git commit -m "feat: add local embedding provider via @xenova/transformers"
```

---

### Task 5: gpt-tokenizer and H3 chunking

**Files:**
- Modify: `src/indexer/chunker.ts`

- [ ] **Step 1: Run existing chunker tests as baseline**

Run: `npx vitest run tests/indexer/chunker.test.ts tests/edge-cases.test.ts`
Expected: PASS

- [ ] **Step 2: Replace token estimation with gpt-tokenizer**

In `src/indexer/chunker.ts`, replace line 17:
```typescript
const tokens = (s: string) => Math.ceil(s.length / 4);
```
with:
```typescript
import { encode } from 'gpt-tokenizer';

const tokens = (s: string) => encode(s).length;
```

- [ ] **Step 3: Add H3 support to splitByHeadings**

In `src/indexer/chunker.ts`, replace the `splitByHeadings` function (lines 64-85):
```typescript
function splitByHeadings(lines: string[]): Section[] {
  const sections: Section[] = [];
  let stack: string[] = [];
  let buf: string[] = [];
  let start = 0;

  for (let i = 0; i < lines.length; i++) {
    const h1 = lines[i].match(/^#\s+(.+)$/);
    const h2 = !h1 ? lines[i].match(/^##\s+(.+)$/) : null;
    const h3 = !h1 && !h2 ? lines[i].match(/^###\s+(.+)$/) : null;
    if (h1 || h2 || h3) {
      if (buf.length) sections.push({ headingPath: stack.join(' > '), lines: buf, startLine: start, endLine: i });
      if (h1) stack = [h1[1].trim()];
      else if (h2) stack = [stack[0] ?? '', h2[1].trim()].filter(Boolean);
      else if (h3) stack = [stack[0] ?? '', stack[1] ?? '', h3[1].trim()].filter(Boolean);
      buf = [lines[i]];
      start = i;
    } else {
      buf.push(lines[i]);
    }
  }
  if (buf.length) sections.push({ headingPath: stack.join(' > '), lines: buf, startLine: start, endLine: lines.length });
  return sections;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/indexer/chunker.test.ts tests/edge-cases.test.ts`
Expected: PASS (token counts will differ but tests should check behavior, not exact counts)

If any tests fail due to changed token counts, update the expected values to match gpt-tokenizer output.

- [ ] **Step 5: Commit**

```bash
git add src/indexer/chunker.ts
git commit -m "feat: replace char/4 token estimation with gpt-tokenizer, add H3 heading support"
```

---

### Task 6: Time-decay recency in orchestrator

**Files:**
- Modify: `src/retrieval/orchestrator.ts`

- [ ] **Step 1: Replace path-based recency with time-decay**

In `src/retrieval/orchestrator.ts`, the `retrieveContext` function currently has (line 66):
```typescript
if (h.notePath.includes('/Daily/')) { score += 0.05; reason += '+recency'; }
```

Replace the entire scored mapping block (lines 62-67) with:
```typescript
  const scored = semanticHits.map(h => {
    let score = h.score; let reason = 'semantic';
    if (priorityPaths.some(p => h.notePath.includes('/' + p) || h.notePath.startsWith(p))) { score += 0.1; reason = 'semantic+priority'; }
    if (entityHit?.sourceNote === h.notePath) { score += 0.2; reason = 'semantic+entity'; }
    // Time-decay recency: +0.1 for today, linearly decaying to 0 over 30 days
    const noteRow = db.prepare('SELECT modified_at FROM notes WHERE path = ?').get(h.notePath) as { modified_at: string } | undefined;
    if (noteRow) {
      const daysSince = (Date.now() - new Date(noteRow.modified_at).getTime()) / 86400000;
      const recencyBoost = Math.max(0, 0.1 * (1 - daysSince / 30));
      if (recencyBoost > 0.001) { score += recencyBoost; reason += '+recency'; }
    }
    return { ...h, score, reason };
  });
```

- [ ] **Step 2: Run orchestrator tests**

Run: `npx vitest run tests/retrieval/orchestrator.test.ts`
Expected: PASS (existing test data uses '2026-03-30' dates which are recent)

- [ ] **Step 3: Commit**

```bash
git add src/retrieval/orchestrator.ts
git commit -m "feat: replace path-based recency with time-decay based on modified_at"
```

---

### Task 7: Configurable MEMORY_DIR in writer

**Files:**
- Modify: `src/memory/writer.ts`
- Modify: `tests/memory/writer.test.ts`

- [ ] **Step 1: Update writer to accept memoryDir parameter**

Replace `src/memory/writer.ts`:
```typescript
import fs from 'fs/promises';
import path from 'path';

export interface DailyEntry { text: string; source: string }

export async function appendDailyMemory(vaultPath: string, date: string, entry: DailyEntry, memoryDir = 'Memory/Daily'): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('date must be YYYY-MM-DD format');
  }

  const dir = path.join(vaultPath, memoryDir);
  const filePath = path.join(dir, `${date}.md`);

  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(dir);
  if (!resolvedPath.startsWith(resolvedBase)) {
    throw new Error('Invalid date: path traversal detected');
  }

  await fs.mkdir(dir, { recursive: true });

  // Sanitize text: trim, remove frontmatter delimiters, limit length
  let sanitizedText = entry.text.trim();
  sanitizedText = sanitizedText.replace(/---/g, '');
  if (sanitizedText.length > 2000) {
    sanitizedText = sanitizedText.substring(0, 2000);
  }

  // Sanitize source: alphanumeric and hyphens only
  const sanitizedSource = entry.source.replace(/[^\p{L}\p{N}-]/gu, '');

  const time = new Date().toISOString().substring(11, 19);
  const line = `\n- [${time}] (${sanitizedSource}) ${sanitizedText}`;

  try {
    await fs.stat(filePath);
    await fs.appendFile(filePath, line, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      await fs.writeFile(filePath, `---\nkind: note\nupdated: ${date}\n---\n# ${date}\n` + line, 'utf8');
    } else {
      throw err;
    }
  }

  return filePath;
}
```

Note: changed return type from `void` to `string` (returns filePath), added `memoryDir` param.

- [ ] **Step 2: Update writer tests for new signature**

In existing writer tests, ensure they still pass. The new `memoryDir` param has a default, so existing calls without it still work. If any test hardcodes path expectations with `OpenClaw Memory/Daily`, update them to `Memory/Daily`.

- [ ] **Step 3: Update API server to pass memoryDir**

In `src/api/server.ts`, update the `createServer` function signature to accept `memoryDir`:
```typescript
export function createServer(
  db: Database.Database,
  vectorIndex: VectorIndex,
  provider: ProviderLike,
  vaultPath: string,
  priorityPaths?: string[],
  memoryDir?: string
)
```

In the `/memory/daily` handler, pass it:
```typescript
await appendDailyMemory(vaultPath, date, { text, source }, memoryDir);
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/memory/writer.ts src/api/server.ts tests/memory/writer.test.ts
git commit -m "feat: make daily memory dir configurable via memoryDir parameter"
```

---

### Task 8: CLI lazy init and mcp command

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Refactor setup into composable parts and add mcp command**

Replace entire `src/cli.ts`:
```typescript
import { Command } from 'commander';
import OpenAI from 'openai';
import { loadConfig, Config } from './config';
import { openDb } from './db/client';
import { runMigrations } from './db/schema';
import { indexVault } from './indexer/pipeline';
import { startWatcher } from './watcher/watcher';
import { retrieveContext } from './retrieval/orchestrator';
import { VectorIndex } from './embeddings/vectorIndex';
import { OpenAIEmbeddingProvider } from './embeddings/openai';
import { LocalEmbeddingProvider } from './embeddings/local';
import { createServer } from './api/server';
import { extractFacts } from './extraction/factExtractor';
import type { EmbeddingProvider } from './embeddings/types';
import type Database from 'better-sqlite3';

function setupDb(config: Config) {
  const db = openDb(config.dbPath);
  runMigrations(db);
  return db;
}

function createProvider(config: Config): EmbeddingProvider {
  if (config.embeddingProvider === 'local') {
    return new LocalEmbeddingProvider(config.embeddingModel);
  }
  return new OpenAIEmbeddingProvider(config.openaiApiKey!);
}

function setupStack(config: Config, db: Database.Database) {
  const provider = createProvider(config);
  const vectorIndex = new VectorIndex(db, provider.dimensions);
  vectorIndex.initTable();
  const factExtractor = config.llmExtraction
    ? (title: string, body: string) => extractFacts(new OpenAI({ apiKey: config.openaiApiKey! }), title, body)
    : undefined;
  return { provider, vectorIndex, factExtractor };
}

const program = new Command().name('osm-memory').version('1.0.0');

program.command('index')
  .description('Index full vault')
  .action(async () => {
    const config = loadConfig();
    const db = setupDb(config);
    const { provider, vectorIndex, factExtractor } = setupStack(config, db);
    const stats = await indexVault(db, config.vaultPath, {
      embeddingProvider: provider,
      vectorIndex,
      chunkOptions: { maxTokens: config.chunkMaxTokens, overlapTokens: config.chunkOverlapTokens },
      factExtractor,
    }, config.indexConcurrency);
    console.log(`Done. ${stats.indexed}/${stats.total} indexed, ${stats.errors} errors`);
    db.close();
  });

program.command('search <query>')
  .description('Semantic search')
  .option('-k, --top-k <n>', 'number of results', '5')
  .action(async (query: string, opts: any) => {
    const config = loadConfig();
    const db = setupDb(config);
    const { provider, vectorIndex } = setupStack(config, db);
    const result = await retrieveContext(db, vectorIndex, provider, query, Number(opts.topK), config.priorityPaths);
    for (const hit of result.hits) {
      console.log(`[${hit.score.toFixed(3)}] ${hit.notePath} (${hit.reason})`);
      console.log(`  ${hit.text.substring(0, 200)}\n`);
    }
    db.close();
  });

program.command('watch')
  .description('Watch vault for changes')
  .action(async () => {
    const config = loadConfig();
    const db = setupDb(config);
    const { provider, vectorIndex, factExtractor } = setupStack(config, db);
    startWatcher(config.vaultPath, db, {
      embeddingProvider: provider,
      vectorIndex,
      chunkOptions: { maxTokens: config.chunkMaxTokens, overlapTokens: config.chunkOverlapTokens },
      factExtractor,
    });
    console.log(`Watching ${config.vaultPath}...`);
  });

program.command('serve')
  .description('Start HTTP API')
  .option('-p, --port <n>', 'port', '3456')
  .action(async (opts: any) => {
    const config = loadConfig();
    const db = setupDb(config);
    const { provider, vectorIndex } = setupStack(config, db);
    const app = createServer(db, vectorIndex, provider, config.vaultPath, config.priorityPaths, config.memoryDir);
    app.listen(Number(opts.port), '127.0.0.1', () => console.log(`Listening on http://127.0.0.1:${opts.port}`));
  });

program.command('rebuild')
  .description('Clear derived data and reindex from scratch')
  .action(async () => {
    const config = loadConfig();
    const db = setupDb(config);
    const { provider, vectorIndex, factExtractor } = setupStack(config, db);
    db.prepare('DROP TABLE IF EXISTS chunk_embeddings').run();
    vectorIndex.initTable();
    db.transaction(() => {
      db.prepare('DELETE FROM facts').run();
      db.prepare('DELETE FROM relations').run();
      db.prepare('DELETE FROM entities').run();
      db.prepare('DELETE FROM chunks').run();
      db.prepare('DELETE FROM notes').run();
    })();
    const stats = await indexVault(db, config.vaultPath, {
      embeddingProvider: provider,
      vectorIndex,
      chunkOptions: { maxTokens: config.chunkMaxTokens, overlapTokens: config.chunkOverlapTokens },
      factExtractor,
    }, config.indexConcurrency);
    console.log(`Rebuild done. ${stats.indexed}/${stats.total} indexed, ${stats.errors} errors`);
    db.close();
  });

program.command('mcp')
  .description('Start MCP server (stdio transport)')
  .action(async () => {
    const config = loadConfig();
    const db = setupDb(config);
    const { provider, vectorIndex } = setupStack(config, db);
    const { startMcpServer } = await import('./mcp/server');
    await startMcpServer(db, vectorIndex, provider, config);
  });

program.parse();
```

- [ ] **Step 2: Run existing tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: refactor CLI with lazy init, add mcp command"
```

---

### Task 9: MCP Server

**Files:**
- Create: `src/mcp/server.ts`
- Create: `tests/mcp/server.test.ts`

- [ ] **Step 1: Write MCP server test**

Create `tests/mcp/server.test.ts`:
```typescript
import { describe, it, expect, afterEach, vi } from 'vitest';
import { openDb } from '../../src/db/client';
import { runMigrations } from '../../src/db/schema';
import { VectorIndex } from '../../src/embeddings/vectorIndex';
import { createMcpTools } from '../../src/mcp/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DB = '/tmp/test-mcp.db';
afterEach(() => { if (fs.existsSync(DB)) fs.unlinkSync(DB); });

function seedDb() {
  const db = openDb(DB);
  runMigrations(db);
  db.prepare("INSERT INTO notes VALUES ('/v/john.md','John','person','h1','2026-03-30T00:00:00.000Z','{}')").run();
  db.prepare("INSERT INTO chunks (note_path,heading_path,text,start_line,end_line,token_count,chunk_hash) VALUES (?,?,?,?,?,?,?)")
    .run('/v/john.md', '', 'John is an engineer at Acme.', 0, 2, 7, 'h1');
  db.prepare("INSERT INTO entities (type,canonical_name,aliases_json,source_note,confidence,updated_at) VALUES (?,?,?,?,?,?)")
    .run('person', 'John', '["JD"]', '/v/john.md', 1.0, '2026-03-30');
  const entityId = (db.prepare('SELECT id FROM entities LIMIT 1').get() as any).id;
  db.prepare("INSERT INTO facts (subject_entity_id,predicate,object_text,source_path,confidence,valid_from,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run(entityId, 'works_at', 'Acme Corp', '/v/john.md', 0.9, '2026-03-30', '2026-03-30');
  return db;
}

describe('MCP tools', () => {
  it('memory_status returns counts', async () => {
    const db = seedDb();
    const idx = new VectorIndex(db, 4); idx.initTable();
    const tools = createMcpTools(db, idx, { embed: vi.fn(), dimensions: 4 } as any, { vaultPath: '/v', memoryDir: 'Memory/Daily' } as any);
    const result = await tools.memory_status({});
    expect(result.notes).toBe(1);
    expect(result.chunks).toBe(1);
    expect(result.entities).toBe(1);
    expect(result.facts).toBe(1);
    db.close();
  });

  it('memory_entity finds by name', async () => {
    const db = seedDb();
    const idx = new VectorIndex(db, 4); idx.initTable();
    const tools = createMcpTools(db, idx, { embed: vi.fn(), dimensions: 4 } as any, { vaultPath: '/v', memoryDir: 'Memory/Daily' } as any);
    const result = await tools.memory_entity({ name: 'John' });
    expect(result).not.toBeNull();
    expect(result!.canonicalName).toBe('John');
    db.close();
  });

  it('memory_entity finds by alias', async () => {
    const db = seedDb();
    const idx = new VectorIndex(db, 4); idx.initTable();
    const tools = createMcpTools(db, idx, { embed: vi.fn(), dimensions: 4 } as any, { vaultPath: '/v', memoryDir: 'Memory/Daily' } as any);
    const result = await tools.memory_entity({ name: 'JD' });
    expect(result).not.toBeNull();
    expect(result!.canonicalName).toBe('John');
    db.close();
  });

  it('memory_facts returns facts for entity', async () => {
    const db = seedDb();
    const idx = new VectorIndex(db, 4); idx.initTable();
    const tools = createMcpTools(db, idx, { embed: vi.fn(), dimensions: 4 } as any, { vaultPath: '/v', memoryDir: 'Memory/Daily' } as any);
    const result = await tools.memory_facts({ entityName: 'John' });
    expect(result).toHaveLength(1);
    expect(result[0].predicate).toBe('works_at');
    db.close();
  });

  it('memory_store_fact creates entity and fact', async () => {
    const db = seedDb();
    const idx = new VectorIndex(db, 4); idx.initTable();
    const tools = createMcpTools(db, idx, { embed: vi.fn(), dimensions: 4 } as any, { vaultPath: '/v', memoryDir: 'Memory/Daily' } as any);
    const result = await tools.memory_store_fact({ subject: 'Alice', predicate: 'works_at', object: 'Globex' });
    expect(result.ok).toBe(true);
    expect(result.factId).toBeGreaterThan(0);
    // Verify fact was stored
    const facts = await tools.memory_facts({ entityName: 'Alice' });
    expect(facts).toHaveLength(1);
    expect(facts[0].object_text).toBe('Globex');
    db.close();
  });

  it('memory_search returns hits', async () => {
    const db = seedDb();
    const chunkId = (db.prepare('SELECT id FROM chunks LIMIT 1').get() as any).id;
    const idx = new VectorIndex(db, 4); idx.initTable();
    idx.upsert(chunkId, [1, 0, 0, 0]);
    const provider = { dimensions: 4, embed: vi.fn().mockResolvedValue([[0.9, 0, 0, 0]]) };
    const tools = createMcpTools(db, idx, provider as any, { vaultPath: '/v', memoryDir: 'Memory/Daily', priorityPaths: [] } as any);
    const result = await tools.memory_search({ query: 'engineer', topK: 5 });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].notePath).toBe('/v/john.md');
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/server.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement MCP server**

Create `src/mcp/server.ts`:
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import { VectorIndex } from '../embeddings/vectorIndex';
import { retrieveContext } from '../retrieval/orchestrator';
import { lookupEntity } from '../retrieval/entityLookup';
import { appendDailyMemory } from '../memory/writer';
import type { Config } from '../config';
import type { EmbeddingProvider } from '../embeddings/types';

export function createMcpTools(
  db: Database.Database,
  vectorIndex: VectorIndex,
  provider: EmbeddingProvider,
  config: Pick<Config, 'vaultPath' | 'memoryDir' | 'priorityPaths'>
) {
  return {
    async memory_search(args: { query: string; topK?: number }) {
      const topK = Math.min(100, Math.max(1, args.topK ?? 5));
      const result = await retrieveContext(db, vectorIndex, provider, args.query, topK, config.priorityPaths ?? []);
      return result.hits;
    },

    async memory_entity(args: { name: string }) {
      return lookupEntity(db, args.name);
    },

    async memory_facts(args: { entityName: string }) {
      const entity = lookupEntity(db, args.entityName);
      if (!entity) return [];
      return db.prepare('SELECT * FROM facts WHERE subject_entity_id = ? ORDER BY updated_at DESC').all(entity.id) as any[];
    },

    async memory_status(_args: {}) {
      const counts = {
        notes: (db.prepare('SELECT COUNT(*) as c FROM notes').get() as any).c,
        chunks: (db.prepare('SELECT COUNT(*) as c FROM chunks').get() as any).c,
        entities: (db.prepare('SELECT COUNT(*) as c FROM entities').get() as any).c,
        facts: (db.prepare('SELECT COUNT(*) as c FROM facts').get() as any).c,
        relations: (db.prepare('SELECT COUNT(*) as c FROM relations').get() as any).c,
      };
      return counts;
    },

    async memory_remember(args: { text: string; date?: string; source?: string }) {
      const date = args.date ?? new Date().toISOString().substring(0, 10);
      const source = args.source ?? 'mcp';
      const filePath = await appendDailyMemory(config.vaultPath, date, { text: args.text, source }, config.memoryDir);
      return { ok: true, path: filePath };
    },

    async memory_store_fact(args: { subject: string; predicate: string; object: string; confidence?: number }) {
      const now = new Date().toISOString();
      const confidence = args.confidence ?? 0.8;

      // Find or create entity for subject
      let entity = lookupEntity(db, args.subject);
      let entityId: number;
      if (entity) {
        entityId = entity.id;
      } else {
        const row = db.prepare(
          `INSERT INTO entities (type, canonical_name, aliases_json, source_note, confidence, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
        ).get('concept', args.subject, '[]', '_mcp_', 1.0, now) as { id: number };
        entityId = row.id;
      }

      const row = db.prepare(
        `INSERT INTO facts (subject_entity_id, predicate, object_text, source_path, confidence, valid_from, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
      ).get(entityId, args.predicate, args.object, '_mcp_', confidence, now, now) as { id: number };

      return { ok: true, factId: row.id };
    },
  };
}

const TOOLS = [
  {
    name: 'memory_search',
    description: 'Search semantic memory. Returns relevant text chunks from the Obsidian vault ranked by semantic similarity, entity matching, graph relations, and fact overlap.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        topK: { type: 'number', description: 'Number of results (1-100, default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_entity',
    description: 'Look up an entity (person, project, concept) by name or alias. Returns entity details or null.',
    inputSchema: {
      type: 'object' as const,
      properties: { name: { type: 'string', description: 'Entity name or alias to look up' } },
      required: ['name'],
    },
  },
  {
    name: 'memory_facts',
    description: 'Get all known facts about an entity. Returns structured subject-predicate-object triples.',
    inputSchema: {
      type: 'object' as const,
      properties: { entityName: { type: 'string', description: 'Entity name to look up facts for' } },
      required: ['entityName'],
    },
  },
  {
    name: 'memory_status',
    description: 'Get memory index statistics: count of notes, chunks, entities, facts, and relations.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'memory_remember',
    description: 'Store a memory entry in the daily notes. Appends text to the daily note for the given date.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Text to remember' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format (defaults to today)' },
        source: { type: 'string', description: 'Source identifier (defaults to "mcp")' },
      },
      required: ['text'],
    },
  },
  {
    name: 'memory_store_fact',
    description: 'Store a structured fact. Creates entity if it does not exist. Format: subject-predicate-object (e.g. "Alice works_at Globex").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        subject: { type: 'string', description: 'Subject entity name' },
        predicate: { type: 'string', description: 'Predicate (e.g. works_at, is_a, uses, located_in)' },
        object: { type: 'string', description: 'Object value' },
        confidence: { type: 'number', description: 'Confidence score 0-1 (default 0.8)' },
      },
      required: ['subject', 'predicate', 'object'],
    },
  },
];

export async function startMcpServer(
  db: Database.Database,
  vectorIndex: VectorIndex,
  provider: EmbeddingProvider,
  config: Config
) {
  const server = new Server({ name: 'osm-memory', version: '1.0.0' }, { capabilities: { tools: {} } });
  const tools = createMcpTools(db, vectorIndex, provider, config);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = (tools as any)[name];
    if (!handler) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    try {
      const result = await handler(args ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [ ] **Step 4: Run MCP tests**

Run: `npx vitest run tests/mcp/server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts tests/mcp/server.test.ts
git commit -m "feat: add MCP server with 6 tools for agent connectivity"
```

---

### Task 10: API server tests

**Files:**
- Create: `tests/api/server.test.ts`

- [ ] **Step 1: Write API tests**

Create `tests/api/server.test.ts`:
```typescript
import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createServer } from '../../src/api/server';
import { openDb } from '../../src/db/client';
import { runMigrations } from '../../src/db/schema';
import { VectorIndex } from '../../src/embeddings/vectorIndex';
import fs from 'fs';

const DB = '/tmp/test-api.db';
afterEach(() => { if (fs.existsSync(DB)) fs.unlinkSync(DB); });

function createTestApp() {
  const db = openDb(DB);
  runMigrations(db);
  // Seed data
  db.prepare("INSERT INTO notes VALUES ('/v/john.md','John','person','h1','2026-03-30T00:00:00.000Z','{}')").run();
  db.prepare("INSERT INTO chunks (note_path,heading_path,text,start_line,end_line,token_count,chunk_hash) VALUES (?,?,?,?,?,?,?)")
    .run('/v/john.md', '', 'John is an engineer.', 0, 2, 5, 'h1');
  db.prepare("INSERT INTO entities (type,canonical_name,aliases_json,source_note,confidence,updated_at) VALUES (?,?,?,?,?,?)")
    .run('person', 'John', '["JD"]', '/v/john.md', 1.0, '2026-03-30');
  const entityId = (db.prepare('SELECT id FROM entities LIMIT 1').get() as any).id;
  db.prepare("INSERT INTO facts (subject_entity_id,predicate,object_text,source_path,confidence,valid_from,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run(entityId, 'works_at', 'Acme Corp', '/v/john.md', 0.9, '2026-03-30', '2026-03-30');

  const chunkId = (db.prepare('SELECT id FROM chunks LIMIT 1').get() as any).id;
  const idx = new VectorIndex(db, 4); idx.initTable();
  idx.upsert(chunkId, [1, 0, 0, 0]);

  const provider = { dimensions: 4, embed: vi.fn().mockResolvedValue([[0.9, 0, 0, 0]]) };
  const app = createServer(db, idx, provider as any, '/v', []);
  return { app, db };
}

describe('API server', () => {
  it('POST /retrieve-context returns hits', async () => {
    const { app, db } = createTestApp();
    const res = await request(app).post('/retrieve-context').send({ query: 'engineer' });
    expect(res.status).toBe(200);
    expect(res.body.hits.length).toBeGreaterThanOrEqual(1);
    expect(res.body.query).toBe('engineer');
    db.close();
  });

  it('POST /retrieve-context returns 400 without query', async () => {
    const { app, db } = createTestApp();
    const res = await request(app).post('/retrieve-context').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('query required');
    db.close();
  });

  it('GET /entity/:name returns entity', async () => {
    const { app, db } = createTestApp();
    const res = await request(app).get('/entity/John');
    expect(res.status).toBe(200);
    expect(res.body.canonical_name).toBe('John');
    db.close();
  });

  it('GET /entity/:name returns 404 for unknown', async () => {
    const { app, db } = createTestApp();
    const res = await request(app).get('/entity/Unknown');
    expect(res.status).toBe(404);
    db.close();
  });

  it('GET /facts/:entityId returns facts', async () => {
    const { app, db } = createTestApp();
    const entityId = (db.prepare('SELECT id FROM entities LIMIT 1').get() as any).id;
    const res = await request(app).get(`/facts/${entityId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].predicate).toBe('works_at');
    db.close();
  });

  it('GET /search?q= returns hits', async () => {
    const { app, db } = createTestApp();
    const res = await request(app).get('/search?q=engineer');
    expect(res.status).toBe(200);
    expect(res.body.hits.length).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it('GET /search returns 400 without q', async () => {
    const { app, db } = createTestApp();
    const res = await request(app).get('/search');
    expect(res.status).toBe(400);
    db.close();
  });
});
```

- [ ] **Step 2: Run API tests**

Run: `npx vitest run tests/api/server.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/api/server.test.ts
git commit -m "test: add API server endpoint tests"
```

---

### Task 11: Watcher tests

**Files:**
- Create: `tests/watcher/watcher.test.ts`

- [ ] **Step 1: Write watcher tests**

Create `tests/watcher/watcher.test.ts`:
```typescript
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { openDb } from '../../src/db/client';
import { runMigrations } from '../../src/db/schema';
import fs from 'fs';

const DB = '/tmp/test-watcher.db';

// Mock chokidar
const mockOn = vi.fn().mockReturnThis();
const mockClose = vi.fn();
vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({ on: mockOn, close: mockClose })),
  },
}));

// Mock indexFile
vi.mock('../../src/indexer/pipeline', () => ({
  indexFile: vi.fn().mockResolvedValue(undefined),
}));

import { startWatcher } from '../../src/watcher/watcher';
import { indexFile } from '../../src/indexer/pipeline';
import chokidar from 'chokidar';

beforeEach(() => {
  vi.clearAllMocks();
  mockOn.mockReturnThis();
});

afterEach(() => { if (fs.existsSync(DB)) fs.unlinkSync(DB); });

describe('startWatcher', () => {
  it('registers add, change, and unlink handlers', () => {
    const db = openDb(DB); runMigrations(db);
    startWatcher('/vault', db, {});
    const events = mockOn.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('add');
    expect(events).toContain('change');
    expect(events).toContain('unlink');
    db.close();
  });

  it('watches correct glob pattern', () => {
    const db = openDb(DB); runMigrations(db);
    startWatcher('/vault', db, {});
    expect(chokidar.watch).toHaveBeenCalledWith(
      expect.stringContaining('**/*.md'),
      expect.objectContaining({ persistent: true, ignoreInitial: true })
    );
    db.close();
  });

  it('unlink handler deletes note and relations', () => {
    const db = openDb(DB); runMigrations(db);
    // Seed a note
    db.prepare("INSERT INTO notes VALUES ('/vault/test.md','Test',null,'h','2026-03-30','{}')").run();
    db.prepare("INSERT INTO entities (type,canonical_name,aliases_json,source_note,confidence,updated_at) VALUES (?,?,?,?,?,?)")
      .run('note', 'Test', '[]', '/vault/test.md', 1.0, '2026-03-30');

    startWatcher('/vault', db, {});

    // Find the unlink handler and call it
    const unlinkCall = mockOn.mock.calls.find((c: any[]) => c[0] === 'unlink');
    expect(unlinkCall).toBeTruthy();
    const unlinkHandler = unlinkCall![1];
    unlinkHandler('/vault/test.md');

    // Verify note was deleted (cascade deletes entities)
    const note = db.prepare('SELECT * FROM notes WHERE path = ?').get('/vault/test.md');
    expect(note).toBeUndefined();
    db.close();
  });
});
```

- [ ] **Step 2: Run watcher tests**

Run: `npx vitest run tests/watcher/watcher.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/watcher/watcher.test.ts
git commit -m "test: add file watcher tests"
```

---

### Task 12: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README with MCP, local embeddings, new config**

Rewrite `/path/to/obsidian-semantic-memory/README.md` to include:

1. Updated description mentioning MCP server
2. **MCP Setup** section — how to add to Claude Code / Cursor config
3. **Local Embeddings** section — `EMBEDDING_PROVIDER=local`, model info, cache location
4. Updated **Configuration** table with new env vars: `MEMORY_DIR`, `EMBEDDING_MODEL`, updated `EMBEDDING_PROVIDER` (now supports `local`)
5. Updated **Known Limitations** — remove "OpenAI-only" limitation, update token estimation to "gpt-tokenizer"
6. Updated CLI commands — add `osm-memory mcp`

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with MCP setup, local embeddings, new config options"
```

---

### Task 13: Full test run and type check

- [ ] **Step 1: TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Fix any failures**

If any tests fail, fix them. Common issues:
- Token count changes from gpt-tokenizer (update expected values)
- Import path issues for new modules
- Config test assertions for old defaults

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: fix any remaining test/type issues after full implementation"
```

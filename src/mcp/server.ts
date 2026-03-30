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
        // Ensure sentinel note exists for MCP-created entities
        db.prepare(
          `INSERT OR IGNORE INTO notes (path, title, kind, note_hash, modified_at, frontmatter_json) VALUES ('_mcp_', 'MCP', 'system', '_mcp_', ?, '{}')`
        ).run(now);
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

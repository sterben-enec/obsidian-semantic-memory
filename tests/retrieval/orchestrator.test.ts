import { describe, it, expect, afterEach, vi } from 'vitest';
import { retrieveContext } from '../../src/retrieval/orchestrator';
import { openDb } from '../../src/db/client';
import { runMigrations } from '../../src/db/schema';
import { VectorIndex } from '../../src/embeddings/vectorIndex';
import fs from 'fs';

const DB = '/tmp/test-orch.db';
afterEach(() => { if (fs.existsSync(DB)) fs.unlinkSync(DB); });

describe('retrieveContext', () => {
  it('returns hits with reason field', async () => {
    const db = openDb(DB); runMigrations(db);
    db.prepare("INSERT INTO notes VALUES ('/v/john.md','John Doe','person','h','2026-03-30','{}')").run();
    db.prepare("INSERT INTO chunks (note_path,heading_path,text,start_line,end_line,token_count,chunk_hash) VALUES (?,?,?,?,?,?,?)")
      .run('/v/john.md','','John at Acme.',0,2,5,'h1');
    const id = (db.prepare('SELECT id FROM chunks LIMIT 1').get() as any).id;
    const idx = new VectorIndex(db, 4); idx.initTable(); idx.upsert(id, [1,0,0,0]);
    const provider = { dimensions:4, embed: vi.fn().mockResolvedValue([[0.9,0,0,0]]) };

    const result = await retrieveContext(db, idx, provider, 'John', 5, ['OpenClaw Memory/', 'Projects/', 'Infrastructure/']);
    expect(result.hits.length).toBeGreaterThanOrEqual(1);
    expect(result.hits[0].reason).toBeTruthy();
    db.close();
  });

  it('boosts priority paths', async () => {
    const db = openDb(DB); runMigrations(db);
    // Two notes: one in OpenClaw Memory (priority), one generic
    db.prepare("INSERT INTO notes VALUES ('/v/OpenClaw Memory/User.md','User','preference','h1','2026-03-30','{}')").run();
    db.prepare("INSERT INTO notes VALUES ('/v/scratch.md','Scratch',null,'h2','2026-03-30','{}')").run();

    db.prepare("INSERT INTO chunks (note_path,heading_path,text,start_line,end_line,token_count,chunk_hash) VALUES (?,?,?,?,?,?,?)")
      .run('/v/OpenClaw Memory/User.md','','Priority content.',0,2,5,'h1');
    db.prepare("INSERT INTO chunks (note_path,heading_path,text,start_line,end_line,token_count,chunk_hash) VALUES (?,?,?,?,?,?,?)")
      .run('/v/scratch.md','','Generic content.',0,2,5,'h2');

    const id1 = (db.prepare('SELECT id FROM chunks WHERE chunk_hash=?').get('h1') as any).id;
    const id2 = (db.prepare('SELECT id FROM chunks WHERE chunk_hash=?').get('h2') as any).id;

    const idx = new VectorIndex(db, 4); idx.initTable();
    idx.upsert(id1, [1, 0, 0, 0]);
    idx.upsert(id2, [0.95, 0, 0, 0]); // slightly lower semantic score

    const provider = { dimensions:4, embed: vi.fn().mockResolvedValue([[1,0,0,0]]) };
    const result = await retrieveContext(db, idx, provider, 'content', 5, ['OpenClaw Memory/', 'Projects/', 'Infrastructure/']);

    // Priority note should rank first despite slightly lower base score
    expect(result.hits[0].notePath).toContain('OpenClaw Memory');
    db.close();
  });

  it('includes graph-related notes in results', async () => {
    const db = openDb(DB); runMigrations(db);

    // Create two notes with entities
    db.prepare("INSERT INTO notes VALUES ('/v/alpha.md','Alpha','project','h1','2026-03-30','{}')").run();
    db.prepare("INSERT INTO notes VALUES ('/v/john.md','John','person','h2','2026-03-30','{}')").run();

    // Chunks
    db.prepare("INSERT INTO chunks (note_path,heading_path,text,start_line,end_line,token_count,chunk_hash) VALUES (?,?,?,?,?,?,?)")
      .run('/v/alpha.md','','Alpha project uses Redis for caching.',0,2,10,'h1');
    db.prepare("INSERT INTO chunks (note_path,heading_path,text,start_line,end_line,token_count,chunk_hash) VALUES (?,?,?,?,?,?,?)")
      .run('/v/john.md','','John is a Redis expert at Acme.',0,2,8,'h2');

    // Entities
    db.prepare("INSERT INTO entities (type,canonical_name,aliases_json,source_note,confidence,updated_at) VALUES (?,?,?,?,?,?)")
      .run('project','Alpha','[]','/v/alpha.md',1.0,'2026-03-30');
    db.prepare("INSERT INTO entities (type,canonical_name,aliases_json,source_note,confidence,updated_at) VALUES (?,?,?,?,?,?)")
      .run('person','John','[]','/v/john.md',1.0,'2026-03-30');

    // Relation: Alpha links_to John
    const alphaId = (db.prepare("SELECT id FROM entities WHERE canonical_name='Alpha'").get() as any).id;
    const johnId = (db.prepare("SELECT id FROM entities WHERE canonical_name='John'").get() as any).id;
    db.prepare("INSERT INTO relations (source_entity_id,relation,target_entity_id,source_note,confidence) VALUES (?,?,?,?,?)")
      .run(alphaId, 'links_to', johnId, '/v/alpha.md', 1.0);

    // Only embed Alpha's chunk — John's chunk is intentionally not in the vector index
    // so John can only be reached via graph expansion
    const chunkId1 = (db.prepare("SELECT id FROM chunks WHERE chunk_hash='h1'").get() as any).id;
    const idx = new VectorIndex(db, 4); idx.initTable();
    idx.upsert(chunkId1, [1,0,0,0]);

    const provider = { dimensions:4, embed: vi.fn().mockResolvedValue([[1,0,0,0]]) };
    const result = await retrieveContext(db, idx, provider, 'Redis caching', 5, []);

    // Alpha should be found semantically, John should appear via graph relation
    const paths = result.hits.map(h => h.notePath);
    expect(paths).toContain('/v/alpha.md');
    expect(paths).toContain('/v/john.md');

    // John's hit should have 'graph' in reason
    const johnHit = result.hits.find(h => h.notePath === '/v/john.md');
    expect(johnHit?.reason).toContain('graph');

    db.close();
  });

  it('boosts hits with matching facts', async () => {
    const db = openDb(DB); runMigrations(db);

    db.prepare("INSERT INTO notes VALUES ('/v/john.md','John','person','h1','2026-03-30','{}')").run();
    db.prepare("INSERT INTO chunks (note_path,heading_path,text,start_line,end_line,token_count,chunk_hash) VALUES (?,?,?,?,?,?,?)")
      .run('/v/john.md','','John is an engineer.',0,2,5,'h1');

    const chunkId = (db.prepare("SELECT id FROM chunks LIMIT 1").get() as any).id;

    db.prepare("INSERT INTO entities (type,canonical_name,aliases_json,source_note,confidence,updated_at) VALUES (?,?,?,?,?,?)")
      .run('person','John','[]','/v/john.md',1.0,'2026-03-30');
    const entityId = (db.prepare("SELECT id FROM entities LIMIT 1").get() as any).id;

    // Add a fact: John works_at Acme
    db.prepare("INSERT INTO facts (subject_entity_id,predicate,object_text,source_path,confidence,valid_from,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run(entityId, 'works_at', 'Acme Corp', '/v/john.md', 0.9, '2026-03-30', '2026-03-30');

    const idx = new VectorIndex(db, 4); idx.initTable();
    idx.upsert(chunkId, [1,0,0,0]);

    const provider = { dimensions:4, embed: vi.fn().mockResolvedValue([[0.9,0,0,0]]) };

    // Search for "Acme" — should match via fact
    const result = await retrieveContext(db, idx, provider, 'Acme', 5, []);
    expect(result.hits.length).toBeGreaterThanOrEqual(1);
    expect(result.hits[0].reason).toContain('fact');

    db.close();
  });
});

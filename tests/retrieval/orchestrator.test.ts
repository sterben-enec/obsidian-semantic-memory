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

    const result = await retrieveContext(db, idx, provider, 'John');
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
    const result = await retrieveContext(db, idx, provider, 'content');

    // Priority note should rank first despite slightly lower base score
    expect(result.hits[0].notePath).toContain('OpenClaw Memory');
    db.close();
  });
});

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
    expect(res.body.canonicalName).toBe('John');
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

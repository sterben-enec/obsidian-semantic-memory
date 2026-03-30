import { describe, it, expect, afterEach, vi } from 'vitest';
import { indexFile, indexVault } from '../../src/indexer/pipeline';
import { openDb } from '../../src/db/client';
import { runMigrations } from '../../src/db/schema';
import path from 'path';
import fs from 'fs';

const DB = '/tmp/test-pipeline.db';
const VAULT = path.resolve('fixtures/vault');
afterEach(() => { if (fs.existsSync(DB)) fs.unlinkSync(DB); });

describe('indexFile', () => {
  it('inserts note and chunks', async () => {
    const db = openDb(DB); runMigrations(db);
    await indexFile(db, `${VAULT}/People/John.md`);
    const note = db.prepare('SELECT * FROM notes WHERE path LIKE ?').get('%John.md') as any;
    expect(note).toBeTruthy();
    expect(note.title).toBe('John Doe');
    const chunks = db.prepare('SELECT * FROM chunks WHERE note_path = ?').all(note.path);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it('is idempotent — indexing same file twice does not duplicate rows', async () => {
    const db = openDb(DB); runMigrations(db);
    const f = `${VAULT}/People/John.md`;
    await indexFile(db, f);
    await indexFile(db, f);
    expect((db.prepare('SELECT count(*) as c FROM notes WHERE path LIKE ?').get('%John.md') as any).c).toBe(1);
    db.close();
  });

  it('extracts entity from frontmatter', async () => {
    const db = openDb(DB); runMigrations(db);
    await indexFile(db, `${VAULT}/People/John.md`);
    const entity = db.prepare('SELECT * FROM entities WHERE canonical_name = ?').get('John Doe') as any;
    expect(entity).toBeTruthy();
    expect(entity.type).toBe('person');
    db.close();
  });

  it('extracts facts from frontmatter', async () => {
    const db = openDb(DB); runMigrations(db);
    await indexFile(db, `${VAULT}/Projects/Alpha.md`);
    const facts = db.prepare('SELECT * FROM facts WHERE source_path LIKE ?').all('%Alpha.md') as any[];
    expect(facts.length).toBeGreaterThanOrEqual(1);
    const statusFact = facts.find(f => f.predicate === 'status');
    expect(statusFact?.object_text).toBe('active');
    db.close();
  });

  it('stores embeddings when provider given', async () => {
    const db = openDb(DB); runMigrations(db);
    const embedded: Array<{id: number, vec: number[]}> = [];
    const mockProvider = { dimensions: 4, embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3, 0.4]]) };
    const mockIndex = { upsert: vi.fn((id: number, vec: number[]) => embedded.push({id, vec})) };

    await indexFile(db, `${VAULT}/People/John.md`, { embeddingProvider: mockProvider, vectorIndex: mockIndex });
    expect(mockProvider.embed).toHaveBeenCalled();
    expect(mockIndex.upsert).toHaveBeenCalled();
    db.close();
  });
});

describe('indexVault', () => {
  it('indexes all markdown files in vault', async () => {
    const db = openDb(DB); runMigrations(db);
    await indexVault(db, VAULT);
    expect((db.prepare('SELECT count(*) as c FROM notes').get() as any).c).toBeGreaterThanOrEqual(4);
    db.close();
  });
});

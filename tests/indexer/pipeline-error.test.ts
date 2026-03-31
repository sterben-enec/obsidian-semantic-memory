import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { indexVault } from '../../src/indexer/pipeline';
import { openDb } from '../../src/db/client';
import { runMigrations } from '../../src/db/schema';

const DB = '/tmp/test-pipeline-error.db';
const VAULT = path.resolve('fixtures/vault');

afterEach(() => {
  if (fs.existsSync(DB)) fs.unlinkSync(DB);
});

describe('indexVault error handling', () => {
  it('continues indexing and counts errors when embedding throws for one file', async () => {
    const db = openDb(DB);
    runMigrations(db);

    let calls = 0;
    // The mock embedding provider throws on the first embed() call, passes on the rest
    const mockProvider = {
      dimensions: 4,
      embed: async (texts: string[]) => {
        if (calls++ === 0) throw new Error('simulated embed failure');
        return texts.map(() => [0.1, 0.2, 0.3, 0.4]);
      },
    };
    const mockIndex = { upsert: () => {}, delete: () => {} };

    const stats = await indexVault(
      db,
      VAULT,
      { embeddingProvider: mockProvider, vectorIndex: mockIndex },
    );

    expect(stats.errors).toBe(1);
    expect(stats.indexed).toBe(stats.total - 1);
    expect(stats.total).toBeGreaterThanOrEqual(4);

    db.close();
  });
});

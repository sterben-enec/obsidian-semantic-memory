import { describe, it, expect, afterEach } from 'vitest';
import { openDb } from '../../src/db/client';
import { runMigrations } from '../../src/db/schema';
import fs from 'fs';

const DB_PATH = '/tmp/test-schema.db';
afterEach(() => { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); });

describe('runMigrations', () => {
  it('creates all required tables', () => {
    const db = openDb(DB_PATH);
    runMigrations(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all().map((r: any) => r.name);
    ['notes','chunks','entities','facts','relations','write_events'].forEach(t =>
      expect(tables).toContain(t)
    );
    db.close();
  });

  it('is idempotent', () => {
    const db = openDb(DB_PATH);
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
    db.close();
  });
});

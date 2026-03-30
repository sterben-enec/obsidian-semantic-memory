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
  db.prepare(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`).run();

  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
  let currentVersion = row?.version ?? 0;

  // If DB has no version but has tables (existing install), assume v1
  if (currentVersion === 0) {
    const hasNotes = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notes'").get();
    if (hasNotes) {
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

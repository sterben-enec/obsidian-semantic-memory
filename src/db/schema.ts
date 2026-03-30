import Database from 'better-sqlite3';

const DDL_STATEMENTS = [
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
];

export function runMigrations(db: Database.Database): void {
  DDL_STATEMENTS.forEach(sql => db.prepare(sql).run());
}

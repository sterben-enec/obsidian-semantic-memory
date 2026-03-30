import fs from 'fs/promises';
import Database from 'better-sqlite3';
import { hashContent } from './hasher';
import { parseNote } from './parser';
import { chunkNote } from './chunker';
import { walkVault } from './walker';

export interface IndexOptions {
  embeddingProvider?: { embed(texts: string[]): Promise<number[][]>; dimensions: number };
  vectorIndex?: { upsert(id: number, embedding: number[]): void };
}

const FACT_PREDICATES = ['owner', 'status', 'updated', 'tags'] as const;

export async function indexFile(
  db: Database.Database,
  filePath: string,
  options: IndexOptions = {}
): Promise<void> {
  // 1. Read file content
  const content = await fs.readFile(filePath, 'utf8');

  // 2. Hash content
  const noteHash = hashContent(content);

  // 3. Check if unchanged
  const existing = db.prepare('SELECT note_hash FROM notes WHERE path = ?').get(filePath) as { note_hash: string } | undefined;
  if (existing && existing.note_hash === noteHash) {
    return; // unchanged — skip
  }

  // 4. Parse note
  const parsed = parseNote(filePath, content);

  // 5. Get mtime
  const stat = await fs.stat(filePath);
  const modifiedAt = stat.mtime.toISOString();

  const now = new Date().toISOString();
  const kind = (parsed.frontmatter.kind as string | undefined) ?? null;

  // Delete stale vector rows for this note's old chunks
  if (options.vectorIndex) {
    const oldChunkIds = db.prepare(
      'SELECT id FROM chunks WHERE note_path = ?'
    ).all(filePath).map((r: any) => r.id as number);
    for (const id of oldChunkIds) {
      options.vectorIndex.delete(id);
    }
  }

  // 6-11. Wrap all DB mutations in a transaction
  const upsertAll = db.transaction(() => {
    // 6. Upsert note row
    db.prepare(`
      INSERT INTO notes (path, title, kind, note_hash, modified_at, frontmatter_json)
      VALUES (@path, @title, @kind, @noteHash, @modifiedAt, @frontmatterJson)
      ON CONFLICT(path) DO UPDATE SET
        title = excluded.title,
        kind = excluded.kind,
        note_hash = excluded.note_hash,
        modified_at = excluded.modified_at,
        frontmatter_json = excluded.frontmatter_json
    `).run({
      path: filePath,
      title: parsed.title,
      kind,
      noteHash,
      modifiedAt,
      frontmatterJson: JSON.stringify(parsed.frontmatter),
    });

    // 7. Delete old chunks
    db.prepare('DELETE FROM chunks WHERE note_path = ?').run(filePath);

    // 8. Chunk and insert, collecting inserted IDs
    const chunks = chunkNote(parsed);
    const insertChunk = db.prepare(`
      INSERT INTO chunks (note_path, heading_path, text, start_line, end_line, token_count, chunk_hash)
      VALUES (@notePath, @headingPath, @text, @startLine, @endLine, @tokenCount, @chunkHash)
      RETURNING id
    `);

    const insertedChunks: Array<{ id: number; text: string }> = [];
    for (const chunk of chunks) {
      const chunkHash = hashContent(chunk.text);
      const row = insertChunk.get({
        notePath: chunk.notePath,
        headingPath: chunk.headingPath,
        text: chunk.text,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        tokenCount: chunk.tokenCount,
        chunkHash,
      }) as { id: number };
      insertedChunks.push({ id: row.id, text: chunk.text });
    }

    // 10. Extract entities — delete old, insert new
    db.prepare('DELETE FROM entities WHERE source_note = ?').run(filePath);

    const rawAliases = parsed.frontmatter.aliases;
    const aliases = Array.isArray(rawAliases)
      ? rawAliases.map(String)
      : typeof rawAliases === 'string'
      ? [rawAliases]
      : [];

    const entityRow = db.prepare(`
      INSERT INTO entities (type, canonical_name, aliases_json, source_note, confidence, updated_at)
      VALUES (@type, @canonicalName, @aliasesJson, @sourceNote, @confidence, @updatedAt)
      RETURNING id
    `).get({
      type: kind ?? 'note',
      canonicalName: parsed.title,
      aliasesJson: JSON.stringify(aliases),
      sourceNote: filePath,
      confidence: 1.0,
      updatedAt: now,
    }) as { id: number };

    // 11. Extract facts — delete old, insert new
    db.prepare('DELETE FROM facts WHERE source_path = ?').run(filePath);

    const insertFact = db.prepare(`
      INSERT INTO facts (subject_entity_id, predicate, object_text, source_path, confidence, valid_from, updated_at)
      VALUES (@subjectEntityId, @predicate, @objectText, @sourcePath, @confidence, @validFrom, @updatedAt)
    `);

    for (const predicate of FACT_PREDICATES) {
      const value = parsed.frontmatter[predicate];
      if (value === undefined || value === null) continue;
      const objectText = Array.isArray(value) ? value.join(', ') : String(value);
      insertFact.run({
        subjectEntityId: entityRow.id,
        predicate,
        objectText,
        sourcePath: filePath,
        confidence: 1.0,
        validFrom: now,
        updatedAt: now,
      });
    }

    return insertedChunks;
  });

  const insertedChunks = upsertAll() as Array<{ id: number; text: string }>;

  // 9. Embed chunks if provider given (outside transaction — async)
  if (options.embeddingProvider && options.vectorIndex) {
    const { embeddingProvider, vectorIndex } = options;
    const texts = insertedChunks.map(c => c.text);
    if (texts.length > 0) {
      const embeddings = await embeddingProvider.embed(texts);
      for (let i = 0; i < insertedChunks.length; i++) {
        if (embeddings[i]) {
          vectorIndex.upsert(insertedChunks[i].id, embeddings[i]);
        }
      }
    }
  }
}

export async function indexVault(
  db: Database.Database,
  vaultPath: string,
  options: IndexOptions = {}
): Promise<void> {
  const files = await walkVault(vaultPath);
  for (const filePath of files) {
    await indexFile(db, filePath, options);
  }
}

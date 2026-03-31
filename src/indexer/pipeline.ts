import fs from 'fs/promises';
import Database from 'better-sqlite3';
import { hashContent } from './hasher';
import { parseNote } from './parser';
import { chunkNote } from './chunker';
import { walkVault } from './walker';
import type { ExtractedFact } from '../extraction/factExtractor';

export interface IndexOptions {
  embeddingProvider?: { embed(texts: string[]): Promise<number[][]>; dimensions: number };
  vectorIndex?: { upsert(id: number, embedding: number[]): void; delete(id: number): void };
  chunkOptions?: { maxTokens?: number; overlapTokens?: number };
  factExtractor?: (noteTitle: string, noteBody: string) => Promise<ExtractedFact[]>;
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

  // Fix #2: Use two-phase note_hash commit. If embedding is configured, store ''
  // so that a failed embed() causes the file to be re-processed on the next run.
  // Store the real hash only after embeddings succeed (or immediately if no provider).
  const embeddingConfigured = !!(options.embeddingProvider && options.vectorIndex);
  const transactionHash = embeddingConfigured ? '' : noteHash;

  // 6-12. Wrap all DB mutations in a transaction.
  // Fix #1: Query old chunk IDs inside the transaction so they are only deleted
  // from the vector index AFTER the transaction commits successfully.
  const upsertAll = db.transaction(() => {
    // Collect old chunk IDs for vector deletion after commit
    const oldChunkIds = db.prepare(
      'SELECT id FROM chunks WHERE note_path = ?'
    ).all(filePath).map((r: any) => r.id as number);

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
      noteHash: transactionHash,
      modifiedAt,
      frontmatterJson: JSON.stringify(parsed.frontmatter),
    });

    // 7. Delete old chunks
    db.prepare('DELETE FROM chunks WHERE note_path = ?').run(filePath);

    // 8. Chunk and insert, collecting inserted IDs
    const chunks = chunkNote(parsed, options.chunkOptions);
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

    // 12. Save wikilink relations — delete old, insert new
    db.prepare('DELETE FROM relations WHERE source_note = ?').run(filePath);

    // Fix #4: Use ESCAPE clause to prevent LIKE injection from % and _ in wikilinks
    const findTargetEntity = db.prepare(
      `SELECT e.id FROM entities e JOIN notes n ON e.source_note = n.path
       WHERE n.path LIKE ? ESCAPE '\\' OR e.canonical_name = ? COLLATE NOCASE LIMIT 1`
    );

    const insertRelation = db.prepare(`
      INSERT INTO relations (source_entity_id, relation, target_entity_id, source_note, confidence)
      VALUES (?, 'links_to', ?, ?, 1.0)
    `);

    for (const wikilink of parsed.wikilinks) {
      // Escape LIKE metacharacters to prevent injection
      const safePath = wikilink.replace(/[%_\\]/g, '\\$&');
      const target = findTargetEntity.get(`%/${safePath}.md`, wikilink) as { id: number } | undefined;
      if (target) {
        insertRelation.run(entityRow.id, target.id, filePath);
      }
    }

    return { insertedChunks, oldChunkIds, entityId: entityRow.id };
  });

  // Fix #1 (cont): Delete old vectors only after transaction commits successfully
  const { insertedChunks, oldChunkIds, entityId } = upsertAll() as {
    insertedChunks: Array<{ id: number; text: string }>;
    oldChunkIds: number[];
    entityId: number;
  };

  if (options.vectorIndex) {
    for (const id of oldChunkIds) {
      options.vectorIndex.delete(id);
    }
  }

  // 9. Embed chunks if provider given (outside transaction — async)
  if (options.embeddingProvider && options.vectorIndex) {
    const { embeddingProvider, vectorIndex } = options;
    const texts = insertedChunks.map(c => c.text);
    if (texts.length > 0) {
      const embeddings = await embeddingProvider.embed(texts);

      // Fix #3: Warn on embedding count mismatch instead of silently losing vectors
      if (embeddings.length !== texts.length) {
        console.error(
          `[pipeline] embedding count mismatch: expected ${texts.length}, got ${embeddings.length} for ${filePath}`
        );
      }

      for (let i = 0; i < insertedChunks.length; i++) {
        if (embeddings[i]) {
          vectorIndex.upsert(insertedChunks[i].id, embeddings[i]);
        }
      }
    }

    // Fix #2 (cont): Commit the real note_hash only after embedding succeeds
    db.prepare('UPDATE notes SET note_hash = ? WHERE path = ?').run(noteHash, filePath);
  }

  // 11b. LLM fact extraction — runs outside transaction, after embeddings (async/network)
  if (options.factExtractor) {
    try {
      const llmFacts = await options.factExtractor(parsed.title, parsed.body);
      if (llmFacts.length > 0) {
        const insertLlmFact = db.prepare(`
          INSERT INTO facts (subject_entity_id, predicate, object_text, source_path, confidence, valid_from, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const fact of llmFacts) {
          insertLlmFact.run(entityId, fact.predicate, `${fact.subject}: ${fact.object}`, filePath, fact.confidence, now, now);
        }
      }
    } catch (err) {
      console.error(`[pipeline] LLM extraction failed for ${filePath}:`, (err as Error).message);
    }
  }
}

export async function indexVault(
  db: Database.Database,
  vaultPath: string,
  options: IndexOptions = {},
  concurrency = 5
): Promise<{ total: number; indexed: number; errors: number }> {
  const files = await walkVault(vaultPath);
  const total = files.length;
  let indexed = 0;
  let errors = 0;
  let fileIdx = 0;
  let active = 0;

  if (total === 0) return { total: 0, indexed: 0, errors: 0 };

  console.log(`[index] starting: ${total} files, concurrency ${concurrency}`);

  return new Promise((resolve) => {
    function onComplete() {
      const done = indexed + errors;
      if (done % 50 === 0 || done === total) {
        console.log(`[index] ${done}/${total} files (${errors} errors)`);
      }
      if (done === total) {
        resolve({ total, indexed, errors });
      } else {
        next();
      }
    }

    function next() {
      while (active < concurrency && fileIdx < total) {
        const filePath = files[fileIdx++];
        active++;
        indexFile(db, filePath, options).then(
          () => {
            indexed++;
            active--;
            onComplete();
          },
          (err: unknown) => {
            errors++;
            active--;
            console.error(`[index] error indexing ${filePath}:`, err);
            onComplete();
          }
        );
      }
    }

    next();
  });
}

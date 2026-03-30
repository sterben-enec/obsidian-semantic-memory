import Database from 'better-sqlite3';
import { VectorIndex } from '../embeddings/vectorIndex';
import { semanticSearch } from './semantic';
import { lookupEntity } from './entityLookup';

export interface RetrievalHit { notePath: string; chunkId: number; headingPath: string; text: string; score: number; reason: string }
export interface RetrievalResult { query: string; hits: RetrievalHit[] }

interface ProviderLike { embed(texts: string[]): Promise<number[][]> }

function getEntityIdsForNotes(db: Database.Database, notePaths: string[]): Array<{ id: number; notePath: string }> {
  if (notePaths.length === 0) return [];
  const placeholders = notePaths.map(() => '?').join(',');
  return (db.prepare(
    `SELECT id, source_note as notePath FROM entities WHERE source_note IN (${placeholders})`
  ).all(...notePaths) as any[]).map(r => ({ id: r.id, notePath: r.notePath }));
}

function getRelatedEntityIds(db: Database.Database, entityIds: Array<{ id: number }>): number[] {
  if (entityIds.length === 0) return [];
  const ids = entityIds.map(e => e.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT DISTINCT target_entity_id as id FROM relations WHERE source_entity_id IN (${placeholders})
     UNION
     SELECT DISTINCT source_entity_id as id FROM relations WHERE target_entity_id IN (${placeholders})`
  ).all(...ids, ...ids) as any[];
  const existing = new Set(ids);
  return rows.map(r => r.id).filter(id => !existing.has(id));
}

function getNotesForEntities(db: Database.Database, entityIds: number[]): string[] {
  if (entityIds.length === 0) return [];
  const placeholders = entityIds.map(() => '?').join(',');
  return (db.prepare(
    `SELECT DISTINCT source_note FROM entities WHERE id IN (${placeholders})`
  ).all(...entityIds) as any[]).map(r => r.source_note);
}

function getBestChunksForNotes(db: Database.Database, notePaths: string[], limit: number): Array<{
  notePath: string; chunkId: number; headingPath: string; text: string; startLine: number; endLine: number
}> {
  if (notePaths.length === 0) return [];
  const placeholders = notePaths.map(() => '?').join(',');
  return (db.prepare(
    `SELECT chunkId, notePath, headingPath, text, startLine, endLine FROM (
       SELECT id as chunkId, note_path as notePath, heading_path as headingPath, text, start_line as startLine, end_line as endLine,
         ROW_NUMBER() OVER (PARTITION BY note_path ORDER BY token_count DESC) as rn
       FROM chunks WHERE note_path IN (${placeholders})
     ) WHERE rn = 1
     LIMIT ?`
  ).all(...notePaths, limit) as any[]);
}

export async function retrieveContext(
  db: Database.Database, vectorIndex: VectorIndex, provider: ProviderLike,
  query: string, topK = 5, priorityPaths: string[] = []
): Promise<RetrievalResult> {
  const semanticHits = await semanticSearch(db, vectorIndex, provider, query, topK * 2);
  const entityHit = lookupEntity(db, query.trim());

  const scored = semanticHits.map(h => {
    let score = h.score; let reason = 'semantic';
    if (priorityPaths.some(p => h.notePath.includes('/' + p) || h.notePath.startsWith(p))) { score += 0.1; reason = 'semantic+priority'; }
    if (entityHit?.sourceNote === h.notePath) { score += 0.2; reason = 'semantic+entity'; }
    // Time-decay recency: +0.1 for today, linearly decaying to 0 over 30 days
    const noteRow = db.prepare('SELECT modified_at FROM notes WHERE path = ?').get(h.notePath) as { modified_at: string } | undefined;
    if (noteRow) {
      const daysSince = (Date.now() - new Date(noteRow.modified_at).getTime()) / 86400000;
      const recencyBoost = Math.max(0, 0.1 * (1 - daysSince / 30));
      if (recencyBoost > 0.001) { score += recencyBoost; reason += '+recency'; }
    }
    return { ...h, score, reason };
  });

  // Graph expansion
  const hitNotePaths = [...new Set(semanticHits.map(h => h.notePath))];
  const hitEntityIds = getEntityIdsForNotes(db, hitNotePaths);

  const relatedEntityIds = getRelatedEntityIds(db, hitEntityIds);

  const relatedNotePaths = getNotesForEntities(db, relatedEntityIds);
  const newPaths = relatedNotePaths.filter(p => !hitNotePaths.includes(p));

  if (newPaths.length > 0) {
    const relatedChunks = getBestChunksForNotes(db, newPaths, topK);
    for (const chunk of relatedChunks) {
      scored.push({
        ...chunk,
        score: 0.3,
        reason: 'graph'
      });
    }
  }

  // Fact-aware boost
  const queryWords = query.toLowerCase().split(/\s+/);
  for (const hit of scored) {
    const entityForNote = hitEntityIds.find(e => e.notePath === hit.notePath);
    if (entityForNote) {
      const facts = db.prepare(
        'SELECT predicate, object_text FROM facts WHERE subject_entity_id = ?'
      ).all(entityForNote.id) as any[];

      const factMatch = facts.some(f =>
        queryWords.some(w =>
          (f.object_text ?? '').toLowerCase().includes(w) ||
          (f.predicate ?? '').toLowerCase().includes(w)
        )
      );
      if (factMatch) {
        hit.score += 0.15;
        hit.reason += '+fact';
      }
    }
  }

  return {
    query,
    hits: scored.sort((a, b) => b.score - a.score).slice(0, topK)
      .map(h => ({ notePath: h.notePath, chunkId: h.chunkId, headingPath: h.headingPath, text: h.text, score: h.score, reason: h.reason }))
  };
}

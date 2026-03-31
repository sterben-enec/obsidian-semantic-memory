import Database from 'better-sqlite3';
import { VectorIndex } from '../embeddings/vectorIndex';

export interface SemanticHit {
  notePath: string; chunkId: number; headingPath: string;
  text: string; score: number; startLine: number; endLine: number;
}

interface EmbeddingProviderLike {
  embed(texts: string[]): Promise<number[][]>;
  embedQuery?(text: string): Promise<number[]>;
}

export async function semanticSearch(
  db: Database.Database,
  vectorIndex: VectorIndex,
  provider: EmbeddingProviderLike,
  query: string,
  topK: number
): Promise<SemanticHit[]> {
  const queryEmbedding = provider.embedQuery
    ? await provider.embedQuery(query)
    : (await provider.embed([query]))[0];
  const hits = vectorIndex.search(queryEmbedding, topK);
  if (hits.length === 0) return [];

  const scoreMap = new Map(hits.map(h => [h.chunkId, h.score]));
  const ids = hits.map(h => h.chunkId);
  const placeholders = ids.map(() => '?').join(',');

  const rows = db.prepare(
    `SELECT id, note_path, heading_path, text, start_line, end_line FROM chunks WHERE id IN (${placeholders})`
  ).all(...ids) as any[];

  return rows
    .map(r => ({ notePath: r.note_path, chunkId: r.id, headingPath: r.heading_path, text: r.text, score: scoreMap.get(r.id) ?? 0, startLine: r.start_line, endLine: r.end_line }))
    .sort((a, b) => b.score - a.score);
}

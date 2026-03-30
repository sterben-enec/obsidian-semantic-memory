import Database from 'better-sqlite3';
import { VectorIndex } from '../embeddings/vectorIndex';
import { semanticSearch } from './semantic';
import { lookupEntity } from './entityLookup';

export interface RetrievalHit { notePath: string; chunkId: number; headingPath: string; text: string; score: number; reason: string }
export interface RetrievalResult { query: string; hits: RetrievalHit[] }

const PRIORITY = ['OpenClaw Memory/', 'Projects/', 'Infrastructure/'];

interface ProviderLike { embed(texts: string[]): Promise<number[][]> }

export async function retrieveContext(
  db: Database.Database, vectorIndex: VectorIndex, provider: ProviderLike,
  query: string, topK = 5
): Promise<RetrievalResult> {
  const semanticHits = await semanticSearch(db, vectorIndex, provider, query, topK * 2);
  const entityHit = lookupEntity(db, query.trim());

  const scored = semanticHits.map(h => {
    let score = h.score; let reason = 'semantic';
    if (PRIORITY.some(p => h.notePath.includes(p))) { score += 0.1; reason = 'semantic+priority'; }
    if (entityHit?.sourceNote === h.notePath) { score += 0.2; reason = 'semantic+entity'; }
    if (h.notePath.includes('/Daily/')) { score += 0.05; reason += '+recency'; }
    return { ...h, score, reason };
  });

  return {
    query,
    hits: scored.sort((a, b) => b.score - a.score).slice(0, topK)
      .map(h => ({ notePath: h.notePath, chunkId: h.chunkId, headingPath: h.headingPath, text: h.text, score: h.score, reason: h.reason }))
  };
}

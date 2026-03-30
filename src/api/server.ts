import express from 'express';
import Database from 'better-sqlite3';
import { retrieveContext } from '../retrieval/orchestrator';
import { lookupEntity } from '../retrieval/entityLookup';
import { appendDailyMemory } from '../memory/writer';
import { VectorIndex } from '../embeddings/vectorIndex';

interface ProviderLike { embed(texts: string[]): Promise<number[][]>; dimensions: number }

export function createServer(
  db: Database.Database,
  vectorIndex: VectorIndex,
  provider: ProviderLike,
  vaultPath: string,
  priorityPaths?: string[],
  memoryDir?: string
) {
  const app = express();
  app.use(express.json());

  app.post('/retrieve-context', async (req: any, res: any) => {
    const { query, topK: rawTopK = 5 } = req.body;
    if (!query) return void res.status(400).json({ error: 'query required' });
    const topK = Math.min(100, Math.max(1, Math.floor(Number(rawTopK) || 5)));
    try { res.json(await retrieveContext(db, vectorIndex, provider, query, topK, priorityPaths)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/entity/:name', (req: any, res: any) => {
    const entity = lookupEntity(db, req.params.name);
    if (!entity) return void res.status(404).json({ error: 'not found' });
    res.json(entity);
  });

  app.get('/facts/:entityId', (req: any, res: any) => {
    const rows = db.prepare(
      'SELECT * FROM facts WHERE subject_entity_id = ? ORDER BY updated_at DESC'
    ).all(Number(req.params.entityId));
    res.json(rows);
  });

  app.get('/search', async (req: any, res: any) => {
    const q = req.query.q as string;
    if (!q) return void res.status(400).json({ error: 'q required' });
    try { res.json(await retrieveContext(db, vectorIndex, provider, q, 5, priorityPaths)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/memory/daily', async (req: any, res: any) => {
    const { date, text, source = 'api' } = req.body;
    if (!date || !text) return void res.status(400).json({ error: 'date and text required' });
    try { await appendDailyMemory(vaultPath, date, { text, source }, memoryDir); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return app;
}

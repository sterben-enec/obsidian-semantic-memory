import Database from 'better-sqlite3';

export interface VectorSearchResult { chunkId: number; score: number }

export class VectorIndex {
  private db: Database.Database;
  private dimensions: number;

  constructor(db: Database.Database, dimensions: number) {
    this.db = db;
    this.dimensions = dimensions;
    // Load sqlite-vec extension
    const sqliteVec = require('sqlite-vec');
    sqliteVec.load(db);
  }

  initTable(): void {
    this.db.prepare(
      `CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(embedding FLOAT[${this.dimensions}])`
    ).run();
  }

  upsert(chunkId: number, embedding: number[]): void {
    const buf = Buffer.from(new Float32Array(embedding).buffer);
    this.db.prepare('DELETE FROM chunk_embeddings WHERE rowid = ?').run(BigInt(chunkId));
    this.db.prepare('INSERT INTO chunk_embeddings(rowid, embedding) VALUES(?, ?)').run(BigInt(chunkId), buf);
  }

  get(chunkId: number): number[] | null {
    const row = this.db.prepare('SELECT embedding FROM chunk_embeddings WHERE rowid = ?').get(BigInt(chunkId)) as any;
    if (!row) return null;
    return Array.from(new Float32Array(row.embedding.buffer ?? row.embedding));
  }

  search(query: number[], topK: number): VectorSearchResult[] {
    const buf = Buffer.from(new Float32Array(query).buffer);
    const rows = this.db.prepare(
      'SELECT rowid, distance FROM chunk_embeddings WHERE embedding MATCH ? AND k = ? ORDER BY distance'
    ).all(buf, topK) as any[];
    return rows.map(r => ({ chunkId: Number(r.rowid), score: 1 - r.distance }));
  }

  delete(chunkId: number): void {
    this.db.prepare('DELETE FROM chunk_embeddings WHERE rowid = ?').run(BigInt(chunkId));
  }
}

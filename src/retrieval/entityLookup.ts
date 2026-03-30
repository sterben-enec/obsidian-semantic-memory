import Database from 'better-sqlite3';

export interface EntityRow { id: number; type: string; canonicalName: string; aliases: string[]; sourceNote: string; confidence: number }

export function lookupEntity(db: Database.Database, name: string): EntityRow | null {
  const byName = db.prepare('SELECT * FROM entities WHERE canonical_name = ? COLLATE NOCASE').get(name) as any;
  if (byName) return toRow(byName);

  for (const row of db.prepare('SELECT * FROM entities').all() as any[]) {
    if ((JSON.parse(row.aliases_json ?? '[]') as string[]).some(a => a.toLowerCase() === name.toLowerCase()))
      return toRow(row);
  }
  return null;
}

function toRow(r: any): EntityRow {
  return { id: r.id, type: r.type, canonicalName: r.canonical_name, aliases: JSON.parse(r.aliases_json ?? '[]'), sourceNote: r.source_note, confidence: r.confidence };
}

import chokidar from 'chokidar';
import Database from 'better-sqlite3';
import path from 'path';
import { indexFile, IndexOptions } from '../indexer/pipeline';

export function startWatcher(
  vaultPath: string,
  db: Database.Database,
  options: IndexOptions = {}
): chokidar.FSWatcher {
  const watcher = chokidar.watch(path.join(vaultPath, '**/*.md'), {
    ignored: [/\.obsidian/, /\.semantic-memory/],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  const pending = new Map<string, NodeJS.Timeout>();

  const handle = (filePath: string) => {
    if (pending.has(filePath)) clearTimeout(pending.get(filePath)!);
    pending.set(filePath, setTimeout(async () => {
      pending.delete(filePath);
      try {
        await indexFile(db, filePath, options);
        console.log(`[watcher] indexed: ${filePath}`);
      } catch (err) {
        console.error(`[watcher] error:`, err);
      }
    }, 500));
  };

  watcher
    .on('add', handle)
    .on('change', handle)
    .on('unlink', (filePath: string) => {
      db.transaction(() => {
        db.prepare('DELETE FROM relations WHERE source_note = ?').run(filePath);
        db.prepare('DELETE FROM notes WHERE path = ?').run(filePath);
      })();
      console.log(`[watcher] removed: ${filePath}`);
    });

  return watcher;
}

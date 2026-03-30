import { Command } from 'commander';
import { loadConfig } from './config';
import { openDb } from './db/client';
import { runMigrations } from './db/schema';
import { indexVault } from './indexer/pipeline';
import { startWatcher } from './watcher/watcher';
import { retrieveContext } from './retrieval/orchestrator';
import { VectorIndex } from './embeddings/vectorIndex';
import { OpenAIEmbeddingProvider } from './embeddings/openai';
import { createServer } from './api/server';

function setup() {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  runMigrations(db);
  const provider = new OpenAIEmbeddingProvider(config.openaiApiKey ?? '');
  const vectorIndex = new VectorIndex(db, provider.dimensions);
  vectorIndex.initTable();
  return { config, db, provider, vectorIndex };
}

const program = new Command().name('osm').version('0.1.0');

program.command('index')
  .description('Index full vault')
  .action(async () => {
    const { config, db, provider, vectorIndex } = setup();
    console.log(`Indexing: ${config.vaultPath}`);
    await indexVault(db, config.vaultPath, { embeddingProvider: provider, vectorIndex });
    console.log('Done.');
    db.close();
  });

program.command('search <query>')
  .description('Semantic search')
  .option('-k, --top-k <n>', 'results', '5')
  .action(async (query: string, opts: any) => {
    const { db, provider, vectorIndex } = setup();
    const result = await retrieveContext(db, vectorIndex, provider, query, Number(opts.topK));
    result.hits.forEach(h => {
      console.log(`\n[${h.score.toFixed(3)}] ${h.notePath} (${h.reason})`);
      console.log(h.text.substring(0, 200));
    });
    db.close();
  });

program.command('watch')
  .description('Watch vault for changes')
  .action(async () => {
    const { config, db, provider, vectorIndex } = setup();
    console.log(`Watching: ${config.vaultPath}`);
    startWatcher(config.vaultPath, db, { embeddingProvider: provider, vectorIndex });
  });

program.command('serve')
  .description('Start HTTP API')
  .option('-p, --port <n>', 'port', '3456')
  .action(async (opts: any) => {
    const { config, db, provider, vectorIndex } = setup();
    const app = createServer(db, vectorIndex, provider, config.vaultPath);
    app.listen(Number(opts.port), () => console.log(`OSM API on http://localhost:${opts.port}`));
  });

program.command('rebuild')
  .description('Clear derived data and reindex from scratch')
  .action(async () => {
    const { config, db, provider, vectorIndex } = setup();
    ['facts', 'relations', 'entities', 'chunks', 'notes'].forEach(t =>
      db.prepare(`DELETE FROM ${t}`).run()
    );
    console.log('Cleared. Reindexing...');
    await indexVault(db, config.vaultPath, { embeddingProvider: provider, vectorIndex });
    console.log('Rebuild complete.');
    db.close();
  });

program.parse();

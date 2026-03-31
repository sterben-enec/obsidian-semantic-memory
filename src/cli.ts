import { Command } from 'commander';
import OpenAI from 'openai';
import { loadConfig } from './config';
import { openDb } from './db/client';
import { runMigrations } from './db/schema';
import { indexVault } from './indexer/pipeline';
import { startWatcher } from './watcher/watcher';
import { retrieveContext } from './retrieval/orchestrator';
import { VectorIndex } from './embeddings/vectorIndex';
import { OpenAIEmbeddingProvider } from './embeddings/openai';
import { LocalEmbeddingProvider } from './embeddings/local';
import { createServer } from './api/server';
import { extractFacts } from './extraction/factExtractor';
import { startMcpServer } from './mcp/server';
import type { EmbeddingProvider } from './embeddings/types';

function setup() {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  runMigrations(db);
  let provider: EmbeddingProvider;
  if (config.embeddingProvider === 'local') {
    provider = new LocalEmbeddingProvider(config.embeddingModel);
  } else {
    provider = new OpenAIEmbeddingProvider(config.openaiApiKey!);
  }
  const vectorIndex = new VectorIndex(db, provider.dimensions);
  vectorIndex.initTable();
  const factExtractor = config.llmExtraction
    ? (title: string, body: string) => extractFacts(new OpenAI({ apiKey: config.openaiApiKey! }), title, body)
    : undefined;
  return { config, db, provider, vectorIndex, factExtractor };
}

const program = new Command().name('osm').version('1.0.0');

program.command('index')
  .description('Index full vault')
  .action(async () => {
    const { config, db, provider, vectorIndex, factExtractor } = setup();
    console.log(`Indexing: ${config.vaultPath}`);
    const stats = await indexVault(db, config.vaultPath, { embeddingProvider: provider, vectorIndex, chunkOptions: { maxTokens: config.chunkMaxTokens, overlapTokens: config.chunkOverlapTokens }, factExtractor }, config.indexConcurrency);
    console.log(`Done. ${stats.indexed}/${stats.total} indexed, ${stats.errors} errors.`);
    db.close();
  });

program.command('search <query>')
  .description('Semantic search')
  .option('-k, --top-k <n>', 'results', '5')
  .action(async (query: string, opts: any) => {
    const { config, db, provider, vectorIndex } = setup();
    const result = await retrieveContext(db, vectorIndex, provider, query, Number(opts.topK), config.priorityPaths);
    result.hits.forEach(h => {
      console.log(`\n[${h.score.toFixed(3)}] ${h.notePath} (${h.reason})`);
      console.log(h.text.substring(0, 200));
    });
    db.close();
  });

program.command('watch')
  .description('Watch vault for changes')
  .action(async () => {
    const { config, db, provider, vectorIndex, factExtractor } = setup();
    console.log(`Watching: ${config.vaultPath}`);
    startWatcher(config.vaultPath, db, { embeddingProvider: provider, vectorIndex, factExtractor });
  });

program.command('serve')
  .description('Start HTTP API')
  .option('-p, --port <n>', 'port', '3456')
  .action(async (opts: any) => {
    const { config, db, provider, vectorIndex } = setup();
    const app = createServer(db, vectorIndex, provider, config.vaultPath, config.priorityPaths);
    app.listen(Number(opts.port), '127.0.0.1', () => console.log(`Listening on http://127.0.0.1:${opts.port}`));
  });

program.command('rebuild')
  .description('Clear derived data and reindex from scratch')
  .action(async () => {
    const { config, db, provider, vectorIndex, factExtractor } = setup();
    // Clear vector index — drop and recreate
    db.prepare('DROP TABLE IF EXISTS chunk_embeddings').run();
    vectorIndex.initTable(); // recreates it
    // Clear SQL derived tables atomically
    db.transaction(() => {
      ['facts', 'relations', 'entities', 'chunks', 'notes'].forEach(t =>
        db.prepare(`DELETE FROM ${t}`).run()
      );
    })();
    console.log('Cleared. Reindexing...');
    const rebuildStats = await indexVault(db, config.vaultPath, { embeddingProvider: provider, vectorIndex, chunkOptions: { maxTokens: config.chunkMaxTokens, overlapTokens: config.chunkOverlapTokens }, factExtractor }, config.indexConcurrency);
    console.log(`Rebuild complete. ${rebuildStats.indexed}/${rebuildStats.total} indexed, ${rebuildStats.errors} errors.`);
    db.close();
  });

program.command('mcp')
  .description('Start MCP server (stdio transport) for agent connectivity')
  .action(async () => {
    const { config, db, provider, vectorIndex } = setup();
    await startMcpServer(db, vectorIndex, provider, config);
  });

program.parse();

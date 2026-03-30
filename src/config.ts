export interface Config {
  vaultPath: string;
  dbPath: string;
  embeddingProvider: 'openai' | 'local';
  openaiApiKey?: string;
  chunkMaxTokens: number;
  chunkOverlapTokens: number;
  priorityPaths: string[];
}

export function loadConfig(): Config {
  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) throw new Error('VAULT_PATH environment variable is required');

  return {
    vaultPath,
    dbPath: process.env.DB_PATH ?? `${vaultPath}/.semantic-memory/index.db`,
    embeddingProvider: (process.env.EMBEDDING_PROVIDER as 'openai' | 'local') ?? 'openai',
    openaiApiKey: process.env.OPENAI_API_KEY,
    chunkMaxTokens: Number(process.env.CHUNK_MAX_TOKENS ?? 400),
    chunkOverlapTokens: Number(process.env.CHUNK_OVERLAP_TOKENS ?? 50),
    priorityPaths: (process.env.PRIORITY_PATHS ?? 'OpenClaw Memory/,Projects/,Infrastructure/').split(','),
  };
}

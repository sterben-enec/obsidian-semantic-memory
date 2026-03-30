import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env.VAULT_PATH;
    delete process.env.DB_PATH;
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.CHUNK_MAX_TOKENS;
    delete process.env.CHUNK_OVERLAP_TOKENS;
  });

  it('loads VAULT_PATH from env', () => {
    process.env.VAULT_PATH = '/tmp/vault';
    process.env.DB_PATH = '/tmp/test.db';
    expect(loadConfig().vaultPath).toBe('/tmp/vault');
  });

  it('throws when VAULT_PATH missing', () => {
    expect(() => loadConfig()).toThrow('VAULT_PATH');
  });

  it('has sensible defaults', () => {
    process.env.VAULT_PATH = '/tmp/vault';
    process.env.DB_PATH = '/tmp/test.db';
    const c = loadConfig();
    expect(c.embeddingProvider).toBe('openai');
    expect(c.chunkMaxTokens).toBe(400);
    expect(c.chunkOverlapTokens).toBe(50);
  });
});

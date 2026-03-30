import { describe, it, expect, vi } from 'vitest';
import { OpenAIEmbeddingProvider } from '../../src/embeddings/openai';

describe('OpenAIEmbeddingProvider', () => {
  it('calls API with correct model and returns embeddings', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ data: [{ embedding: new Array(1536).fill(0.1) }] });
    const p = new OpenAIEmbeddingProvider('test-key');
    (p as any).client.embeddings.create = mockCreate;
    const result = await p.embed(['hello']);
    expect(result[0]).toHaveLength(1536);
    expect(mockCreate).toHaveBeenCalledWith({ model: 'text-embedding-3-small', input: ['hello'] });
  });

  it('batches in groups of 100', async () => {
    const mockCreate = vi.fn().mockImplementation(({ input }: any) =>
      Promise.resolve({ data: input.map(() => ({ embedding: new Array(1536).fill(0) })) })
    );
    const p = new OpenAIEmbeddingProvider('test-key');
    (p as any).client.embeddings.create = mockCreate;
    await p.embed(new Array(250).fill('text'));
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
});

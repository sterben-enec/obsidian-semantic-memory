import OpenAI from 'openai';
import { EmbeddingProvider } from './types';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  dimensions = 1536;
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += 100) {
      const batch = texts.slice(i, i + 100);
      const res = await this.client.embeddings.create({ model: 'text-embedding-3-small', input: batch });
      results.push(...res.data.map(d => d.embedding));
    }
    return results;
  }
}

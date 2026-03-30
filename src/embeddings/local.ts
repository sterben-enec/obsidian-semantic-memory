import { pipeline, env } from '@xenova/transformers';
import type { EmbeddingProvider } from './types';
import path from 'path';
import os from 'os';

export class LocalEmbeddingProvider implements EmbeddingProvider {
  dimensions = 384;
  private modelName: string;
  private extractor: any = null;

  constructor(modelName?: string) {
    this.modelName = modelName ?? 'Xenova/all-MiniLM-L6-v2';
    env.cacheDir = path.join(os.homedir(), '.cache', 'osm-memory', 'models');
  }

  private async getExtractor() {
    if (!this.extractor) {
      this.extractor = await pipeline('feature-extraction', this.modelName);
    }
    return this.extractor;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.getExtractor();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    return output.tolist() as number[][];
  }
}

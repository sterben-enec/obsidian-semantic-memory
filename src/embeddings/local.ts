import type { EmbeddingProvider } from './types';
import path from 'path';
import os from 'os';

export class LocalEmbeddingProvider implements EmbeddingProvider {
  dimensions = 384;
  private modelName: string;
  private extractor: any = null;
  private initPromise: Promise<any> | null = null;

  constructor(modelName?: string) {
    this.modelName = modelName ?? 'Xenova/all-MiniLM-L6-v2';
  }

  private getExtractor(): Promise<any> {
    if (this.extractor) return Promise.resolve(this.extractor);
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers' as any);
      env.cacheDir = path.join(os.homedir(), '.cache', 'osm-memory', 'models');
      this.extractor = await pipeline('feature-extraction', this.modelName);
      return this.extractor;
    })();
    return this.initPromise;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.getExtractor();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    return output.tolist() as number[][];
  }
}

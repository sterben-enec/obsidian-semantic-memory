export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  embedQuery?(text: string): Promise<number[]>;
  dimensions: number;
}

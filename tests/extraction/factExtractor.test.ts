import { describe, it, expect, vi } from 'vitest';
import { extractFacts } from '../../src/extraction/factExtractor';

describe('extractFacts', () => {
  it('extracts facts from LLM response', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: JSON.stringify({
                  facts: [
                    { subject: 'John', predicate: 'works_at', object: 'Acme Corp', confidence: 0.95 },
                    { subject: 'John', predicate: 'knows', object: 'TypeScript', confidence: 0.9 }
                  ]
                })
              }
            }]
          })
        }
      }
    };

    const facts = await extractFacts(mockClient as any, 'John Doe', 'John works at Acme Corp. He knows TypeScript.');
    expect(facts).toHaveLength(2);
    expect(facts[0].predicate).toBe('works_at');
    expect(facts[0].confidence).toBe(0.95);
  });

  it('returns empty array on invalid JSON', async () => {
    const mockClient = {
      chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'not json' } }] }) } }
    };
    const facts = await extractFacts(mockClient as any, 'Test', 'content');
    expect(facts).toHaveLength(0);
  });

  it('filters out facts with missing fields', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: JSON.stringify({
                  facts: [
                    { subject: 'John', predicate: 'works_at', object: 'Acme', confidence: 0.9 },
                    { subject: 'John', predicate: null, object: 'Acme', confidence: 0.9 },
                    { subject: '', predicate: 'works_at', object: 'Acme', confidence: 0.9 }
                  ]
                })
              }
            }]
          })
        }
      }
    };
    const facts = await extractFacts(mockClient as any, 'Test', 'content');
    expect(facts).toHaveLength(1);
  });

  it('uses gpt-4o-mini model', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"facts":[]}' } }] });
    const mockClient = { chat: { completions: { create: mockCreate } } };
    await extractFacts(mockClient as any, 'Test', 'content');
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o-mini' }));
  });
});

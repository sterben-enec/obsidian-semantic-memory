import { describe, it, expect } from 'vitest';
import { parseNote } from '../../src/indexer/parser';

describe('parseNote', () => {
  it('extracts frontmatter and title', () => {
    const r = parseNote(
      '/v/People/John.md',
      `---\nkind: person\naliases:\n  - John\n  - JD\n---\n# John Doe\n\nEngineer.`
    );
    expect(r.frontmatter.kind).toBe('person');
    expect(r.frontmatter.aliases).toEqual(['John', 'JD']);
    expect(r.title).toBe('John Doe');
  });

  it('works with plain markdown', () => {
    const r = parseNote('/v/scratch.md', '# Hello\n\nText.');
    expect(r.frontmatter).toEqual({});
    expect(r.title).toBe('Hello');
  });

  it('falls back to filename when no h1', () => {
    const r = parseNote('/v/my-note.md', 'Just text.');
    expect(r.title).toBe('my-note');
  });

  it('extracts wikilinks including aliased and heading variants', () => {
    const r = parseNote('/v/test.md', '# T\n\nSee [[People/John|JD]] and [[Projects/Alpha#Beta]].');
    expect(r.wikilinks).toContain('People/John');
    expect(r.wikilinks).toContain('Projects/Alpha');
  });
});

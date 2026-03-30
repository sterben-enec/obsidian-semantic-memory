import { ParsedNote } from './parser';

export interface Chunk {
  notePath: string;
  headingPath: string;
  text: string;
  startLine: number;
  endLine: number;
  tokenCount: number;
}

interface ChunkOptions {
  maxTokens?: number;
}

const tokens = (s: string) => Math.ceil(s.length / 4);

export function chunkNote(note: ParsedNote, options: ChunkOptions = {}): Chunk[] {
  const max = options.maxTokens ?? 400;
  const lines = note.body.split('\n');
  const sections = splitByHeadings(lines);
  const chunks: Chunk[] = [];

  for (const sec of sections) {
    const text = sec.lines.join('\n').trim();
    if (!text) continue;
    if (tokens(text) <= max) {
      chunks.push({
        notePath: note.path,
        headingPath: sec.headingPath,
        text,
        startLine: sec.startLine,
        endLine: sec.endLine,
        tokenCount: tokens(text),
      });
    } else {
      chunks.push(...splitByParagraphs(text, sec.headingPath, note.path, sec.startLine, max));
    }
  }

  return chunks.length > 0
    ? chunks
    : [
        {
          notePath: note.path,
          headingPath: '',
          text: note.body.trim(),
          startLine: 0,
          endLine: lines.length,
          tokenCount: tokens(note.body),
        },
      ];
}

interface Section {
  headingPath: string;
  lines: string[];
  startLine: number;
  endLine: number;
}

function splitByHeadings(lines: string[]): Section[] {
  const sections: Section[] = [];
  let stack: string[] = [];
  let buf: string[] = [];
  let start = 0;

  for (let i = 0; i < lines.length; i++) {
    const h1 = lines[i].match(/^#\s+(.+)$/);
    const h2 = lines[i].match(/^##\s+(.+)$/);
    if (h1 || h2) {
      if (buf.length) sections.push({ headingPath: stack.join(' > '), lines: buf, startLine: start, endLine: i });
      if (h1) stack = [h1[1].trim()];
      else stack = [stack[0] ?? '', h2![1].trim()].filter(Boolean);
      buf = [lines[i]];
      start = i;
    } else {
      buf.push(lines[i]);
    }
  }
  if (buf.length) sections.push({ headingPath: stack.join(' > '), lines: buf, startLine: start, endLine: lines.length });
  return sections;
}

function splitByParagraphs(text: string, headingPath: string, notePath: string, base: number, max: number): Chunk[] {
  const paras = text.split(/\n\n+/);
  const chunks: Chunk[] = [];
  let buf: string[] = [];
  let bt = 0;
  let offset = base;

  for (const p of paras) {
    const pt = tokens(p);
    if (bt + pt > max && buf.length > 0) {
      const ct = buf.join('\n\n');
      const lc = ct.split('\n').length;
      chunks.push({ notePath, headingPath, text: ct, startLine: offset, endLine: offset + lc, tokenCount: tokens(ct) });
      offset += lc;
      buf = [];
      bt = 0;
    }
    buf.push(p);
    bt += pt;
  }
  if (buf.length) {
    const ct = buf.join('\n\n');
    chunks.push({ notePath, headingPath, text: ct, startLine: offset, endLine: offset + ct.split('\n').length, tokenCount: tokens(ct) });
  }
  return chunks;
}

import matter from 'gray-matter';
import path from 'path';

export interface ParsedNote {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  wikilinks: string[];
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?]]/g;

export function parseNote(filePath: string, content: string): ParsedNote {
  const { data: frontmatter, content: rawBody } = matter(content);
  const title = rawBody.match(/^#\s+(.+)$/m)?.[1].trim() ?? path.basename(filePath, '.md');
  const wikilinks = [...new Set([...rawBody.matchAll(new RegExp(WIKILINK_RE.source, 'g'))].map(m => m[1].trim()))].filter(Boolean);

  return {
    path: filePath,
    title,
    frontmatter,
    body: rawBody.trim(),
    wikilinks,
  };
}

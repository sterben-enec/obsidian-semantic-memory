import fs from 'fs/promises';
import path from 'path';

export interface DailyEntry { text: string; source: string }

export async function appendDailyMemory(vaultPath: string, date: string, entry: DailyEntry, memoryDir = 'Memory/Daily'): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('date must be YYYY-MM-DD format');
  }

  const dir = path.join(vaultPath, memoryDir);
  const filePath = path.join(dir, `${date}.md`);

  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(dir);
  if (!resolvedPath.startsWith(resolvedBase)) {
    throw new Error('Invalid date: path traversal detected');
  }

  await fs.mkdir(dir, { recursive: true });

  // Sanitize text: trim, remove frontmatter delimiters, limit length
  let sanitizedText = entry.text.trim();
  sanitizedText = sanitizedText.replace(/---/g, '');
  if (sanitizedText.length > 2000) {
    sanitizedText = sanitizedText.substring(0, 2000);
  }

  // Sanitize source: alphanumeric and hyphens only
  const sanitizedSource = entry.source.replace(/[^\p{L}\p{N}-]/gu, '');

  const time = new Date().toISOString().substring(11, 19);
  const line = `\n- [${time}] (${sanitizedSource}) ${sanitizedText}`;

  try {
    await fs.stat(filePath);
    // File exists — just append
    await fs.appendFile(filePath, line, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // File doesn't exist — create with frontmatter
      await fs.writeFile(filePath, `---\nkind: note\nupdated: ${date}\n---\n# ${date}\n` + line, 'utf8');
    } else {
      throw err;
    }
  }
  return filePath;
}

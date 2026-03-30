import fs from 'fs/promises';
import path from 'path';

export interface DailyEntry { text: string; source: string }

export async function appendDailyMemory(vaultPath: string, date: string, entry: DailyEntry): Promise<void> {
  const dir = path.join(vaultPath, 'OpenClaw Memory', 'Daily');
  const filePath = path.join(dir, `${date}.md`);
  await fs.mkdir(dir, { recursive: true });

  const time = new Date().toISOString().substring(11, 19);
  const line = `\n- [${time}] (${entry.source}) ${entry.text}`;

  try {
    await fs.access(filePath);
    await fs.appendFile(filePath, line, 'utf8');
  } catch {
    await fs.writeFile(filePath, `---\nkind: note\nupdated: ${date}\n---\n# ${date}\n` + line, 'utf8');
  }
}

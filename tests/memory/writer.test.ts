import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appendDailyMemory } from '../../src/memory/writer';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('appendDailyMemory', () => {
  it('creates daily note when missing', async () => {
    await appendDailyMemory(tmp, '2026-03-30', { text: 'Agent started.', source: 'agent' }, 'OpenClaw Memory/Daily');
    const p = path.join(tmp, 'OpenClaw Memory', 'Daily', '2026-03-30.md');
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p,'utf8')).toContain('Agent started.');
  });

  it('appends to existing note', async () => {
    const date = '2026-03-30';
    await appendDailyMemory(tmp, date, { text: 'First.', source: 'agent' }, 'OpenClaw Memory/Daily');
    await appendDailyMemory(tmp, date, { text: 'Second.', source: 'agent' }, 'OpenClaw Memory/Daily');
    const content = fs.readFileSync(path.join(tmp,'OpenClaw Memory','Daily',`${date}.md`),'utf8');
    expect(content).toContain('First.');
    expect(content).toContain('Second.');
  });

  it('created note has frontmatter with kind: note', async () => {
    await appendDailyMemory(tmp, '2026-03-30', { text: 'Test.', source: 'test' }, 'OpenClaw Memory/Daily');
    const content = fs.readFileSync(path.join(tmp,'OpenClaw Memory','Daily','2026-03-30.md'),'utf8');
    expect(content).toContain('kind: note');
    expect(content).toContain('# 2026-03-30');
  });
});

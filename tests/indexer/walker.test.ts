import { describe, it, expect } from 'vitest';
import { walkVault } from '../../src/indexer/walker';
import path from 'path';
import fs from 'fs';
import os from 'os';

const FIXTURE = path.resolve('fixtures/vault');

describe('walkVault', () => {
  it('finds all markdown files', async () => {
    const files = await walkVault(FIXTURE);
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files.every(f => f.endsWith('.md'))).toBe(true);
  });

  it('excludes .obsidian by default', async () => {
    const files = await walkVault(FIXTURE);
    expect(files.some(f => f.includes('.obsidian'))).toBe(false);
  });

  it('respects ignorePatterns option', async () => {
    const files = await walkVault(FIXTURE, { ignorePatterns: ['Daily/'] });
    expect(files.some(f => f.includes('Daily'))).toBe(false);
  });

  it('reads .semanticignore from vault root', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
    fs.mkdirSync(path.join(tmp, 'Private'));
    fs.writeFileSync(path.join(tmp, 'Private', 'secret.md'), '# Secret');
    fs.writeFileSync(path.join(tmp, '.semanticignore'), 'Private/\n');
    const files = await walkVault(tmp);
    expect(files.some(f => f.includes('Private'))).toBe(false);
    fs.rmSync(tmp, { recursive: true });
  });

  it('returns absolute paths', async () => {
    const files = await walkVault(FIXTURE);
    expect(files.every(f => path.isAbsolute(f))).toBe(true);
  });
});

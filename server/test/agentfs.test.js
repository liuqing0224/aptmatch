import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendLearnings, ensureAgentDirs, readSkill, writeSkill } from '../lib/agentfs.js';

describe('agentfs', () => {
  it('appendLearnings 自动加日期且不重复前缀', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jfm-agent-'));
    const slug = 'x';
    ensureAgentDirs(slug);
    const orig = process.env.AGENTS_DIR;
    process.env.AGENTS_DIR = dir;
    try {
      appendLearnings(slug, ['规律一', '- [2026-08-07] 规律二']);
      const content = readSkill(slug, 'learnings.md');
      expect(content).toContain('- [');
      expect(content).not.toContain('] [');
      expect(content).toContain('规律一');
      expect(content).toContain('规律二');
    } finally {
      if (orig === undefined) delete process.env.AGENTS_DIR;
      else process.env.AGENTS_DIR = orig;
    }
  });

  it('writeSkill 拒绝非法文件名', () => {
    expect(() => writeSkill('x', '../evil.md', 'x')).toThrow(/只允许/);
  });
});

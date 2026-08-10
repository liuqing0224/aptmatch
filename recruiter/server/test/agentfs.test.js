import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// agentfs 在模块加载时捕获 AGENTS_DIR，必须在 import 前设置临时目录，
// 避免测试写入仓库真实 agents/ 目录
let agentfs;
let tmpDir;
beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jfm-agent-'));
  const orig = process.env.AGENTS_DIR;
  process.env.AGENTS_DIR = tmpDir;
  vi.resetModules();
  agentfs = await import('../lib/agentfs.js');
  if (orig === undefined) delete process.env.AGENTS_DIR;
  else process.env.AGENTS_DIR = orig;
});

describe('agentfs', () => {
  it('appendLearnings 自动加日期且不重复前缀', () => {
    agentfs.ensureAgentDirs('x');
    agentfs.appendLearnings('x', ['规律一', '- [2026-08-07] 规律二']);
    const content = agentfs.readSkill('x', 'learnings.md');
    expect(content).toContain('- [');
    expect(content).not.toContain('] [');
    expect(content).toContain('规律一');
    expect(content).toContain('规律二');
  });

  it('writeSkill 拒绝非法文件名', () => {
    expect(() => agentfs.writeSkill('x', '../evil.md', 'x')).toThrow(/只允许/);
  });
});

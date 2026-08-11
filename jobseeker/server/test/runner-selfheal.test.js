import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 隔离 DATA_DIR，避免触碰真实数据（需在动态 import 前设置）
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aptmatch-selfheal-'));

const h = vi.hoisted(() => ({
  spawnMock: null,
  validReport: null,
}));

vi.mock('node:child_process', () => ({
  spawn: (cmd, args, opts) => h.spawnMock(cmd, args, opts),
  spawnSync: () => ({ status: 1, stdout: '', stderr: '' }),
}));

function buildDimensions() {
  const spec = [
    ['hard_skills', 20],
    ['experience', 14],
    ['responsibilities', 13],
    ['gate', 14],
    ['tech_direction', 12],
    ['compensation', 8],
    ['culture', 8],
    ['stability', 6],
    ['company_health', 3],
    ['preference', 2],
  ];
  return spec.map(([key, weight]) => ({ key, label: key, score: 70, weight, reason: '测试' }));
}

async function makeRunner(spawnImpl) {
  const { openDb } = await import('../db.js');
  const { TaskRunner } = await import('../lib/runner.js');
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO tasks (id, title, mode, status, created_at) VALUES ('t1', '契合度：测试', 'fit', 'running', ?)`).run(
    new Date().toISOString()
  );
  let calls = 0;
  h.spawnMock = vi.fn((cmd, args, opts) => {
    calls += 1;
    const outFile = path.join(opts.cwd, 'output', 'report.json');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    spawnImpl(calls, outFile);
    const child = new EventEmitter();
    child.pid = 9000 + calls;
    child.exitCode = null;
    child.kill = vi.fn();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    return child;
  });
  const runner = new TaskRunner({
    db,
    getSettings: () => ({ defaultProvider: 'opencode', timeoutMinutes: 1 }),
    hub: null,
  });
  const ws = path.join(process.env.DATA_DIR, 'jobs', 't1');
  fs.rmSync(ws, { recursive: true, force: true });
  fs.mkdirSync(path.join(ws, 'input'), { recursive: true });
  fs.mkdirSync(path.join(process.env.DATA_DIR, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'prompt.txt'), '任务：分析契合度。', 'utf8');
  const task = db.prepare(`SELECT * FROM tasks WHERE id = 't1'`).get();
  return { db, runner, ws, task, count: () => calls };
}

describe('TaskRunner 校验失败自愈', () => {
  it('首次输出不合法时注入校验错误并重跑，第二次合法则判 done', async () => {
    const h1 = await makeRunner((calls, outFile) => {
      const body =
        calls === 1
          ? JSON.stringify({ schema_version: 1, summary: '' })
          : JSON.stringify({
              schema_version: 1,
              summary: 'ok',
              overall_score: 70,
              grade: 'A',
              dimensions: buildDimensions(),
              matched: [],
              gaps: [],
              strengths: [],
              risks: [],
              questions: [],
              suggestions: [],
              research: [],
              learnings: [],
            });
      fs.writeFileSync(outFile, body, 'utf8');
    });
    await h1.runner.runProvider(h1.task, h1.ws, { defaultProvider: 'opencode', timeoutMinutes: 1 });
    const row = h1.db.prepare(`SELECT * FROM tasks WHERE id = 't1'`).get();
    expect(row.status).toBe('done');
    expect(h1.count()).toBe(2); // 初始 1 次 + 自愈重跑 1 次
    expect(fs.existsSync(path.join(h1.ws, 'input', 'validation_errors.txt'))).toBe(true);
    expect(JSON.parse(row.result).overall_score).toBe(70);
  });

  it('自愈重跑仍不合法时判 failed，错误带 schema 校验信息', async () => {
    const h2 = await makeRunner((_calls, outFile) => {
      fs.writeFileSync(outFile, JSON.stringify({ schema_version: 1, summary: '' }), 'utf8');
    });
    await h2.runner.runProvider(h2.task, h2.ws, { defaultProvider: 'opencode', timeoutMinutes: 1 });
    const row = h2.db.prepare(`SELECT * FROM tasks WHERE id = 't1'`).get();
    expect(row.status).toBe('failed');
    expect(h2.count()).toBe(2);
    expect(row.error).toContain('报告 schema 校验失败');
  });

  it('首次输出即合法时只运行一次，不产生自愈文件', async () => {
    const h3 = await makeRunner((_calls, outFile) => {
      fs.writeFileSync(
        outFile,
        JSON.stringify({
          schema_version: 1,
          summary: 'ok',
          overall_score: 70,
          grade: 'A',
          dimensions: buildDimensions(),
          matched: [],
          gaps: [],
          strengths: [],
          risks: [],
          questions: [],
          suggestions: [],
          research: [],
          learnings: [],
        }),
        'utf8'
      );
    });
    await h3.runner.runProvider(h3.task, h3.ws, { defaultProvider: 'opencode', timeoutMinutes: 1 });
    const row = h3.db.prepare(`SELECT * FROM tasks WHERE id = 't1'`).get();
    expect(row.status).toBe('done');
    expect(h3.count()).toBe(1);
    expect(fs.existsSync(path.join(h3.ws, 'input', 'validation_errors.txt'))).toBe(false);
  });
});

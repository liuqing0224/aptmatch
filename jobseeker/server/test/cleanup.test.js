import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// paths 模块在 import 时读取 DATA_DIR，静态 import 会被提升导致读到旧值，
// 因此先设置临时目录，再动态 import db 与 cleanup
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jfm-cleanup-'));
process.env.DATA_DIR = DATA_DIR;

const { openDb } = await import('../db.js');
const { cleanupOldJobs } = await import('../lib/cleanup.js');

function mkdirForce(p) {
  fs.mkdirSync(p, { recursive: true });
}

function makeArtifacts(id) {
  mkdirForce(path.join(DATA_DIR, 'jobs', id));
  mkdirForce(path.join(DATA_DIR, 'logs'));
  fs.writeFileSync(path.join(DATA_DIR, 'logs', `${id}.log`), 'log');
}

function iso(daysAgo) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function insertTask(db, id, status, finishedDaysAgo) {
  db.prepare(
    `INSERT INTO tasks (id, title, mode, status, created_at, finished_at)
     VALUES (?, ?, 'fit', ?, ?, ?)`
  ).run(id, `任务 ${id}`, status, iso(400), finishedDaysAgo == null ? null : iso(finishedDaysAgo));
}

describe('cleanupOldJobs', () => {
  const db = openDb(path.join(DATA_DIR, 'test.db'));

  it('只删除超龄终态任务的工作区与日志，跳过失败超龄、近期与活跃任务', () => {
    // 超龄 done（finished 40 天前，> keepDoneDays=30）：应删除
    insertTask(db, 'old-done', 'done', 40);
    // 超龄 failed（finished 40 天前，但 < keepFailedDays=90）：应保留
    insertTask(db, 'old-failed', 'failed', 40);
    // 近期 done（finished 5 天前）：应保留
    insertTask(db, 'recent-done', 'done', 5);
    // running 活跃任务：应保留
    insertTask(db, 'active', 'running', null);

    for (const id of ['old-done', 'old-failed', 'recent-done', 'active']) {
      makeArtifacts(id);
    }
    // 额外孤立目录/日志（数据库中无对应任务）：不得被删除
    mkdirForce(path.join(DATA_DIR, 'jobs', 'orphan'));
    fs.writeFileSync(path.join(DATA_DIR, 'logs', 'orphan.log'), 'log');

    const stats = cleanupOldJobs(db, { now: new Date() });

    expect(stats).toEqual({ cleaned: 1, workspaces: 1, logs: 1 });
    expect(fs.existsSync(path.join(DATA_DIR, 'jobs', 'old-done'))).toBe(false);
    expect(fs.existsSync(path.join(DATA_DIR, 'logs', 'old-done.log'))).toBe(false);

    for (const id of ['old-failed', 'recent-done', 'active', 'orphan']) {
      expect(fs.existsSync(path.join(DATA_DIR, 'jobs', id))).toBe(true);
      expect(fs.existsSync(path.join(DATA_DIR, 'logs', `${id}.log`))).toBe(true);
    }
  });

  it('finished_at 缺失时回退 created_at 计算年龄', () => {
    const db2 = openDb(':memory:');
    // created 400 天前且无 finished_at：超龄，应纳入清理
    db2.prepare(
      `INSERT INTO tasks (id, title, mode, status, created_at) VALUES (?, 'x', 'fit', 'done', ?)`
    ).run('no-finish', iso(400));
    makeArtifacts('no-finish');

    const stats = cleanupOldJobs(db2, { now: new Date() });
    expect(stats.cleaned).toBe(1);
    expect(fs.existsSync(path.join(DATA_DIR, 'jobs', 'no-finish'))).toBe(false);
    expect(fs.existsSync(path.join(DATA_DIR, 'logs', 'no-finish.log'))).toBe(false);
  });

  it('任务缺失（无 tasks 表）或 DB 报错时安全返回 0 统计', () => {
    const db3 = openDb(':memory:');
    db3.exec(`DROP TABLE tasks`);
    expect(cleanupOldJobs(db3)).toEqual({ cleaned: 0, workspaces: 0, logs: 0 });
  });

  afterAll(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  });
});

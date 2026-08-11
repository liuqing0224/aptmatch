import { describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { createQueue, recoverRunningTasks } from '../lib/queue.js';

function insertTask(db, id, status = 'queued') {
  db.prepare(
    `INSERT INTO tasks (id, title, mode, status, created_at) VALUES (?, ?, 'fit', ?, ?)`
  ).run(id, `任务 ${id}`, status, new Date().toISOString());
}

function statusOf(db, id) {
  return db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(id)?.status;
}

async function waitFor(fn, timeout = 3000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('waitFor 超时');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('queue', () => {
  it('任务按 queued → running → done 流转', async () => {
    const db = openDb(':memory:');
    const runner = {
      async run(task) {
        expect(statusOf(db, task.id)).toBe('running');
        db.prepare(`UPDATE tasks SET status = 'done', result = '{}' WHERE id = ?`).run(task.id);
      },
    };
    const q = createQueue({ db, runner, getSettings: () => ({ concurrency: 1 }), tickIntervalMs: 20 });
    insertTask(db, 't1');
    q.start();
    await waitFor(() => statusOf(db, 't1') === 'done');
    q.stop();
  });

  it('并发限制为 1 时串行执行', async () => {
    const db = openDb(':memory:');
    let active = 0;
    let maxActive = 0;
    const runner = {
      async run(task) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 30));
        active -= 1;
        db.prepare(`UPDATE tasks SET status = 'done' WHERE id = ?`).run(task.id);
      },
    };
    const q = createQueue({ db, runner, getSettings: () => ({ concurrency: 1 }), tickIntervalMs: 20 });
    insertTask(db, 'a');
    insertTask(db, 'b');
    insertTask(db, 'c');
    q.start();
    await waitFor(() => ['a', 'b', 'c'].every((id) => statusOf(db, id) === 'done'), 5000);
    q.stop();
    expect(maxActive).toBe(1);
  });

  it('并发限制为 2 时批量出队并行执行', async () => {
    const db = openDb(':memory:');
    let active = 0;
    let maxActive = 0;
    const runner = {
      async run(task) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 30));
        active -= 1;
        db.prepare(`UPDATE tasks SET status = 'done' WHERE id = ?`).run(task.id);
      },
    };
    const q = createQueue({ db, runner, getSettings: () => ({ concurrency: 2 }), tickIntervalMs: 20 });
    insertTask(db, 'a');
    insertTask(db, 'b');
    insertTask(db, 'c');
    q.start();
    await waitFor(() => ['a', 'b', 'c'].every((id) => statusOf(db, id) === 'done'), 5000);
    q.stop();
    expect(maxActive).toBe(2);
  });

  it('可重试的失败自动回队重试，直到达到次数上限', async () => {
    const db = openDb(':memory:');
    let runs = 0;
    const runner = {
      async run(task) {
        runs += 1;
        db.prepare(
          `UPDATE tasks SET status = 'failed', error = '任务超时（超过 10 分钟）', finished_at = ? WHERE id = ?`
        ).run(new Date().toISOString(), task.id);
      },
    };
    const q = createQueue({
      db,
      runner,
      getSettings: () => ({ concurrency: 1, maxRetries: 2 }),
      tickIntervalMs: 20,
    });
    insertTask(db, 't1');
    q.start();
    await waitFor(() => {
      const row = db.prepare(`SELECT status, attempts FROM tasks WHERE id = 't1'`).get();
      return row.status === 'failed' && row.attempts === 2;
    }, 5000);
    await new Promise((r) => setTimeout(r, 100));
    q.stop();
    const row = db.prepare(`SELECT * FROM tasks WHERE id = 't1'`).get();
    expect(row.attempts).toBe(2);
    expect(runs).toBe(3); // 初始 1 次 + 自动重试 2 次
  });

  it('非重试类失败（如 schema 校验失败）不自动重试', async () => {
    const db = openDb(':memory:');
    const runner = {
      async run(task) {
        db.prepare(
          `UPDATE tasks SET status = 'failed', error = '报告 schema 校验失败：summary 缺失', finished_at = ? WHERE id = ?`
        ).run(new Date().toISOString(), task.id);
      },
    };
    const q = createQueue({
      db,
      runner,
      getSettings: () => ({ concurrency: 1, maxRetries: 2 }),
      tickIntervalMs: 20,
    });
    insertTask(db, 't1');
    q.start();
    await waitFor(() => statusOf(db, 't1') === 'failed', 3000);
    await new Promise((r) => setTimeout(r, 100));
    q.stop();
    const row = db.prepare(`SELECT attempts FROM tasks WHERE id = 't1'`).get();
    expect(row.attempts).toBe(0);
  });

  it('runner 抛错时任务标记为 failed', async () => {
    const db = openDb(':memory:');
    const runner = {
      async run() {
        throw new Error('boom');
      },
    };
    const q = createQueue({ db, runner, getSettings: () => ({ concurrency: 1 }), tickIntervalMs: 20 });
    insertTask(db, 't1');
    q.start();
    await waitFor(() => statusOf(db, 't1') === 'failed');
    q.stop();
    expect(db.prepare(`SELECT error FROM tasks WHERE id = 't1'`).get().error).toContain('boom');
  });

  it('重启恢复：running 任务回到 queued', () => {
    const db = openDb(':memory:');
    insertTask(db, 't1', 'running');
    const changes = recoverRunningTasks(db);
    expect(changes).toBe(1);
    expect(statusOf(db, 't1')).toBe('queued');
  });
});

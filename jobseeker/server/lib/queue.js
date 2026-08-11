import { emitTaskChanged } from './serialize.js';
import { rowById } from '../db.js';

// 可自动重试的失败类型：超时 / agent 进程退出未产出报告 / 调度错误 / 报告 JSON 非法
const RETRYABLE_ERROR_RE = /超时|进程退出|调度错误|不是合法 JSON/;

export function createQueue({ db, runner, getSettings, tickIntervalMs = 1000, hub = null }) {
  let timer = null;

  function runningCount() {
    return db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status = 'running'`).get().n;
  }

  function nextQueued() {
    return (
      db
        .prepare(
          `SELECT * FROM tasks WHERE status = 'queued'
           ORDER BY (mode = 'collect') DESC, created_at ASC LIMIT 1`
        )
        .get() ?? null
    );
  }

  // 失败任务若属于可重试类型且未超过次数上限，则回队并计数
  function requeueIfRetryable(task) {
    const cur = rowById(db, 'tasks', task.id);
    if (!cur || cur.status !== 'failed') return false;
    const maxRetries = Math.max(0, Number(getSettings().maxRetries ?? 2));
    if (cur.attempts >= maxRetries) return false;
    if (!RETRYABLE_ERROR_RE.test(String(cur.error ?? ''))) return false;
    db.prepare(
      `UPDATE tasks SET status = 'queued', attempts = attempts + 1, error = ?, started_at = NULL, finished_at = NULL, pid = NULL WHERE id = ?`
    ).run(`第 ${cur.attempts + 1} 次自动重试（上限 ${maxRetries} 次）：${cur.error || '任务失败'}`, task.id);
    emitTaskChanged(hub, db, rowById(db, 'tasks', task.id));
    return true;
  }

  function launch(task) {
    const now = new Date().toISOString();
    db.prepare(`UPDATE tasks SET status = 'running', started_at = ? WHERE id = ?`).run(now, task.id);
    emitTaskChanged(hub, db, { ...task, status: 'running', started_at: now });
    runner
      .run(task)
      .then(() => {
        requeueIfRetryable(task);
      })
      .catch((err) => {
        db.prepare(
          `UPDATE tasks SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`
        ).run(`调度错误：${err.message}`, new Date().toISOString(), task.id);
        emitTaskChanged(hub, db, rowById(db, 'tasks', task.id));
        requeueIfRetryable(task);
      })
      .finally(() => {
        tick();
      });
  }

  // 一次调度尽量填满并发额度（批量出队），保持 collect 优先
  function tick() {
    const concurrency = Math.max(1, getSettings().concurrency || 1);
    while (runningCount() < concurrency) {
      const task = nextQueued();
      if (!task) break;
      launch(task);
    }
  }

  return {
    start() {
      timer = setInterval(tick, tickIntervalMs);
      tick();
      return this;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    enqueue() {
      tick();
    },
  };
}

export function recoverRunningTasks(db) {
  return db
    .prepare(
      `UPDATE tasks SET status = 'queued', error = '服务重启，任务已重新入队' WHERE status = 'running'`
    )
    .run().changes;
}

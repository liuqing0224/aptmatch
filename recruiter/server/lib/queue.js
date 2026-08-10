export function createQueue({ db, runner, getSettings, tickIntervalMs = 1000 }) {
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

  async function tick() {
    const concurrency = Math.max(1, getSettings().concurrency || 1);
    if (runningCount() >= concurrency) return;
    const task = nextQueued();
    if (!task) return;
    const now = new Date().toISOString();
    db.prepare(`UPDATE tasks SET status = 'running', started_at = ? WHERE id = ?`).run(now, task.id);
    runner
      .run(task)
      .catch((err) => {
        db.prepare(
          `UPDATE tasks SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`
        ).run(`调度错误：${err.message}`, new Date().toISOString(), task.id);
      })
      .finally(() => {
        if (runningCount() < concurrency) tick();
      });
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

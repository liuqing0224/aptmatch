import fs from 'node:fs';
import { taskLogPath, taskWorkspace } from './paths.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// 清理超龄任务的工作区目录与日志文件。
// 只按数据库中已知的任务 id 删除，绝不扫描目录盲删，避免误删用户文件。
export function cleanupOldJobs(
  db,
  { keepDoneDays = 30, keepFailedDays = 90, now = new Date() } = {}
) {
  const stats = { cleaned: 0, workspaces: 0, logs: 0 };
  let rows;
  try {
    rows = db.prepare(`SELECT id, status, finished_at, created_at FROM tasks`).all();
  } catch {
    return stats;
  }

  const nowMs = new Date(now).getTime();

  for (const row of rows) {
    // 活跃任务绝不删除
    if (row.status === 'queued' || row.status === 'running') continue;
    // 年龄取 finished_at，缺失则回退 created_at
    const ts = row.finished_at || row.created_at;
    if (!ts) continue;
    const ageMs = nowMs - new Date(ts).getTime();
    if (Number.isNaN(ageMs)) continue;
    const keepDays = row.status === 'failed' ? keepFailedDays : keepDoneDays;
    if (ageMs / DAY_MS <= keepDays) continue;

    stats.cleaned += 1;
    stats.workspaces += removeWorkspace(row.id);
    stats.logs += removeLog(row.id);
  }

  return stats;
}

function removeWorkspace(id) {
  const dir = taskWorkspace(id);
  try {
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return !fs.existsSync(dir);
  } catch {
    return false;
  }
}

function removeLog(id) {
  try {
    fs.unlinkSync(taskLogPath(id));
    return true;
  } catch {
    // 日志不存在等场景直接忽略
    return false;
  }
}

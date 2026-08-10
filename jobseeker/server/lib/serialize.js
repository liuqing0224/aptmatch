import { rowById } from '../db.js';

/** 把 tasks 行转成前端可用的 Task（挂载 agent/resume/company，解析 result JSON）。 */
export function serializeTask(db, task) {
  if (!task) return null;
  const t = { ...task };
  t.result = t.result ? JSON.parse(t.result) : null;
  t.agent = t.agent_id ? rowById(db, 'agents', t.agent_id) : null;
  t.resume = t.resume_id ? rowById(db, 'resumes', t.resume_id) : null;
  t.company = t.company_id ? rowById(db, 'companies', t.company_id) : null;
  delete t.agent_id;
  delete t.resume_id;
  delete t.company_id;
  return t;
}

export function emitTaskChanged(hub, db, task) {
  if (!hub) return;
  hub.emit('task', { task: serializeTask(db, task) });
}

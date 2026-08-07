import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { nowIso, rowById } from '../db.js';
import { taskLogPath } from '../lib/paths.js';

export function tasksRouter(db, runner, queue) {
  const r = Router();

  function serialize(task) {
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

  r.get('/', (req, res) => {
    const rows = db
      .prepare(`SELECT * FROM tasks ORDER BY created_at DESC LIMIT 200`)
      .all()
      .map(serialize);
    res.json({ tasks: rows });
  });

  r.post('/', (req, res) => {
    const b = req.body ?? {};
    const { agent_id, resume_id, company_id } = b;
    const mode = b.mode ?? 'fit';
    const parent_task_id = b.parent_task_id ?? null;
    const extra_prompt = (b.extra_prompt ?? '').trim();

    if (!resume_id || !company_id) {
      return res.status(400).json({ error: 'resume_id 和 company_id 必填' });
    }
    const resume = rowById(db, 'resumes', resume_id);
    const company = rowById(db, 'companies', company_id);
    if (!resume) return res.status(400).json({ error: '简历不存在' });
    if (!company) return res.status(400).json({ error: '公司不存在' });

    let agent = agent_id ? rowById(db, 'agents', agent_id) : null;
    if (!agent) {
      agent = db
        .prepare(`SELECT * FROM agents WHERE status = 'active' ORDER BY created_at ASC LIMIT 1`)
        .get() ?? null;
    }
    if (agent && agent.status !== 'active') {
      return res.status(400).json({ error: '所选 agent 未启用' });
    }

    const id = randomUUID();
    let title;
    if (mode === 'followup') {
      const parent = rowById(db, 'tasks', parent_task_id);
      title = `追问：${parent?.title ?? '契合度分析'}`;
    } else {
      title = `契合度：${resume.name} × ${company.name}`;
    }

    db.prepare(
      `INSERT INTO tasks (id, title, mode, agent_id, resume_id, company_id, parent_task_id, extra_prompt, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`
    ).run(id, title, mode, agent?.id ?? null, resume.id, company.id, parent_task_id, extra_prompt, nowIso());
    queue.enqueue();
    res.status(201).json({ task: serialize(rowById(db, 'tasks', id)) });
  });

  r.get('/:id', (req, res) => {
    const task = serialize(rowById(db, 'tasks', req.params.id));
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.json({ task });
  });

  r.post('/:id/cancel', (req, res) => {
    const task = rowById(db, 'tasks', req.params.id);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (task.status === 'queued') {
      db.prepare(`UPDATE tasks SET status = 'cancelled', error = '用户取消', finished_at = ? WHERE id = ?`).run(
        nowIso(),
        task.id
      );
    } else if (task.status === 'running') {
      const killed = runner.cancel(task.id);
      if (!killed) {
        db.prepare(`UPDATE tasks SET status = 'cancelled', error = '用户取消', finished_at = ? WHERE id = ?`).run(
          nowIso(),
          task.id
        );
      }
    } else {
      return res.status(400).json({ error: `任务已处于 ${task.status} 状态` });
    }
    res.json({ ok: true });
  });

  r.post('/:id/rerun', (req, res) => {
    const task = rowById(db, 'tasks', req.params.id);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (task.status === 'running' || task.status === 'queued') {
      return res.status(400).json({ error: '任务正在运行或排队中' });
    }
    db.prepare(
      `UPDATE tasks SET status = 'queued', result = NULL, error = '', started_at = NULL, finished_at = NULL, pid = NULL WHERE id = ?`
    ).run(task.id);
    queue.enqueue();
    res.json({ ok: true });
  });

  r.post('/:id/followup', (req, res) => {
    const parent = rowById(db, 'tasks', req.params.id);
    if (!parent) return res.status(404).json({ error: '任务不存在' });
    const message = (req.body?.message ?? '').trim();
    if (!message) return res.status(400).json({ error: '追问内容必填' });

    const id = randomUUID();
    db.prepare(
      `INSERT INTO tasks (id, title, mode, agent_id, resume_id, company_id, parent_task_id, extra_prompt, status, created_at)
       VALUES (?, ?, 'followup', ?, ?, ?, ?, ?, 'queued', ?)`
    ).run(
      id,
      `追问：${parent.title}`,
      parent.agent_id,
      parent.resume_id,
      parent.company_id,
      parent.id,
      message,
      nowIso()
    );
    queue.enqueue();
    res.status(201).json({ task: serialize(rowById(db, 'tasks', id)) });
  });

  r.get('/:id/log', (req, res) => {
    const task = rowById(db, 'tasks', req.params.id);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    const p = taskLogPath(task.id);
    let text = '';
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p);
      const tail = buf.subarray(Math.max(0, buf.length - 60 * 1024));
      text = tail.toString('utf8');
    }
    res.json({ log: text });
  });

  return r;
}

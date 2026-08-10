import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { nowIso, rowById } from '../db.js';
import { taskLogPath } from '../lib/paths.js';
import { serializeTask, emitTaskChanged } from '../lib/serialize.js';
import { buildFitReportPdf } from '../lib/pdf.js';
import { parseInterviewParams } from '../lib/interview.js';

export function tasksRouter(db, runner, queue, hub = null) {
  const r = Router();

  function serialize(task) {
    return serializeTask(db, task);
  }

  function readLogTail(taskId) {
    const p = taskLogPath(taskId);
    if (!fs.existsSync(p)) return '';
    const buf = fs.readFileSync(p);
    return buf.subarray(Math.max(0, buf.length - 60 * 1024)).toString('utf8');
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
    emitTaskChanged(hub, db, rowById(db, 'tasks', id));
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
      emitTaskChanged(hub, db, rowById(db, 'tasks', task.id));
    } else if (task.status === 'running') {
      const killed = runner.cancel(task.id);
      if (!killed) {
        db.prepare(`UPDATE tasks SET status = 'cancelled', error = '用户取消', finished_at = ? WHERE id = ?`).run(
          nowIso(),
          task.id
        );
        emitTaskChanged(hub, db, rowById(db, 'tasks', task.id));
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
    emitTaskChanged(hub, db, rowById(db, 'tasks', task.id));
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
    emitTaskChanged(hub, db, rowById(db, 'tasks', id));
    res.status(201).json({ task: serialize(rowById(db, 'tasks', id)) });
  });

  // 开始模拟面试：从已完成 fit 任务派生第 1 轮 interview 任务
  r.post('/:id/mock-interview/start', (req, res) => {
    const parent = rowById(db, 'tasks', req.params.id);
    if (!parent) return res.status(404).json({ error: '任务不存在' });
    if (parent.status !== 'done' || !parent.result) {
      return res.status(400).json({ error: '只有已完成的分析可以开始模拟面试' });
    }
    const maxRounds = Number(req.body?.max_rounds) > 0 ? Math.min(Number(req.body.max_rounds), 20) : 8;
    const id = randomUUID();
    const title = `模拟面试：${parent.title.replace(/^契合度：/, '')}`;
    db.prepare(
      `INSERT INTO tasks (id, title, mode, agent_id, resume_id, company_id, parent_task_id, extra_prompt, status, created_at)
       VALUES (?, ?, 'interview', ?, ?, ?, ?, ?, 'queued', ?)`
    ).run(
      id,
      title,
      parent.agent_id,
      parent.resume_id,
      parent.company_id,
      parent.id,
      JSON.stringify({ round: 1, answer: '', max_rounds: maxRounds }),
      nowIso()
    );
    queue.enqueue();
    emitTaskChanged(hub, db, rowById(db, 'tasks', id));
    res.status(201).json({ task: serialize(rowById(db, 'tasks', id)) });
  });

  // 提交面试回答：派生下一轮 interview 任务
  r.post('/:id/mock-interview/answer', (req, res) => {
    const cur = rowById(db, 'tasks', req.params.id);
    if (!cur) return res.status(404).json({ error: '任务不存在' });
    if (cur.mode !== 'interview') return res.status(400).json({ error: '只有模拟面试任务可以提交回答' });
    if (cur.status !== 'done' || !cur.result) {
      return res.status(400).json({ error: '上一轮面试尚未完成' });
    }
    const answer = (req.body?.answer ?? '').trim();
    if (!answer) return res.status(400).json({ error: '回答内容必填' });
    const p = parseInterviewParams(cur.extra_prompt);
    const result = JSON.parse(cur.result);
    if (result.finished) return res.status(400).json({ error: '模拟面试已结束，无需再作答' });

    const id = randomUUID();
    const title = cur.title;
    db.prepare(
      `INSERT INTO tasks (id, title, mode, agent_id, resume_id, company_id, parent_task_id, extra_prompt, status, created_at)
       VALUES (?, ?, 'interview', ?, ?, ?, ?, ?, 'queued', ?)`
    ).run(
      id,
      title,
      cur.agent_id,
      cur.resume_id,
      cur.company_id,
      cur.id,
      JSON.stringify({ round: p.round + 1, answer, max_rounds: p.maxRounds }),
      nowIso()
    );
    queue.enqueue();
    emitTaskChanged(hub, db, rowById(db, 'tasks', id));
    res.status(201).json({ task: serialize(rowById(db, 'tasks', id)) });
  });

  // 获取整条模拟面试对话链
  r.get('/:id/mock-interview', (req, res) => {
    const task = rowById(db, 'tasks', req.params.id);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (task.mode !== 'interview') {
      return res.status(400).json({ error: '该任务不是模拟面试' });
    }
    const turns = [];
    let cur = task;
    while (cur && cur.mode === 'interview') {
      let result = null;
      try {
        result = cur.result ? JSON.parse(cur.result) : null;
      } catch {
        result = null;
      }
      turns.unshift({
        task_id: cur.id,
        round: result?.round ?? parseInterviewParams(cur.extra_prompt).round,
        question: result?.question ?? '',
        answer: parseInterviewParams(cur.extra_prompt).answer,
        evaluation: result?.evaluation ?? '',
        hint: result?.hint ?? '',
        finished: result?.finished ?? false,
        overall_assessment: result?.overall_assessment ?? '',
        status: cur.status,
        created_at: cur.created_at,
      });
      cur = cur.parent_task_id ? rowById(db, 'tasks', cur.parent_task_id) : null;
    }
    const fitTask = cur; // 链的根部是原始 fit 任务
    const fitReport = fitTask?.result ? JSON.parse(fitTask.result) : null;
    res.json({
      turns,
      fit: fitTask ? { id: fitTask.id, title: fitTask.title } : null,
      fit_report: fitReport,
    });
  });

  r.get('/:id/log', (req, res) => {
    const task = rowById(db, 'tasks', req.params.id);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.json({ log: readLogTail(task.id) });
  });

  // 实时日志流（SSE）：先发送当前尾部，再持续推送新产生的日志
  r.get('/:id/log/stream', (req, res) => {
    const task = rowById(db, 'tasks', req.params.id);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const send = (chunk) =>
      res.write(`event: log\ndata: ${JSON.stringify({ taskId: task.id, ...chunk })}\n\n`);
    send({ data: readLogTail(task.id), initial: true });
    const off = hub
      ? hub.on('log', (chunk) => {
          if (chunk.taskId === task.id) send({ data: chunk.data });
        })
      : () => {};
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      off();
      clearInterval(heartbeat);
    });
  });

  r.get('/:id/export.pdf', (req, res) => {
    const task = rowById(db, 'tasks', req.params.id);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (task.status !== 'done' || !task.result) {
      return res.status(400).json({ error: '任务未完成，无法导出 PDF' });
    }
    const result = JSON.parse(task.result);
    if ('results' in result || result.type === 'interview_turn') {
      return res.status(400).json({ error: '只有契合度报告可以导出 PDF' });
    }
    const serialized = serialize(task);
    const doc = buildFitReportPdf(serialized, result);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-${task.id}.pdf"`);
    doc.pipe(res);
  });

  return r;
}

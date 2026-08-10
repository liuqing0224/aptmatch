import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { nowIso, rowById } from '../db.js';

export const CANDIDATE_STATUSES = ['待筛', '已筛', '通过', '待定', '淘汰'];
const MAX_IMPORT = 100;

function pickAgent(db, agentId) {
  let agent = agentId ? rowById(db, 'agents', agentId) : null;
  if (!agent) {
    agent =
      db.prepare(`SELECT * FROM agents WHERE status = 'active' ORDER BY created_at ASC LIMIT 1`).get() ??
      null;
  }
  if (agent && agent.status !== 'active') return null;
  return agent ?? null;
}

function candidateWithContext(db, id) {
  return db
    .prepare(
      `SELECT c.*, r.name AS resume_name, p.name AS position_name,
              (SELECT t.id FROM tasks t WHERE t.resume_id = c.resume_id AND t.company_id = c.position_id AND t.mode = 'fit' ORDER BY t.created_at DESC LIMIT 1) AS analysis_task_id,
              (SELECT t.status FROM tasks t WHERE t.resume_id = c.resume_id AND t.company_id = c.position_id AND t.mode = 'fit' ORDER BY t.created_at DESC LIMIT 1) AS analysis_task_status
       FROM candidates c JOIN resumes r ON r.id = c.resume_id JOIN companies p ON p.id = c.position_id
       WHERE c.id = ?`
    )
    .get(id);
}

export function candidatesRouter(db, queue) {
  const r = Router();
  const insertResume = db.prepare(
    `INSERT INTO resumes (id, name, text, source_file, created_at) VALUES (?, ?, ?, '', ?)`
  );
  const insertCandidate = db.prepare(
    `INSERT INTO candidates (id, resume_id, position_id, source_url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, '待筛', ?, ?)`
  );
  const insertTask = db.prepare(
    `INSERT INTO tasks (id, title, mode, agent_id, resume_id, company_id, parent_task_id, extra_prompt, status, created_at)
     VALUES (?, ?, 'fit', ?, ?, ?, NULL, '', 'queued', ?)`
  );

  r.get('/', (req, res) => {
    const positionId = req.query.position_id ?? null;
    const status = req.query.status ?? null;
    let sql = `SELECT c.*, r.name AS resume_name, p.name AS position_name,
                      (SELECT t.id FROM tasks t
                       WHERE t.resume_id = c.resume_id AND t.company_id = c.position_id AND t.mode = 'fit'
                       ORDER BY t.created_at DESC LIMIT 1) AS analysis_task_id,
                      (SELECT t.status FROM tasks t
                       WHERE t.resume_id = c.resume_id AND t.company_id = c.position_id AND t.mode = 'fit'
                       ORDER BY t.created_at DESC LIMIT 1) AS analysis_task_status
               FROM candidates c
               JOIN resumes r ON r.id = c.resume_id
               JOIN companies p ON p.id = c.position_id`;
    const where = [];
    const params = [];
    if (positionId) {
      where.push('c.position_id = ?');
      params.push(positionId);
    }
    if (status) {
      where.push('c.status = ?');
      params.push(status);
    }
    if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY (c.overall_score IS NULL), c.overall_score DESC, c.created_at DESC';
    res.json({ candidates: db.prepare(sql).all(...params) });
  });

  // 批量导入飞书招聘采集到的候选人，自动派发筛选任务
  r.post('/import-feishu', (req, res) => {
    const b = req.body ?? {};
    const position = rowById(db, 'companies', b.position_id);
    if (!position || position.kind !== 'position') {
      return res.status(400).json({ error: '职位不存在' });
    }
    const items = Array.isArray(b.candidates) ? b.candidates : [];
    if (items.length === 0) return res.status(400).json({ error: '没有可导入的候选人' });
    if (items.length > MAX_IMPORT) {
      return res.status(400).json({ error: `单次最多导入 ${MAX_IMPORT} 位候选人` });
    }
    const agent = pickAgent(db, b.agent_id);
    if (b.agent_id && !agent) return res.status(400).json({ error: '所选 agent 未启用' });

    const now = nowIso();
    const imported = [];
    const dispatched = [];
    let skipped = 0;
    for (const it of items) {
      const sourceUrl = (it.source_url ?? '').trim();
      const name = (it.name ?? '').trim() || '未命名候选人';
      const text = (it.text ?? '').trim();
      if (!text) {
        skipped += 1;
        continue;
      }
      // 同一职位下按来源链接去重（同一候选人重复采集只保留一份）
      if (sourceUrl) {
        const existing = db
          .prepare(`SELECT resume_id FROM candidates WHERE position_id = ? AND source_url = ?`)
          .get(position.id, sourceUrl);
        if (existing) {
          skipped += 1;
          continue;
        }
      }
      const resumeId = randomUUID();
      insertResume.run(resumeId, name, text, now);
      const cid = randomUUID();
      insertCandidate.run(cid, resumeId, position.id, sourceUrl, now, now);
      const tid = randomUUID();
      insertTask.run(tid, `筛选：${name} × ${position.name}`, agent?.id ?? null, resumeId, position.id, now);
      imported.push({ id: cid, resume_id: resumeId, name, source_url: sourceUrl });
      dispatched.push(tid);
    }
    if (dispatched.length > 0) queue.enqueue();
    res.status(201).json({
      imported,
      skipped,
      dispatched,
      message: `已导入 ${imported.length} 位候选人（跳过 ${skipped} 条）并派发 ${dispatched.length} 个筛选任务`,
    });
  });

  // 启动采集 Agent：项目内 Playwright skill 使用独立浏览器会话并按职位导入
  r.post('/collect-start', (req, res) => {
    const position = rowById(db, 'companies', req.body?.position_id);
    if (!position || position.kind !== 'position') {
      return res.status(400).json({ error: '职位不存在，请先在「职位与 JD」创建职位' });
    }
    const active = db
      .prepare(
        `SELECT id FROM tasks WHERE mode = 'collect' AND company_id = ? AND status IN ('queued', 'running')`
      )
      .get(position.id);
    if (active) {
      return res.status(409).json({ error: `「${position.name}」已有采集任务在排队或运行中` });
    }
    const id = randomUUID();
    db.prepare(
      `INSERT INTO tasks (id, title, mode, agent_id, resume_id, company_id, parent_task_id, extra_prompt, status, created_at)
       VALUES (?, ?, 'collect', NULL, NULL, ?, NULL, '', 'queued', ?)`
    ).run(id, `采集：${position.name} 飞书候选人`, position.id, nowIso());
    queue.enqueue();
    res.status(201).json({ task: rowById(db, 'tasks', id) });
  });

  r.patch('/:id', (req, res) => {
    const c = rowById(db, 'candidates', req.params.id);
    if (!c) return res.status(404).json({ error: '候选人不存在' });
    const b = req.body ?? {};
    const status = b.status ?? null;
    const note = b.note !== undefined ? String(b.note) : null;
    if (status && !CANDIDATE_STATUSES.includes(status)) {
      return res.status(400).json({ error: `状态必须是：${CANDIDATE_STATUSES.join(' / ')}` });
    }
    db.prepare(
      `UPDATE candidates SET status = COALESCE(?, status), note = COALESCE(?, note), updated_at = ? WHERE id = ?`
    ).run(status, note, nowIso(), c.id);
    res.json({ candidate: candidateWithContext(db, c.id) });
  });

  return r;
}

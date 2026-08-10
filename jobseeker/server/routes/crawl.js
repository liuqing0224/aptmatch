import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { nowIso, rowById } from '../db.js';
import { emitTaskChanged } from '../lib/serialize.js';
import { parseCrawlParams } from '../lib/crawl.js';
import { prescreenResults } from '../lib/prescreen.js';

export function crawlRouter(db, queue, hub = null) {
  const r = Router();
  const emitResource = () => hub?.emit('resource', { kind: 'companies' });
  const insertCompany = db.prepare(
    `INSERT INTO companies (id, name, industry, stage, url, jd_text, source_file, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?)`
  );
  const insertTask = db.prepare(
    `INSERT INTO tasks (id, title, mode, agent_id, resume_id, company_id, parent_task_id, extra_prompt, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'queued', ?)`
  );

  function pickAgent(agent_id) {
    let agent = agent_id ? rowById(db, 'agents', agent_id) : null;
    if (!agent) {
      agent =
        db.prepare(`SELECT * FROM agents WHERE status = 'active' ORDER BY created_at ASC LIMIT 1`).get() ??
        null;
    }
    if (agent && agent.status !== 'active') return null;
    return agent ?? null;
  }

  // 创建采集任务
  r.post('/', (req, res) => {
    const b = req.body ?? {};
    let keyword = (b.keyword ?? '').trim();
    const resumeId = b.resume_id ?? null;
    if (!keyword && resumeId) {
      // 未给关键词时，尝试从简历「求职意向」推导
      const resume = rowById(db, 'resumes', resumeId);
      const m = resume?.text?.match(/求职意向[：:]\s*([^\n]+)/);
      if (m) keyword = m[1].split(/[/、，,。]/)[0].trim();
    }
    if (!keyword) {
      return res
        .status(400)
        .json({ error: '关键词必填（未从简历解析到求职意向，请填写岗位关键词）' });
    }
    const city = (b.city ?? '全国').trim() || '全国';
    const limit = Number(b.limit) > 0 ? Math.min(Number(b.limit), 20) : 6;
    if (resumeId && !rowById(db, 'resumes', resumeId)) {
      return res.status(400).json({ error: '简历不存在' });
    }
    const agent = pickAgent(b.agent_id);
    if (b.agent_id && !agent) return res.status(400).json({ error: '所选 agent 未启用' });

    const id = randomUUID();
    insertTask.run(
      id,
      `爬取岗位：${keyword}（${city}）`,
      'crawl',
      agent?.id ?? null,
      resumeId,
      null,
      JSON.stringify({ keyword, city, limit }),
      nowIso()
    );
    queue.enqueue();
    const task = rowById(db, 'tasks', id);
    emitTaskChanged(hub, db, task);
    res.status(201).json({ task });
  });

  // 导入采集结果并（可选）批量派发匹配任务
  r.post('/:taskId/import', (req, res) => {
    const task = rowById(db, 'tasks', req.params.taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (task.mode !== 'crawl') return res.status(400).json({ error: '只有采集任务可以导入' });
    if (task.status !== 'done' || !task.result) {
      return res.status(400).json({ error: '采集任务尚未完成' });
    }
    const result = JSON.parse(task.result);
    const items = result.results ?? [];
    const indices = Array.isArray(req.body?.indices) ? req.body.indices : null;
    const selected = indices
      ? indices.filter((i) => Number.isInteger(i) && i >= 0 && i < items.length).map((i) => items[i])
      : items;
    if (selected.length === 0) return res.status(400).json({ error: '没有可导入的结果' });

    const resumeId = req.body?.resume_id ?? null;
    if (resumeId && !rowById(db, 'resumes', resumeId)) {
      return res.status(400).json({ error: '简历不存在' });
    }
    const agent = pickAgent(req.body?.agent_id);

    const imported = [];
    const dispatched = [];
    const seenByCompany = new Map(); // company_name -> position_title
    for (const it of selected) {
      // 同一家公司不同岗位：拆成独立公司记录（name 追加岗位名），避免 JD 互相覆盖
      let name = it.company_name;
      const prevPos = seenByCompany.get(it.company_name);
      if (prevPos && prevPos !== it.position_title) {
        name = `${it.company_name} · ${it.position_title}`;
      }
      seenByCompany.set(it.company_name, it.position_title);

      let company = db.prepare(`SELECT * FROM companies WHERE name = ?`).get(name);
      if (!company) {
        const cid = randomUUID();
        insertCompany.run(
          cid,
          name,
          it.industry ?? '',
          it.stage ?? '',
          it.company_url ?? '',
          it.jd_text ?? '',
          nowIso()
        );
        company = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(cid);
      }
      imported.push(company);
      if (req.body?.auto_dispatch && resumeId) {
        const tid = randomUUID();
        insertTask.run(
          tid,
          `契合度：${rowById(db, 'resumes', resumeId)?.name ?? ''} × ${company.name}`,
          'fit',
          agent?.id ?? null,
          resumeId,
          company.id,
          '',
          nowIso()
        );
        dispatched.push(tid);
      }
    }
    if (dispatched.length > 0) queue.enqueue();
    if (imported.length > 0) emitResource();
    for (const tid of dispatched) emitTaskChanged(hub, db, rowById(db, 'tasks', tid));
    res.json({
      imported: imported.map((c) => ({ id: c.id, name: c.name, industry: c.industry, stage: c.stage })),
      dispatched,
      message: dispatched.length > 0 ? `已导入 ${imported.length} 家公司并派发 ${dispatched.length} 个匹配任务` : `已导入 ${imported.length} 家公司`,
    });
  });

  // 采集结果智能预筛：按薪资/城市/匹配度打分并过滤
  r.post('/:taskId/prescreen', (req, res) => {
    const task = rowById(db, 'tasks', req.params.taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (task.mode !== 'crawl') return res.status(400).json({ error: '只有采集任务可以预筛' });
    if (task.status !== 'done' || !task.result) {
      return res.status(400).json({ error: '采集任务尚未完成' });
    }
    const result = JSON.parse(task.result);
    const items = result.results ?? [];
    if (items.length === 0) return res.json({ results: [] });

    const resumeId = req.body?.resume_id ?? null;
    let resumeText = null;
    if (resumeId) {
      const resume = rowById(db, 'resumes', resumeId);
      if (!resume) return res.status(400).json({ error: '简历不存在' });
      resumeText = resume.text;
    }
    const filters = {
      minK: req.body?.filters?.minK,
      maxK: req.body?.filters?.maxK,
      city: req.body?.filters?.city,
      minScore: req.body?.filters?.minScore,
    };
    const results = prescreenResults(items, resumeText, filters);
    res.json({ results });
  });

  return r;
}

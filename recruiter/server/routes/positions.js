import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { nowIso, rowById } from '../db.js';
import { fetchDocFromLark } from '../lib/lark.js';

// 招聘端职位（JD）管理：职位以 kind='position' 存于 companies，与求职端公司隔离
export function positionsRouter(db, { fetchDoc = fetchDocFromLark } = {}) {
  const r = Router();
  const insert = db.prepare(
    `INSERT INTO companies (id, name, industry, stage, url, jd_text, source_file, kind, created_at)
     VALUES (?, ?, '', '', ?, ?, '', 'position', ?)`
  );

  r.get('/', (_req, res) => {
    const rows = db
      .prepare(`SELECT * FROM companies WHERE kind = 'position' ORDER BY created_at DESC`)
      .all();
    res.json({ positions: rows });
  });

  // 新建职位：可配置飞书文档链接（由本地 lark-cli 读取 JD），或直接粘贴 JD 文本
  r.post('/', async (req, res) => {
    const b = req.body ?? {};
    const name = (b.name ?? '').trim();
    if (!name) return res.status(400).json({ error: '职位名必填' });
    const docUrl = (b.feishu_doc_url ?? '').trim();
    let jd = (b.jd_text ?? '').trim();
    if (docUrl) {
      try {
        jd = await fetchDoc({ url: docUrl });
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
    }
    if (!jd) {
      return res
        .status(400)
        .json({ error: '没有可用的 JD 文本（请粘贴 JD，或配置可访问的飞书文档链接）' });
    }
    const id = randomUUID();
    insert.run(id, name, docUrl, jd, nowIso());
    const position = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(id);
    res.status(201).json({ position });
  });

  r.delete('/:id', (req, res) => {
    const row = rowById(db, 'companies', req.params.id);
    if (!row || row.kind !== 'position') return res.status(404).json({ error: '职位不存在' });
    const candidateCount = db
      .prepare(`SELECT COUNT(*) AS n FROM candidates WHERE position_id = ?`)
      .get(row.id).n;
    if (candidateCount > 0) {
      return res.status(400).json({ error: `该职位下已有 ${candidateCount} 位候选人，请先处理候选人` });
    }
    db.prepare(`UPDATE tasks SET company_id = NULL WHERE company_id = ?`).run(row.id);
    db.prepare(`DELETE FROM companies WHERE id = ?`).run(row.id);
    res.json({ ok: true });
  });

  return r;
}

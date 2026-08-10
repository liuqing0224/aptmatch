import { Router } from 'express';
import { buildComparePdf } from '../lib/pdf.js';

export function matchesRouter(db) {
  const r = Router();

  r.get('/', (req, res) => {
    const resumeId = req.query.resume_id;
    const where = [
      `t.status = 'done'`,
      `t.result IS NOT NULL`,
      `t.mode != 'crawl'`,
      // 求职端只展示公司类任务，招聘端职位（kind='position'）的筛选不混入对比
      `(p.id IS NULL OR COALESCE(p.kind, 'company') = 'company')`,
    ];
    const params = [];
    if (resumeId) {
      where.push('t.resume_id = ?');
      params.push(resumeId);
    }
    const rows = db
      .prepare(
        `SELECT t.* FROM tasks t
         LEFT JOIN companies p ON p.id = t.company_id
         WHERE ${where.join(' AND ')}
         ORDER BY t.created_at DESC`
      )
      .all(...params);
    const matches = rows.map((t) => {
      const result = JSON.parse(t.result);
      const resume = db.prepare(`SELECT name FROM resumes WHERE id = ?`).get(t.resume_id);
      const company = db.prepare(`SELECT name, id FROM companies WHERE id = ?`).get(t.company_id);
      const dims = Object.fromEntries(
        (result.dimensions ?? []).map((d) => [d.key, { label: d.label, score: d.score }])
      );
      return {
        task_id: t.id,
        title: t.title,
        resume_name: resume?.name ?? '（已删除简历）',
        company_id: company?.id ?? null,
        company_name: company?.name ?? '（已删除公司）',
        overall_score: result.overall_score,
        grade: result.grade,
        summary: result.summary,
        dimensions: dims,
        created_at: t.created_at,
      };
    });
    res.json({ matches });
  });

  // 同公司历史趋势：该公司全部 done 任务按时间升序
  r.get('/trend', (req, res) => {
    const companyId = req.query.company_id;
    const resumeId = req.query.resume_id;
    if (!companyId) return res.status(400).json({ error: 'company_id 必填' });

    let rows;
    if (resumeId) {
      rows = db
        .prepare(
          `SELECT * FROM tasks WHERE status = 'done' AND result IS NOT NULL AND mode NOT IN ('crawl','interview') AND company_id = ? AND resume_id = ? ORDER BY created_at ASC`
        )
        .all(companyId, resumeId);
    } else {
      rows = db
        .prepare(
          `SELECT * FROM tasks WHERE status = 'done' AND result IS NOT NULL AND mode NOT IN ('crawl','interview') AND company_id = ? ORDER BY created_at ASC`
        )
        .all(companyId);
    }
    const trend = rows.map((t) => {
      const result = JSON.parse(t.result);
      const dims = Object.fromEntries(
        (result.dimensions ?? []).map((d) => [d.key, d.score])
      );
      return {
        task_id: t.id,
        title: t.title,
        created_at: t.created_at,
        overall_score: result.overall_score,
        grade: result.grade,
        dims,
      };
    });
    res.json({ trend });
  });

  // 对比表导出 PDF
  r.get('/export.pdf', (req, res) => {
    const resumeId = req.query.resume_id;
    let rows;
    if (resumeId) {
      rows = db
        .prepare(
          `SELECT * FROM tasks WHERE status = 'done' AND result IS NOT NULL AND mode NOT IN ('crawl','interview') AND resume_id = ? ORDER BY created_at DESC`
        )
        .all(resumeId);
    } else {
      rows = db
        .prepare(
          `SELECT * FROM tasks WHERE status = 'done' AND result IS NOT NULL AND mode NOT IN ('crawl','interview') ORDER BY created_at DESC`
        )
        .all();
    }
    const matches = rows.map((t) => {
      const result = JSON.parse(t.result);
      const company = db.prepare(`SELECT name FROM companies WHERE id = ?`).get(t.company_id);
      const dims = Object.fromEntries(
        (result.dimensions ?? []).map((d) => [d.key, { label: d.label, score: d.score }])
      );
      return {
        task_id: t.id,
        company_name: company?.name ?? '（已删除公司）',
        overall_score: result.overall_score,
        grade: result.grade,
        dimensions: dims,
      };
    });
    if (matches.length === 0) return res.status(404).json({ error: '暂无对比数据' });

    const dimKeys = [...new Set(matches.flatMap((m) => Object.keys(m.dimensions)))];
    const resume = resumeId ? db.prepare(`SELECT name FROM resumes WHERE id = ?`).get(resumeId) : null;
    const doc = buildComparePdf(
      matches,
      dimKeys,
      `跨公司对比${resume ? `：${resume.name}` : ''}`
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="compare-${Date.now()}.pdf"`);
    doc.pipe(res);
  });

  return r;
}

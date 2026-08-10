import { Router } from 'express';

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

  return r;
}

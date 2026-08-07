import { Router } from 'express';

export function matchesRouter(db) {
  const r = Router();

  r.get('/', (req, res) => {
    const resumeId = req.query.resume_id;
    let rows;
    if (resumeId) {
      rows = db
        .prepare(
          `SELECT * FROM tasks WHERE status = 'done' AND result IS NOT NULL AND mode != 'crawl' AND resume_id = ? ORDER BY created_at DESC`
        )
        .all(resumeId);
    } else {
      rows = db
        .prepare(
          `SELECT * FROM tasks WHERE status = 'done' AND result IS NOT NULL AND mode != 'crawl' ORDER BY created_at DESC`
        )
        .all();
    }
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

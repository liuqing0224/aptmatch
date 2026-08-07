import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { nowIso } from '../db.js';
import { extractText } from '../lib/extract.js';
import { UPLOADS_DIR } from '../lib/paths.js';

export function companiesRouter(db) {
  const r = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  const insert = db.prepare(
    `INSERT INTO companies (id, name, industry, stage, url, jd_text, source_file, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  r.get('/', (_req, res) => {
    const rows = db.prepare(`SELECT * FROM companies ORDER BY created_at DESC`).all();
    res.json({ companies: rows });
  });

  r.post('/', upload.single('file'), async (req, res) => {
    try {
      let jdText = (req.body?.jd_text ?? '').trim();
      let sourceFile = '';
      if (req.file) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        const ext = path.extname(req.file.originalname);
        const saved = `${randomUUID()}${ext}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, saved), req.file.buffer);
        sourceFile = saved;
        if (!jdText) {
          jdText = (await extractText({ buffer: req.file.buffer, filename: req.file.originalname })).trim();
        }
      }
      const name = (req.body?.name ?? '').trim();
      if (!name) return res.status(400).json({ error: '公司名必填' });
      if (!jdText) return res.status(400).json({ error: '没有可用的职位描述文本（请粘贴 JD 或上传文件）' });
      const id = randomUUID();
      insert.run(
        id,
        name,
        (req.body?.industry ?? '').trim(),
        (req.body?.stage ?? '').trim(),
        (req.body?.url ?? '').trim(),
        jdText,
        sourceFile,
        nowIso()
      );
      const company = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(id);
      res.status(201).json({ company });
    } catch (e) {
      res.status(400).json({ error: `职位描述解析失败：${e.message}` });
    }
  });

  r.delete('/:id', (req, res) => {
    const row = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: '公司不存在' });
    db.prepare(`UPDATE tasks SET company_id = NULL WHERE company_id = ?`).run(row.id);
    db.prepare(`DELETE FROM companies WHERE id = ?`).run(row.id);
    res.json({ ok: true });
  });

  return r;
}

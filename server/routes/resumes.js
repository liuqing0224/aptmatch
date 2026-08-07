import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { nowIso } from '../db.js';
import { extractText } from '../lib/extract.js';
import { UPLOADS_DIR } from '../lib/paths.js';

export function resumesRouter(db) {
  const r = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  const insert = db.prepare(
    `INSERT INTO resumes (id, name, text, source_file, created_at) VALUES (?, ?, ?, ?, ?)`
  );

  r.get('/', (_req, res) => {
    const rows = db.prepare(`SELECT * FROM resumes ORDER BY created_at DESC`).all();
    res.json({ resumes: rows });
  });

  r.post('/', upload.single('file'), async (req, res) => {
    try {
      let text = (req.body?.text ?? '').trim();
      let sourceFile = '';
      if (req.file) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        const ext = path.extname(req.file.originalname);
        const saved = `${randomUUID()}${ext}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, saved), req.file.buffer);
        sourceFile = saved;
        if (!text) {
          text = (await extractText({ buffer: req.file.buffer, filename: req.file.originalname })).trim();
        }
      }
      if (!text) return res.status(400).json({ error: '没有可用的简历文本（请粘贴文本或上传 PDF/DOCX）' });
      const name = (req.body?.name ?? '').trim() || (req.file ? req.file.originalname : '未命名简历');
      const id = randomUUID();
      insert.run(id, name, text, sourceFile, nowIso());
      const resume = db.prepare(`SELECT * FROM resumes WHERE id = ?`).get(id);
      res.status(201).json({ resume });
    } catch (e) {
      res.status(400).json({ error: `简历解析失败：${e.message}` });
    }
  });

  r.delete('/:id', (req, res) => {
    const row = db.prepare(`SELECT * FROM resumes WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: '简历不存在' });
    db.prepare(`UPDATE tasks SET resume_id = NULL WHERE resume_id = ?`).run(row.id);
    db.prepare(`DELETE FROM resumes WHERE id = ?`).run(row.id);
    res.json({ ok: true });
  });

  return r;
}

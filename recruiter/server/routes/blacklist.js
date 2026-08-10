import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { nowIso } from '../db.js';
import { checkCompany, listEntries, syncAll, syncSource } from '../lib/blacklist.js';

// 内存中的同步状态（避免并发重复同步）
const syncing = new Set();

export function blacklistRouter(db, { getFetcher } = {}) {
  const r = Router();

  function serializeSource(row) {
    if (!row) return null;
    const { entry_count: entryCount, ...rest } = row;
    return { ...rest, enabled: !!row.enabled, entry_count: entryCount ?? 0 };
  }

  function summary() {
    const sources = db
      .prepare(
        `SELECT s.*,
                (SELECT COUNT(*) FROM blacklist_entries e WHERE e.source_id = s.id) AS entry_count
         FROM blacklist_sources s ORDER BY s.created_at ASC`
      )
      .all()
      .map(serializeSource);
    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM blacklist_entries e JOIN blacklist_sources s ON s.id = e.source_id WHERE s.enabled = 1`)
      .get().n;
    return { sources, total, syncing: [...syncing] };
  }

  r.get('/', (req, res) => {
    const { q = '', city = '' } = req.query;
    const entries = listEntries(db, { q: String(q), city: String(city) });
    res.json({ ...summary(), entries, q, city });
  });

  r.get('/check', (req, res) => {
    const company = String(req.query.company ?? '').trim();
    if (!company) return res.json({ hits: [] });
    res.json({ hits: checkCompany(db, company) });
  });

  r.get('/sync/status', (_req, res) => res.json({ syncing: [...syncing] }));

  r.post('/sync', async (req, res) => {
    const sourceId = req.body?.sourceId ?? null;
    const targets = sourceId
      ? [db.prepare(`SELECT * FROM blacklist_sources WHERE id = ?`).get(sourceId)].filter(Boolean)
      : db.prepare(`SELECT * FROM blacklist_sources WHERE enabled = 1`).all();
    if (targets.length === 0) {
      return res.json({ results: [], message: '没有可同步的来源' });
    }
    const jobs = targets
      .filter((t) => !syncing.has(t.id))
      .map((t) => {
        syncing.add(t.id);
        return (async () => {
          try {
            const fetcher = getFetcher ? await getFetcher() : null;
            return await syncSource(db, t, fetcher);
          } finally {
            syncing.delete(t.id);
          }
        })();
      });
    if (jobs.length === 0) {
      return res.status(409).json({ error: '所选来源正在同步中' });
    }
    res.json({ started: jobs.length, syncing: [...syncing] });
    // 后台继续执行，结果由前端轮询 status 获取
    Promise.allSettled(jobs).catch(() => {});
  });

  r.post('/sources', (req, res) => {
    const b = req.body ?? {};
    const owner = String(b.owner ?? '').trim().replace(/^@/, '');
    const repo = String(b.repo ?? '').trim().replace(/\.git$/, '');
    const name = String(b.name ?? '').trim();
    if (!owner || !repo) {
      return res.status(400).json({ error: 'owner 和 repo 必填' });
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
      return res.status(400).json({ error: '仓库名格式不正确' });
    }
    const id = randomUUID();
    const now = nowIso();
    db.prepare(
      `INSERT INTO blacklist_sources (id, name, owner, repo, branch, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      id,
      name || `${owner}/${repo}`,
      owner,
      repo,
      String(b.branch ?? 'master').trim() || 'master',
      now,
      now
    );
    res.json({ source: serializeSource(rowById(db, id)) });
  });

  r.patch('/sources/:id', (req, res) => {
    const row = rowById(db, req.params.id);
    if (!row) return res.status(404).json({ error: '来源不存在' });
    const b = req.body ?? {};
    const sets = [];
    const params = [];
    if (b.enabled !== undefined) {
      sets.push('enabled = ?');
      params.push(b.enabled ? 1 : 0);
    }
    if (typeof b.name === 'string') {
      sets.push('name = ?');
      params.push(b.name.trim());
    }
    if (typeof b.branch === 'string' && b.branch.trim()) {
      sets.push('branch = ?');
      params.push(b.branch.trim());
    }
    sets.push('updated_at = ?');
    params.push(nowIso(), req.params.id);
    if (sets.length > 1) {
      db.prepare(`UPDATE blacklist_sources SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    res.json({ source: serializeSource(rowById(db, req.params.id)) });
  });

  r.delete('/sources/:id', (req, res) => {
    const row = rowById(db, req.params.id);
    if (!row) return res.status(404).json({ error: '来源不存在' });
    syncing.delete(row.id);
    db.prepare(`DELETE FROM blacklist_entries WHERE source_id = ?`).run(row.id);
    db.prepare(`DELETE FROM blacklist_sources WHERE id = ?`).run(row.id);
    res.json({ ok: true });
  });

  function rowById(d, id) {
    return d.prepare(`SELECT * FROM blacklist_sources WHERE id = ?`).get(id) ?? null;
  }

  return r;
}

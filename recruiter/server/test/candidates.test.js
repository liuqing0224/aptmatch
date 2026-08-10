import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import { openDb } from '../db.js';
import { candidatesRouter } from '../routes/candidates.js';
import { TaskRunner } from '../lib/runner.js';

function seed(db) {
  db.prepare(
    `INSERT INTO agents (id, name, slug, role, provider, model, status, created_at, updated_at)
     VALUES ('ag1', '分析师', 'analyst', '', 'codex', '', 'active', '2026-01-01', '2026-01-01')`
  ).run();
  db.prepare(
    `INSERT INTO companies (id, name, industry, stage, url, jd_text, source_file, kind, created_at)
     VALUES ('pos1', '高级前端', '', '', '', 'JD 正文', '', 'position', '2026-01-01')`
  ).run();
}

function makeApp(db, queue) {
  const app = express();
  app.use(express.json());
  app.use('/api/candidates', candidatesRouter(db, queue ?? { enqueue() {} }));
  return app;
}

async function withApp(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function importBody(base, body) {
  return fetch(`${base}/api/candidates/import-feishu`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('candidates（招聘端候选人）', () => {
  it('批量导入：写简历、建候选人并自动派发筛选任务', async () => {
    const db = openDb(':memory:');
    seed(db);
    const enqueue = vi.fn();
    await withApp(makeApp(db, { enqueue }), async (base) => {
      const res = await importBody(base, {
        position_id: 'pos1',
        candidates: [
          { name: '张三', text: '前端 5 年', source_url: 'https://feishu/hr/c1' },
          { name: '李四', text: '后端 3 年', source_url: 'https://feishu/hr/c2' },
        ],
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.imported).toHaveLength(2);
      expect(body.dispatched).toHaveLength(2);
      expect(enqueue).toHaveBeenCalledTimes(1);

      expect(db.prepare(`SELECT COUNT(*) AS n FROM resumes`).get().n).toBe(2);
      expect(db.prepare(`SELECT COUNT(*) AS n FROM candidates`).get().n).toBe(2);
      const tasks = db.prepare(`SELECT * FROM tasks`).all();
      expect(tasks).toHaveLength(2);
      expect(tasks[0]).toMatchObject({ mode: 'fit', resume_id: body.imported[0].resume_id, company_id: 'pos1' });
      expect(db.prepare(`SELECT COUNT(*) AS n FROM candidates WHERE status = '待筛'`).get().n).toBe(2);
    });
  });

  it('同一职位下按来源链接去重，空文本跳过', async () => {
    const db = openDb(':memory:');
    seed(db);
    await withApp(makeApp(db), async (base) => {
      const first = await importBody(base, {
        position_id: 'pos1',
        candidates: [
          { name: '张三', text: '简历 A', source_url: 'https://feishu/hr/c1' },
          { name: '', text: '   ', source_url: 'https://feishu/hr/empty' },
        ],
      });
      expect((await first.json()).imported).toHaveLength(1);

      const second = await importBody(base, {
        position_id: 'pos1',
        candidates: [{ name: '张三（重复）', text: '简历 A', source_url: 'https://feishu/hr/c1' }],
      });
      const body2 = await second.json();
      expect(body2.imported).toHaveLength(0);
      expect(body2.skipped).toBe(1);

      expect(db.prepare(`SELECT COUNT(*) AS n FROM candidates`).get().n).toBe(1);
      expect(db.prepare(`SELECT COUNT(*) AS n FROM tasks`).get().n).toBe(1);
    });
  });

  it('同一份简历可分别进入不同职位的候选人库', async () => {
    const db = openDb(':memory:');
    seed(db);
    db.prepare(
      `INSERT INTO companies (id, name, industry, stage, url, jd_text, source_file, kind, created_at)
       VALUES ('pos2', 'AI 产品经理', '', '', '', 'JD 2', '', 'position', '2026-01-01')`
    ).run();
    await withApp(makeApp(db), async (base) => {
      const candidate = { name: '张三', text: '同一份简历', source_url: 'https://feishu/hr/shared' };
      const first = await importBody(base, { position_id: 'pos1', candidates: [candidate] });
      const second = await importBody(base, { position_id: 'pos2', candidates: [candidate] });

      expect((await first.json()).imported).toHaveLength(1);
      expect((await second.json()).imported).toHaveLength(1);
      expect(db.prepare(`SELECT COUNT(*) AS n FROM candidates`).get().n).toBe(2);
      expect(db.prepare(`SELECT COUNT(DISTINCT position_id) AS n FROM candidates`).get().n).toBe(2);
    });
  });

  it('职位不存在或未传候选人时报 400', async () => {
    const db = openDb(':memory:');
    await withApp(makeApp(db), async (base) => {
      const noPos = await importBody(base, { position_id: 'nope', candidates: [{ name: 'a', text: 'b' }] });
      expect(noPos.status).toBe(400);
      const noItems = await importBody(base, { position_id: 'pos1', candidates: [] });
      expect(noItems.status).toBe(400);
    });
  });

  it('更新候选人状态返回带简历与职位上下文，前端可直接复用', async () => {
    const db = openDb(':memory:');
    seed(db);
    await withApp(makeApp(db), async (base) => {
      const imported = await importBody(base, {
        position_id: 'pos1',
        candidates: [{ name: '张三', text: '前端简历', source_url: 'https://feishu/hr/context' }],
      });
      const candidate = (await imported.json()).imported[0];
      const response = await fetch(`${base}/api/candidates/${candidate.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: '通过' }),
      });
      expect((await response.json()).candidate).toMatchObject({
        id: candidate.id,
        resume_name: '张三',
        position_name: '高级前端',
        status: '通过',
      });
    });
  });

  it('collect-start：创建采集任务并入队，重复启动与非法职位报错', async () => {
    const db = openDb(':memory:');
    seed(db);
    const enqueue = vi.fn();
    await withApp(makeApp(db, { enqueue }), async (base) => {
      const start = (position_id) =>
        fetch(`${base}/api/candidates/collect-start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ position_id }),
        });

      const res = await start('pos1');
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.task).toMatchObject({
        mode: 'collect',
        company_id: 'pos1',
        status: 'queued',
        title: '采集：高级前端 飞书候选人',
      });
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE mode = 'collect'`).get().n).toBe(1);

      // 同一职位重复启动 → 409
      const dup = await start('pos1');
      expect(dup.status).toBe(409);
      expect(db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE mode = 'collect'`).get().n).toBe(1);

      // 职位不存在 → 400
      const noPos = await start('nope');
      expect(noPos.status).toBe(400);
    });
  });

  it('GET 联表返回姓名/职位并按评分降序，支持过滤', async () => {
    const db = openDb(':memory:');
    seed(db);
    const now = '2026-01-01';
    for (const [id, name, score, status] of [
      ['c1', '张三', 80, '已筛'],
      ['c2', '李四', 92, '已筛'],
      ['c3', '王五', null, '待筛'],
    ]) {
      db.prepare(`INSERT INTO resumes (id, name, text, source_file, created_at) VALUES (?, ?, '简历', '', ?)`).run(`r${id}`, name, now);
      db.prepare(
        `INSERT INTO candidates (id, resume_id, position_id, source_url, status, overall_score, grade, created_at, updated_at)
         VALUES (?, ?, 'pos1', ?, ?, ?, 'A', ?, ?)`
      ).run(id, `r${id}`, `https://feishu/hr/${id}`, status, score, now, now);
    }

    await withApp(makeApp(db), async (base) => {
      const all = await fetch(`${base}/api/candidates`);
      const { candidates } = await all.json();
      expect(candidates.map((c) => c.resume_name)).toEqual(['李四', '张三', '王五']);
      expect(candidates[0].position_name).toBe('高级前端');

      const filtered = await fetch(`${base}/api/candidates?position_id=pos1&status=已筛`);
      const f = await filtered.json();
      expect(f.candidates).toHaveLength(2);
    });
  });

  it('PATCH 更新状态与备注，非法状态报 400', async () => {
    const db = openDb(':memory:');
    seed(db);
    db.prepare(`INSERT INTO resumes (id, name, text, source_file, created_at) VALUES ('r1', '张三', '简历', '', '2026-01-01')`).run();
    db.prepare(
      `INSERT INTO candidates (id, resume_id, position_id, source_url, status, created_at, updated_at)
       VALUES ('c1', 'r1', 'pos1', '', '待筛', '2026-01-01', '2026-01-01')`
    ).run();

    await withApp(makeApp(db), async (base) => {
      const ok = await fetch(`${base}/api/candidates/c1`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: '通过', note: '约面' }),
      });
      expect(ok.status).toBe(200);
      const { candidate } = await ok.json();
      expect(candidate.status).toBe('通过');
      expect(candidate.note).toBe('约面');

      const bad = await fetch(`${base}/api/candidates/c1`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: '乱写' }),
      });
      expect(bad.status).toBe(400);

      const missing = await fetch(`${base}/api/candidates/nope`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(missing.status).toBe(404);
    });
  });

});

describe('TaskRunner 候选人回写', () => {
  it('fit 任务完成时把评分/等级/摘要写回候选人，待筛 → 已筛', () => {
    const db = openDb(':memory:');
    seed(db);
    db.prepare(`INSERT INTO resumes (id, name, text, source_file, created_at) VALUES ('r1', '张三', '简历', '', '2026-01-01')`).run();
    db.prepare(
      `INSERT INTO candidates (id, resume_id, position_id, source_url, status, created_at, updated_at)
       VALUES ('c1', 'r1', 'pos1', '', '待筛', '2026-01-01', '2026-01-01')`
    ).run();
    db.prepare(
      `INSERT INTO tasks (id, title, mode, agent_id, resume_id, company_id, status, created_at)
       VALUES ('t1', '筛选：张三', 'fit', 'ag1', 'r1', 'pos1', 'running', '2026-01-01')`
    ).run();

    const runner = new TaskRunner({ db, getSettings: () => ({}) });
    runner.finish('t1', 'done', { overall_score: 88, grade: 'A', summary: '匹配良好，建议面试' }, '');

    const c = db.prepare(`SELECT * FROM candidates WHERE id = 'c1'`).get();
    expect(c).toMatchObject({ overall_score: 88, grade: 'A', summary: '匹配良好，建议面试', status: '已筛' });
  });

  it('人工标记的状态不会被自动覆盖', () => {
    const db = openDb(':memory:');
    seed(db);
    db.prepare(`INSERT INTO resumes (id, name, text, source_file, created_at) VALUES ('r1', '张三', '简历', '', '2026-01-01')`).run();
    db.prepare(
      `INSERT INTO candidates (id, resume_id, position_id, source_url, status, created_at, updated_at)
       VALUES ('c1', 'r1', 'pos1', '', '通过', '2026-01-01', '2026-01-01')`
    ).run();
    db.prepare(
      `INSERT INTO tasks (id, title, mode, agent_id, resume_id, company_id, status, created_at)
       VALUES ('t1', '筛选：张三', 'fit', 'ag1', 'r1', 'pos1', 'running', '2026-01-01')`
    ).run();

    const runner = new TaskRunner({ db, getSettings: () => ({}) });
    runner.finish('t1', 'done', { overall_score: 70, grade: 'B', summary: '一般' }, '');
    expect(db.prepare(`SELECT status FROM candidates WHERE id = 'c1'`).get().status).toBe('通过');
  });

  it('非职位（公司）任务不写回候选人', () => {
    const db = openDb(':memory:');
    seed(db);
    db.prepare(
      `INSERT INTO companies (id, name, industry, stage, url, jd_text, source_file, kind, created_at)
       VALUES ('co1', '某公司', '', '', '', 'JD', '', 'company', '2026-01-01')`
    ).run();
    db.prepare(`INSERT INTO resumes (id, name, text, source_file, created_at) VALUES ('r1', '张三', '简历', '', '2026-01-01')`).run();
    db.prepare(
      `INSERT INTO candidates (id, resume_id, position_id, source_url, status, created_at, updated_at)
       VALUES ('c1', 'r1', 'pos1', '', '待筛', '2026-01-01', '2026-01-01')`
    ).run();
    db.prepare(
      `INSERT INTO tasks (id, title, mode, agent_id, resume_id, company_id, status, created_at)
       VALUES ('t1', '契合度', 'fit', 'ag1', 'r1', 'co1', 'running', '2026-01-01')`
    ).run();

    const runner = new TaskRunner({ db, getSettings: () => ({}) });
    runner.finish('t1', 'done', { overall_score: 90, grade: 'S', summary: '好' }, '');
    const c = db.prepare(`SELECT * FROM candidates WHERE id = 'c1'`).get();
    expect(c.status).toBe('待筛');
    expect(c.overall_score).toBeNull();
  });
});

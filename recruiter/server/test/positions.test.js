import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import { openDb } from '../db.js';
import { positionsRouter } from '../routes/positions.js';

function makeApp(db, fetchDoc) {
  const app = express();
  app.use(express.json());
  app.use('/api/positions', positionsRouter(db, { fetchDoc }));
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

async function post(base, body) {
  return fetch(`${base}/api/positions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('positions（招聘端职位）', () => {
  it('通过飞书文档链接创建职位：本地 lark-cli 读取 JD', async () => {
    const db = openDb(':memory:');
    const fetchDoc = vi.fn().mockResolvedValue('岗位职责：负责数据中台架构设计');
    await withApp(makeApp(db, fetchDoc), async (base) => {
      const res = await post(base, {
        name: '高级前端工程师',
        feishu_doc_url: 'https://xxx.feishu.cn/docx/abc',
      });
      expect(res.status).toBe(201);
      const { position } = await res.json();
      expect(fetchDoc).toHaveBeenCalledWith({ url: 'https://xxx.feishu.cn/docx/abc' });
      expect(position).toMatchObject({
        name: '高级前端工程师',
        kind: 'position',
        url: 'https://xxx.feishu.cn/docx/abc',
        jd_text: '岗位职责：负责数据中台架构设计',
      });
    });
  });

  it('支持直接粘贴 JD 文本创建职位', async () => {
    const db = openDb(':memory:');
    const fetchDoc = vi.fn();
    await withApp(makeApp(db, fetchDoc), async (base) => {
      const res = await post(base, { name: '后端工程师', jd_text: '任职要求：5 年 Go 经验' });
      expect(res.status).toBe(201);
      const { position } = await res.json();
      expect(position.jd_text).toBe('任职要求：5 年 Go 经验');
      expect(fetchDoc).not.toHaveBeenCalled();
    });
  });

  it('lark-cli 读取失败时返回可读错误', async () => {
    const db = openDb(':memory:');
    const fetchDoc = vi.fn().mockRejectedValue(new Error('lark-cli 读取文档失败（exit 1）：无权限'));
    await withApp(makeApp(db, fetchDoc), async (base) => {
      const res = await post(base, { name: '职位', feishu_doc_url: 'https://x.feishu.cn/docx/bad' });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('lark-cli');
    });
  });

  it('缺少职位名或 JD 时报 400', async () => {
    const db = openDb(':memory:');
    await withApp(makeApp(db, vi.fn()), async (base) => {
      const noName = await post(base, { jd_text: 'JD' });
      expect(noName.status).toBe(400);
      const noJd = await post(base, { name: '职位' });
      expect(noJd.status).toBe(400);
      expect((await noJd.json()).error).toContain('JD');
    });
  });

  it('GET 只返回 kind=position 的职位；DELETE 有候选人时拒绝', async () => {
    const db = openDb(':memory:');
    db.prepare(
      `INSERT INTO companies (id, name, industry, stage, url, jd_text, source_file, kind, created_at)
       VALUES ('pos1', '高级前端', '', '', '', 'JD', '', 'position', '2026-01-01')`
    ).run();
    db.prepare(
      `INSERT INTO companies (id, name, industry, stage, url, jd_text, source_file, kind, created_at)
       VALUES ('pos2', '后端工程师', '', '', '', 'JD', '', 'position', '2026-01-01')`
    ).run();
    db.prepare(
      `INSERT INTO companies (id, name, industry, stage, url, jd_text, source_file, kind, created_at)
       VALUES ('co1', '某公司', '', '', '', 'JD', '', 'company', '2026-01-01')`
    ).run();
    db.prepare(
      `INSERT INTO resumes (id, name, text, source_file, created_at)
       VALUES ('r1', '张三', '简历', '', '2026-01-01')`
    ).run();
    db.prepare(
      `INSERT INTO candidates (id, resume_id, position_id, source_url, status, created_at, updated_at)
       VALUES ('c1', 'r1', 'pos1', '', '待筛', '2026-01-01', '2026-01-01')`
    ).run();

    await withApp(makeApp(db, vi.fn()), async (base) => {
      const list = await fetch(`${base}/api/positions`);
      const { positions } = await list.json();
      expect(positions.map((p) => p.id)).toEqual(['pos1', 'pos2']);

      const blocked = await fetch(`${base}/api/positions/pos1`, { method: 'DELETE' });
      expect(blocked.status).toBe(400);
      expect((await blocked.json()).error).toContain('候选人');

      // 无候选人的职位可删除（kind=company 的公司不可经此接口删除）
      const ok = await fetch(`${base}/api/positions/pos2`, { method: 'DELETE' });
      expect(ok.status).toBe(200);
      const company404 = await fetch(`${base}/api/positions/co1`, { method: 'DELETE' });
      expect(company404.status).toBe(404);
      const after = await fetch(`${base}/api/positions`);
      expect((await after.json()).positions).toHaveLength(1);
    });
  });
});

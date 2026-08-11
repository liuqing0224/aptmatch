import { describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { importCrawlItems } from '../routes/crawl.js';

function insertResume(db, id, name = '张三') {
  db.prepare(
    `INSERT INTO resumes (id, name, text, source_file, created_at) VALUES (?, ?, ?, '', ?)`
  ).run(id, name, `${name}的简历`, '2026-01-01');
}

function companyCount(db) {
  return db.prepare(`SELECT COUNT(*) AS n FROM companies`).get().n;
}

function companiesByUrl(db, url) {
  return db.prepare(`SELECT * FROM companies WHERE source_url = ?`).all(url);
}

function item(overrides = {}) {
  return {
    company_name: '示例科技',
    position_title: '前端工程师',
    source_url: 'https://example.com/job/1',
    jd_text: 'JD 内容',
    industry: '互联网',
    stage: 'C轮',
    company_url: 'https://example.com',
    ...overrides,
  };
}

describe('importCrawlItems', () => {
  it('带 source_url 首次导入计入 imported，再次导入计入 skipped 且不新增行', () => {
    const db = openDb(':memory:');
    const first = importCrawlItems(db, [item()]);
    expect(first.imported).toHaveLength(1);
    expect(first.skipped).toBe(0);
    expect(companyCount(db)).toBe(1);
    expect(companiesByUrl(db, 'https://example.com/job/1')[0].source_url).toBe('https://example.com/job/1');

    const second = importCrawlItems(db, [item({ jd_text: '覆盖的 JD' })]);
    expect(second.imported).toHaveLength(0);
    expect(second.skipped).toBe(1);
    expect(companyCount(db)).toBe(1);
    // 不覆盖已有 JD
    expect(companiesByUrl(db, 'https://example.com/job/1')[0].jd_text).toBe('JD 内容');
  });

  it('同一批次内相同 source_url 只导入一次', () => {
    const db = openDb(':memory:');
    const r = importCrawlItems(db, [item(), item()]);
    expect(r.imported).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(companyCount(db)).toBe(1);
  });

  it('无 source_url 时按 companies.name 去重', () => {
    const db = openDb(':memory:');
    const a = item({ source_url: '' });
    const b = item({ source_url: '' });
    const r = importCrawlItems(db, [a, b]);
    expect(r.imported).toHaveLength(2);
    expect(r.skipped).toBe(0);
    expect(companyCount(db)).toBe(1);

    const again = importCrawlItems(db, [item({ source_url: '' })]);
    expect(again.imported).toHaveLength(1);
    expect(again.skipped).toBe(0);
    expect(companyCount(db)).toBe(1);
  });

  it('同一公司不同岗位拆 name，避免 JD 互相覆盖', () => {
    const db = openDb(':memory:');
    const a = item({ source_url: 'https://example.com/job/a' });
    const b = item({
      company_name: '示例科技',
      position_title: '后端工程师',
      source_url: 'https://example.com/job/b',
    });
    const r = importCrawlItems(db, [a, b]);
    expect(r.imported).toHaveLength(2);
    expect(companyCount(db)).toBe(2);
    const names = db.prepare(`SELECT name FROM companies ORDER BY name`).all().map((c) => c.name);
    expect(names).toContain('示例科技');
    expect(names).toContain('示例科技 · 后端工程师');
  });

  it('auto_dispatch 为 true 时生成 fit 任务', () => {
    const db = openDb(':memory:');
    insertResume(db, 'r1');
    const r = importCrawlItems(db, [item()], {
      resume_id: 'r1',
      auto_dispatch: true,
    });
    expect(r.dispatched).toHaveLength(1);
    const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(r.dispatched[0]);
    expect(task.mode).toBe('fit');
    expect(task.resume_id).toBe('r1');
    expect(task.company_id).toBe(r.imported[0].id);
    expect(task.status).toBe('queued');

    // 重复来源不派发
    const dup = importCrawlItems(db, [item()], { resume_id: 'r1', auto_dispatch: true });
    expect(dup.imported).toHaveLength(0);
    expect(dup.skipped).toBe(1);
    expect(dup.dispatched).toHaveLength(0);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM tasks`).get().n).toBe(1);
  });

  it('auto_dispatch 为 false 时不生成任务', () => {
    const db = openDb(':memory:');
    insertResume(db, 'r1');
    const r = importCrawlItems(db, [item()], { resume_id: 'r1', auto_dispatch: false });
    expect(r.dispatched).toHaveLength(0);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM tasks`).get().n).toBe(0);
  });
});

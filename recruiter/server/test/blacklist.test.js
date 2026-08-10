import { describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import {
  checkCompany,
  listEntries,
  parseBlacklistMd,
  syncAll,
  syncSource,
} from '../lib/blacklist.js';

const FIXTURE = `### 北京
| 企业名称 | 所在行业 | 所在城市 | 详细地址 | 存在问题 | 详细描述 |
| :----- | :------ | :------ | :------ | :----- | :------ |
北京示例科技有限公司|互联网|北京市,市辖区|中关村大街1号|拖欠工资|拖欠工资 3 个月，社保断缴
上海另一家科技有限公司 | 金融 | 上海市,市辖区 | 张江 | 996 | 强制 996 无加班费
| 带管道开头的公司 | 教育 | 北京市,市辖区 | 海淀 | 试用期裁员 | 试用期结束直接裁员 |

> 非表格引用行
这里没有管道，不是表格
`;

describe('parseBlacklistMd', () => {
  it('兼容无前导管道与带前导管道的行，跳过表头/分隔行', () => {
    const entries = parseBlacklistMd(FIXTURE);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      company_name: '北京示例科技有限公司',
      industry: '互联网',
      city: '北京市,市辖区',
      address: '中关村大街1号',
      issue: '拖欠工资',
      detail: '拖欠工资 3 个月，社保断缴',
    });
    expect(entries[1].company_name).toBe('上海另一家科技有限公司');
    expect(entries[2].company_name).toBe('带管道开头的公司');
  });

  it('空输入返回空数组', () => {
    expect(parseBlacklistMd('')).toEqual([]);
    expect(parseBlacklistMd(null)).toEqual([]);
  });

  it('单元格内管道符保留在 detail 中', () => {
    const md = '| 企业名称 | 所在行业 | 所在城市 | 详细地址 | 存在问题 | 详细描述 |\n| :- | :- | :- | :- | :- | :- |\n甲|乙|丙|丁|戊|第一段|第二段';
    const [e] = parseBlacklistMd(md);
    expect(e.detail).toBe('第一段|第二段');
  });
});

describe('checkCompany', () => {
  it('精确命中与后缀归一化模糊命中', () => {
    const db = openDb(':memory:');
    db.prepare(
      `INSERT INTO blacklist_sources (id, name, owner, repo, branch, enabled, created_at, updated_at)
       VALUES ('s1', '测试源', 'owner', 'repo', 'master', 1, '2026-01-01', '2026-01-01')`
    ).run();
    db.prepare(
      `INSERT INTO blacklist_entries (id, source_id, company_name, industry, city, address, issue, detail, source_url, added_at)
       VALUES ('e1', 's1', '北京天拓四方科技有限公司', '制造业', '北京市', 'xx', '合同陷阱', '详情', '', '2026-01-01')`
    ).run();

    const exact = checkCompany(db, '北京天拓四方科技有限公司');
    expect(exact[0]).toMatchObject({ company_name: '北京天拓四方科技有限公司', match_score: 100 });

    const fuzzy = checkCompany(db, '天拓四方');
    expect(fuzzy[0].match_score).toBeGreaterThanOrEqual(60);

    const miss = checkCompany(db, '宇宙第一公司');
    expect(miss).toEqual([]);
  });

  it('停用来源不参与匹配', () => {
    const db = openDb(':memory:');
    db.prepare(
      `INSERT INTO blacklist_sources (id, name, owner, repo, branch, enabled, created_at, updated_at)
       VALUES ('s1', '测试源', 'owner', 'repo', 'master', 0, '2026-01-01', '2026-01-01')`
    ).run();
    db.prepare(
      `INSERT INTO blacklist_entries (id, source_id, company_name, industry, city, address, issue, detail, source_url, added_at)
       VALUES ('e1', 's1', '停用公司', '互联网', '北京市', '', '问题', '详情', '', '2026-01-01')`
    ).run();
    expect(checkCompany(db, '停用公司')).toEqual([]);
  });
});

function mockFetcher(files) {
  return {
    name: 'mock',
    tree: async (_o, _r, _b) => Object.keys(files),
    file: async (_o, _r, path) => files[path],
  };
}

describe('syncSource / syncAll', () => {
  it('拉取 md 解析并幂等 upsert', async () => {
    const db = openDb(':memory:');
    db.prepare(
      `INSERT INTO blacklist_sources (id, name, owner, repo, branch, enabled, created_at, updated_at)
       VALUES ('s1', '测试源', 'owner', 'repo', 'master', 1, '2026-01-01', '2026-01-01')`
    ).run();

    const fetcher = mockFetcher({
      'Beijing.md': FIXTURE,
      'README.md': '# README 无表格',
      '.github/secret.md': '不应被解析',
    });

    const r1 = await syncSource(db, { ...rowById(db, 's1') }, fetcher);
    expect(r1.added).toBe(3);
    expect(r1.skipped).toBe(0);
    expect(listEntries(db, {})).toHaveLength(3);

    const r2 = await syncSource(db, { ...rowById(db, 's1') }, fetcher);
    expect(r2.added).toBe(0);
    expect(r2.updated).toBe(3);
    expect(listEntries(db, {})).toHaveLength(3);

    const src = rowById(db, 's1');
    expect(src.entry_count).toBe(3);
    expect(src.last_synced_at).toBeTruthy();
    expect(src.last_error).toBe('');
  });

  it('文件读取失败计为 skipped 且不报错', async () => {
    const db = openDb(':memory:');
    db.prepare(
      `INSERT INTO blacklist_sources (id, name, owner, repo, branch, enabled, created_at, updated_at)
       VALUES ('s1', '测试源', 'owner', 'repo', 'master', 1, '2026-01-01', '2026-01-01')`
    ).run();
    const fetcher = {
      name: 'mock',
      tree: async () => ['Beijing.md'],
      file: async () => {
        throw new Error('boom');
      },
    };
    const r = await syncSource(db, { ...rowById(db, 's1') }, fetcher);
    expect(r.skipped).toBe(1);
    expect(r.error).toBe('');
    expect(listEntries(db, {})).toHaveLength(0);
    // 部分文件失败时在来源上留下「可能不完整」提示
    expect(rowById(db, 's1').last_error).toContain('文件读取失败');
  });

  it('仓库读取失败记录 last_error 不抛异常', async () => {
    const db = openDb(':memory:');
    db.prepare(
      `INSERT INTO blacklist_sources (id, name, owner, repo, branch, enabled, created_at, updated_at)
       VALUES ('s1', '测试源', 'owner', 'repo', 'master', 1, '2026-01-01', '2026-01-01')`
    ).run();
    const fetcher = {
      name: 'mock',
      tree: async () => {
        throw new Error('rate limited');
      },
      file: async () => '',
    };
    const r = await syncSource(db, { ...rowById(db, 's1') }, fetcher);
    expect(r.error).toContain('rate limited');
    expect(rowById(db, 's1').last_error).toContain('rate limited');
  });

  it('syncAll 只同步启用来源', async () => {
    const db = openDb(':memory:');
    const ins = db.prepare(
      `INSERT INTO blacklist_sources (id, name, owner, repo, branch, enabled, created_at, updated_at)
       VALUES (?, '源', 'owner', 'repo', 'master', ?, '2026-01-01', '2026-01-01')`
    );
    ins.run('s1', 1);
    ins.run('s2', 0);
    const fetcher = mockFetcher({ 'Beijing.md': FIXTURE });
    const results = await syncAll(db, { fetcher });
    expect(results).toHaveLength(1);
    expect(results[0].sourceId).toBe('s1');
  });
});

function rowById(db, id) {
  return db.prepare(`SELECT * FROM blacklist_sources WHERE id = ?`).get(id);
}

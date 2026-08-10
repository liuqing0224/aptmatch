import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { nowIso } from '../db.js';

const execFileAsync = promisify(execFile);
const GH_TIMEOUT = 20_000;
const FETCH_TIMEOUT = 20_000;
const GITHUB_API = 'https://api.github.com';

const FALLBACK_BRANCHES = ['master', 'main'];

/** 解析 GitHub 仓库 Markdown 里的黑名单表格，兼容「| a | b |」与「a|b|c」两种行格式。 */
export function parseBlacklistMd(markdown, { sourceUrl = '' } = {}) {
  const entries = [];
  const lines = String(markdown ?? '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('![')) continue;
    if (!trimmed.includes('|')) continue;
    let body = trimmed;
    if (body.startsWith('|')) body = body.slice(1);
    if (body.endsWith('|')) body = body.slice(0, -1);
    const cells = body.split('|').map((c) => c.trim());
    // 表头 / 分隔行
    if (cells.includes('企业名称')) continue;
    if (cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (cells.length < 6) continue;
    const [company_name, industry, city, address, issue, ...rest] = cells;
    const detail = rest.join('|').trim();
    if (!company_name) continue;
    entries.push({
      company_name,
      industry: industry ?? '',
      city: city ?? '',
      address: address ?? '',
      issue: issue ?? '',
      detail,
      source_url: sourceUrl,
    });
  }
  return entries;
}

/** 通过 gh CLI 拉取 GitHub API（已登录时有较高限额）。 */
export function createGhFetcher({ bin = 'gh', timeout = GH_TIMEOUT } = {}) {
  async function run(args) {
    const { stdout } = await execFileAsync(bin, args, { timeout, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  }
  return {
    name: 'gh',
    async tree(owner, repo, branch) {
      const out = await run([
        'api',
        `repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
        '--jq',
        '.tree[] | select(.type == "blob") | .path',
      ]);
      return out.split('\n').map((p) => p.trim()).filter(Boolean);
    },
    async file(owner, repo, path, branch) {
      const out = await run([
        'api',
        `repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
        '--jq',
        '.content',
      ]);
      return Buffer.from(out.replace(/\s+/g, ''), 'base64').toString('utf-8');
    },
  };
}

/** 匿名 HTTP 方式拉取 GitHub API（限额较低，作为兜底）。 */
export function createHttpFetcher({ base = GITHUB_API, timeout = FETCH_TIMEOUT } = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'AptMatch-local' };
  async function getJson(url) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`GitHub API ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
    }
    return res.json();
  }
  return {
    name: 'http',
    async tree(owner, repo, branch) {
      const data = await getJson(`${base}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
      const paths = Array.isArray(data.tree) ? data.tree : [];
      return paths.filter((t) => t.type === 'blob').map((t) => t.path);
    },
    async file(owner, repo, path, branch) {
      const data = await getJson(
        `${base}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`
      );
      if (typeof data.content === 'string') {
        return Buffer.from(data.content.replace(/\s+/g, ''), 'base64').toString('utf-8');
      }
      if (typeof data.download_url === 'string') {
        const res = await fetch(data.download_url, { signal: AbortSignal.timeout(timeout) });
        if (!res.ok) throw new Error(`下载失败 ${res.status}`);
        return res.text();
      }
      throw new Error('无法读取文件内容');
    },
  };
}

/** 依次尝试 gh CLI → 匿名 HTTP，返回可用的 fetcher。 */
export async function createFetcher() {
  try {
    const gh = createGhFetcher();
    await gh.tree('octocat', 'Hello-World', 'master');
    return gh;
  } catch {
    return createHttpFetcher();
  }
}

function normalizeCompanyName(name) {
  let s = String(name ?? '')
    .toLowerCase()
    .replace(/[\s\u3000（）()【】\[\]·,，。、]/g, '')
    .replace(/(?:（[^）]*）|\([^)]*\))$/g, '');
  // 迭代剥离常见企业后缀（有限公司/科技/信息…）
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/(?:有限|股份|责任|集团|控股|发展|投资|科技|技术|信息|网络|软件|数据|智能|电子|实业)?公司$/g, '');
    if (next === s) break;
    s = next;
  }
  return s;
}

/** 模糊匹配：先精确，再做去后缀后的包含匹配，按相似度排序。 */
export function checkCompany(db, companyName, { limit = 8 } = {}) {
  const raw = String(companyName ?? '').trim();
  if (!raw) return [];
  const norm = normalizeCompanyName(raw);
  const rows = db
    .prepare(
      `SELECT e.*, s.name AS source_name, s.owner, s.repo, s.branch
       FROM blacklist_entries e JOIN blacklist_sources s ON s.id = e.source_id
       WHERE s.enabled = 1`
    )
    .all();
  const scored = [];
  for (const row of rows) {
    const rowNorm = normalizeCompanyName(row.company_name);
    if (!rowNorm) continue;
    let score = 0;
    if (row.company_name === raw || rowNorm === norm) score = 100;
    else if (rowNorm.includes(norm) || norm.includes(rowNorm)) {
      const short = Math.min(rowNorm.length, norm.length);
      const long = Math.max(rowNorm.length, norm.length);
      score = Math.round(40 + (short / long) * 55);
      score = Math.max(60, Math.min(95, score));
    }
    if (score >= 60) scored.push({ ...row, match_score: score });
  }
  return scored.sort((a, b) => b.match_score - a.match_score).slice(0, limit);
}

/** 读取仓库 md 文件列表（带默认分支回退）。 */
async function resolveTree(fetcher, owner, repo, branch) {
  const tries = [...new Set([branch, ...FALLBACK_BRANCHES])].filter(Boolean);
  let lastErr = null;
  for (const b of tries) {
    try {
      const files = await fetcher.tree(owner, repo, b);
      if (files) return { files, branch: b };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`无法读取仓库 ${owner}/${repo} 文件列表`);
}

/** 同步单个来源仓库的 md 文件到库（幂等 upsert）。 */
export async function syncSource(db, source, fetcher) {
  const result = {
    sourceId: source.id,
    name: source.name,
    branch: source.branch,
    added: 0,
    updated: 0,
    skipped: 0,
    error: '',
  };
  try {
    const f = fetcher ?? (await createFetcher());
    const { files, branch } = await resolveTree(f, source.owner, source.repo, source.branch);
    result.branch = branch;
    const mdFiles = files.filter((p) => /\.md$/i.test(p) && !/^\./i.test(p));
    const upsert = db.prepare(
      `INSERT INTO blacklist_entries
         (id, source_id, company_name, industry, city, address, issue, detail, source_url, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, company_name, city) DO UPDATE SET
         industry = excluded.industry,
         address = excluded.address,
         issue = excluded.issue,
         detail = excluded.detail,
         source_url = excluded.source_url`
    );
    const findExisting = db.prepare(
      `SELECT id FROM blacklist_entries WHERE source_id = ? AND company_name = ? AND city = ?`
    );
    const sourceAlive = db.prepare(`SELECT 1 AS x FROM blacklist_sources WHERE id = ?`);
    for (let i = 0; i < mdFiles.length; i++) {
      const path = mdFiles[i];
      if (!sourceAlive.get(source.id)) {
        // 来源被删除：放弃剩余文件，避免产生孤儿数据
        result.skipped += mdFiles.length - i;
        break;
      }
      let text;
      try {
        text = await f.file(source.owner, source.repo, path, branch);
      } catch {
        result.skipped += 1;
        continue;
      }
      const sourceUrl = `https://github.com/${source.owner}/${source.repo}/blob/${branch}/${path}`;
      const entries = parseBlacklistMd(text, { sourceUrl });
      const now = nowIso();
      for (const e of entries) {
        const existing = findExisting.get(source.id, e.company_name, e.city);
        if (existing) {
          upsert.run(
            existing.id,
            source.id,
            e.company_name,
            e.industry,
            e.city,
            e.address,
            e.issue,
            e.detail,
            sourceUrl,
            now
          );
          result.updated += 1;
        } else {
          upsert.run(
            randomUUID(),
            source.id,
            e.company_name,
            e.industry,
            e.city,
            e.address,
            e.issue,
            e.detail,
            sourceUrl,
            now
          );
          result.added += 1;
        }
      }
    }
    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM blacklist_entries WHERE source_id = ?`)
      .get(source.id).n;
    const warn = result.skipped > 0 ? `${result.skipped} 个文件读取失败，榜单可能不完整` : '';
    db.prepare(
      `UPDATE blacklist_sources SET last_synced_at = ?, last_error = ?, entry_count = ?, branch = ?, updated_at = ? WHERE id = ?`
    ).run(nowIso(), warn, count, branch, nowIso(), source.id);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    db.prepare(`UPDATE blacklist_sources SET last_error = ?, updated_at = ? WHERE id = ?`).run(
      result.error.slice(0, 500),
      nowIso(),
      source.id
    );
  }
  return result;
}

/** 同步全部启用的来源。 */
export async function syncAll(db, { fetcher } = {}) {
  const sources = db.prepare(`SELECT * FROM blacklist_sources WHERE enabled = 1`).all();
  const f = fetcher ?? (await createFetcher());
  const results = [];
  for (const s of sources) {
    results.push(await syncSource(db, s, f));
  }
  return results;
}

export function listEntries(db, { q = '', city = '', limit = 500 } = {}) {
  const conds = [];
  const params = [];
  if (q) {
    conds.push('(e.company_name LIKE ? OR e.issue LIKE ? OR e.detail LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (city) {
    conds.push('e.city LIKE ?');
    params.push(`%${city}%`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT e.*, s.name AS source_name, s.owner, s.repo, s.branch
       FROM blacklist_entries e JOIN blacklist_sources s ON s.id = e.source_id
       ${where} ORDER BY e.added_at DESC, e.company_name LIMIT ?`
    )
    .all(...params, Number(limit) || 500);
  return rows;
}

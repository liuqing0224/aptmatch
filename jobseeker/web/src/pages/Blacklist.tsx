import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { BlacklistEntry, BlacklistSource } from '../types';

function fmtTime(iso: string | null) {
  if (!iso) return '从未同步';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '从未同步';
  return d.toLocaleString('zh-CN', { hour12: false });
}

export default function Blacklist() {
  const [sources, setSources] = useState<BlacklistSource[]>([]);
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [syncing, setSyncing] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ owner: '', repo: '', name: '', branch: 'master' });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (opts?: { q?: string; city?: string }) => {
    try {
      const data = await api.blacklist.overview({
        q: opts?.q ?? undefined,
        city: opts?.city ?? undefined,
      });
      setSources(data.sources);
      setEntries(data.entries);
      setTotal(data.total);
      setSyncing(data.syncing);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (syncing.length === 0) return;
    timerRef.current = setInterval(async () => {
      try {
        const data = await api.blacklist.overview();
        setSources(data.sources);
        setEntries(data.entries);
        setTotal(data.total);
        setSyncing(data.syncing);
        if (data.syncing.length === 0 && timerRef.current) clearInterval(timerRef.current);
      } catch {
        /* 轮询失败忽略 */
      }
    }, 3000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [syncing.length > 0]);

  async function runSync(sourceId?: string) {
    setError('');
    try {
      const res = await api.blacklist.sync(sourceId);
      setSyncing(res.syncing);
      setNotice(
        res.started > 0
          ? `已开始同步 ${res.started} 个来源，完成后自动刷新…`
          : '没有需要同步的来源'
      );
      setTimeout(() => setNotice(''), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function toggleSource(s: BlacklistSource) {
    try {
      await api.blacklist.updateSource(s.id, { enabled: !s.enabled });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeSource(s: BlacklistSource) {
    if (!window.confirm(`删除来源「${s.name}」？其 ${s.entry_count} 条记录也会一并删除。`)) return;
    try {
      await api.blacklist.removeSource(s.id);
      setNotice('已删除来源');
      setTimeout(() => setNotice(''), 2000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function addSource() {
    if (!form.owner.trim() || !form.repo.trim()) {
      setError('owner 和 repo 必填');
      return;
    }
    setError('');
    try {
      await api.blacklist.addSource({
        owner: form.owner.trim(),
        repo: form.repo.trim(),
        name: form.name.trim() || undefined,
        branch: form.branch.trim() || 'master',
      });
      setForm({ owner: '', repo: '', name: '', branch: 'master' });
      setNotice('已添加来源，可点击「同步」拉取榜单');
      setTimeout(() => setNotice(''), 3000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function search() {
    await load({ q, city });
  }

  const syncingNow = syncing.length > 0;
  const lastSync = sources
    .map((s) => s.last_synced_at)
    .filter(Boolean)
    .sort()
    .pop() as string | null | undefined;

  return (
    <div>
      <div className="page-head">
        <h1>企业黑名单</h1>
        <div className="page-actions">
          <button className="btn btn-primary" disabled={syncingNow} onClick={() => runSync()}>
            {syncingNow ? '同步中…' : '同步全部来源'}
          </button>
        </div>
      </div>

      <div className="alert alert-error" style={{ marginBottom: 16 }}>
        <strong>⚠️ 求职警示：</strong>
        以下企业名单由 GitHub 社区仓库维护，内容来自网友提交，可能存在误报、情绪化或过时信息。
        请仅作面试前的背景参考，务必结合官方信息与当面沟通独立判断。
      </div>

      {notice && <div className="alert alert-ok">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="stat-row">
          <div className="stat">
            <strong>{total}</strong>
            <span>条黑名单记录</span>
          </div>
          <div className="stat">
            <strong>{sources.length}</strong>
            <span>数据来源</span>
          </div>
          <div className="stat">
            <strong>{lastSync ? fmtTime(lastSync) : '—'}</strong>
            <span>最近同步</span>
          </div>
        </div>

        <div className="filter-row">
          <input
            placeholder="搜索公司名 / 问题关键词…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
          <input
            placeholder="城市（如：北京 / 上海 / 杭州）"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
          <button className="btn" onClick={search}>搜索</button>
          <button
            className="btn"
            onClick={() => {
              setQ('');
              setCity('');
              load();
            }}
          >
            重置
          </button>
        </div>
      </div>

      <div className="card">
        <h2>数据来源</h2>
        {sources.length === 0 && <p className="hint">暂无来源，请在下方添加 GitHub 仓库。</p>}
        {sources.map((s) => (
          <div className="blk-source" key={s.id}>
            <div className="blk-source-main">
              <a
                href={`https://github.com/${s.owner}/${s.repo}`}
                target="_blank"
                rel="noreferrer"
                className="blk-source-name"
              >
                {s.name}
              </a>
              <span className="hint">
                {s.owner}/{s.repo} · {s.entry_count} 条 · 上次同步 {fmtTime(s.last_synced_at)}
              </span>
              {s.last_error && <span className="severity severity-high">同步失败：{s.last_error}</span>}
            </div>
            <div className="blk-source-actions">
              <button
                className="btn"
                disabled={syncing.includes(s.id)}
                onClick={() => runSync(s.id)}
              >
                {syncing.includes(s.id) ? '同步中…' : '同步'}
              </button>
              <button className="btn" onClick={() => toggleSource(s)}>
                {s.enabled ? '停用' : '启用'}
              </button>
              <button className="btn btn-danger" onClick={() => removeSource(s)}>删除</button>
            </div>
          </div>
        ))}

        <div className="blk-add form" style={{ marginTop: 12 }}>
          <div className="form-row">
            <label>
              <span>owner（组织/用户名）</span>
              <input
                placeholder="如 it-job-blacklist"
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
              />
            </label>
            <label>
              <span>repo（仓库名）</span>
              <input
                placeholder="如 996ICU.job.blacklist_company"
                value={form.repo}
                onChange={(e) => setForm({ ...form, repo: e.target.value })}
              />
            </label>
            <label>
              <span>分支</span>
              <input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
            </label>
            <label>
              <span>显示名称（可选）</span>
              <input
                placeholder="默认 owner/repo"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
          </div>
          <button className="btn btn-primary" onClick={addSource}>添加来源</button>
        </div>
      </div>

      <div className="card">
        <div className="blk-list-head">
          <h2>榜单记录</h2>
          <span className="hint">{entries.length} 条（显示上限 500）</span>
        </div>
        {entries.length === 0 && (
          <p className="hint">暂无记录。请先点击「同步全部来源」从 GitHub 拉取榜单。</p>
        )}
        {entries.map((e) => {
          const isOpen = expanded.has(e.id);
          return (
            <div className="blk-entry" key={e.id}>
              <div className="blk-entry-head">
                <strong className="blk-company">{e.company_name}</strong>
                {e.issue && <span className="chip chip-warn">{e.issue.slice(0, 24)}</span>}
                {e.city && <span className="hint">{e.city}</span>}
              </div>
              <div className="hint">
                {[e.industry, e.address].filter(Boolean).join(' · ') || '行业/地址不详'}
              </div>
              {e.detail && (
                <p className={isOpen ? '' : 'blk-detail-clamp'}>{e.detail}</p>
              )}
              <div className="blk-entry-foot">
                <button className="btn btn-sm" onClick={() => {
                  const next = new Set(expanded);
                  if (isOpen) next.delete(e.id);
                  else next.add(e.id);
                  setExpanded(next);
                }}>
                  {isOpen ? '收起' : e.detail ? '展开详情' : '详情'}
                </button>
                {e.source_url && (
                  <a href={e.source_url} target="_blank" rel="noreferrer" className="hint">
                    来源：{e.source_name} ↗
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

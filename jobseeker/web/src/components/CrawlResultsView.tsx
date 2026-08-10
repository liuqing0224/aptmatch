import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useResourceStore } from '../store';
import type { CrawlResults, PrescreenRow } from '../types';

type Filters = { minK: number | ''; maxK: number | ''; city: string; minScore: number | '' };

export default function CrawlResultsView({
  taskId,
  results,
  defaultResumeId,
  defaultAgentId,
}: {
  taskId: string;
  results: CrawlResults;
  defaultResumeId?: string;
  defaultAgentId?: string;
}) {
  const navigate = useNavigate();
  const resumes = useResourceStore((s) => s.resumes);
  const agents = useResourceStore((s) => s.agents);
  const ensureLoaded = useResourceStore((s) => s.ensureLoaded);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(results.results.map((_, i) => i))
  );
  const [resumeId, setResumeId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [filters, setFilters] = useState<Filters>({ minK: '', maxK: '', city: '', minScore: '' });
  const [prescreen, setPrescreen] = useState<PrescreenRow[] | null>(null);
  const [prescreenError, setPrescreenError] = useState('');

  useEffect(() => {
    let cancelled = false;
    ensureLoaded(['resumes', 'agents']).then(() => {
      if (cancelled) return;
      const { resumes: r, agents: a } = useResourceStore.getState();
      const resumeMatch = r.find((x) => x.id === defaultResumeId);
      setResumeId(resumeMatch ? resumeMatch.id : r.length > 0 ? r[0].id : '');
      const agentMatch = a.find((x) => x.id === defaultAgentId);
      setAgentId(agentMatch ? agentMatch.id : a.length > 0 ? a[0].id : '');
    });
    return () => {
      cancelled = true;
    };
  }, [defaultResumeId, defaultAgentId, ensureLoaded]);

  useEffect(() => {
    if (!resumeId) return;
    setPrescreen(null);
    setPrescreenError('');
    api.crawl
      .prescreen(taskId, { resume_id: resumeId })
      .then(setPrescreen)
      .catch((e) => setPrescreenError(e instanceof Error ? e.message : String(e)));
  }, [taskId, resumeId]);

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === results.results.length) setSelected(new Set());
    else setSelected(new Set(results.results.map((_, i) => i)));
  }

  function applyFilters() {
    if (!prescreen) return;
    setPrescreenError('');
    api.crawl
      .prescreen(taskId, {
        resume_id: resumeId || undefined,
        filters: {
          minK: filters.minK,
          maxK: filters.maxK,
          city: filters.city,
          minScore: filters.minScore,
        },
      })
      .then((rows) => {
        setPrescreen(rows);
        const pass = rows.filter((r) => r.passed).map((r) => r.index);
        setSelected(new Set(pass));
      })
      .catch((e) => setPrescreenError(e instanceof Error ? e.message : String(e)));
  }

  function clearFilters() {
    setFilters({ minK: '', maxK: '', city: '', minScore: '' });
    if (resumeId) {
      api.crawl
        .prescreen(taskId, { resume_id: resumeId })
        .then(setPrescreen)
        .catch((e) => setPrescreenError(e instanceof Error ? e.message : String(e)));
    }
  }

  function selectPassed() {
    if (!prescreen) return;
    setSelected(new Set(prescreen.filter((r) => r.passed).map((r) => r.index)));
  }

  async function doImport() {
    if (selected.size === 0) {
      setError('请至少勾选一个结果');
      return;
    }
    setImporting(true);
    setError('');
    setMessage('');
    try {
      const r = await api.crawl.import(taskId, {
        resume_id: resumeId || undefined,
        agent_id: agentId || undefined,
        indices: [...selected].sort((a, b) => a - b),
        auto_dispatch: true,
      });
      setMessage(`${r.message}。已跳转到看板查看运行进度。`);
      setTimeout(() => navigate('/board'), 1500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setImporting(false);
    }
  }

  const scoreOf = (i: number) => prescreen?.[i]?.score ?? null;
  const salaryOf = (i: number) => prescreen?.[i]?.salary ?? null;
  const passedOf = (i: number) => prescreen?.[i]?.passed ?? null;

  return (
    <div className="card">
      <div className="crawl-head">
        <h2>采集结果：{results.keyword}（{results.city}）共 {results.results.length} 条</h2>
        <p className="hint">勾选需要导入的岗位，然后选择简历与 agent，一键入库并批量派发契合度分析。</p>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-ok">{message}</div>}

      <div className="prescreen-bar">
        <strong className="hint">预筛：</strong>
        <label>
          <span>最低薪资 K</span>
          <input
            type="number"
            min="0"
            value={filters.minK}
            onChange={(e) => setFilters({ ...filters, minK: e.target.value === '' ? '' : Number(e.target.value) })}
          />
        </label>
        <label>
          <span>最高薪资 K</span>
          <input
            type="number"
            min="0"
            value={filters.maxK}
            onChange={(e) => setFilters({ ...filters, maxK: e.target.value === '' ? '' : Number(e.target.value) })}
          />
        </label>
        <label>
          <span>城市/地区</span>
          <input
            value={filters.city}
            placeholder="北京/上海"
            onChange={(e) => setFilters({ ...filters, city: e.target.value })}
          />
        </label>
        <label>
          <span>最低匹配分</span>
          <input
            type="number"
            min="0"
            max="100"
            value={filters.minScore}
            onChange={(e) => setFilters({ ...filters, minScore: e.target.value === '' ? '' : Number(e.target.value) })}
          />
        </label>
        <button className="btn" onClick={applyFilters} disabled={!resumeId}>应用预筛</button>
        <button className="btn" onClick={clearFilters}>清除</button>
        <button className="btn" onClick={selectPassed} disabled={!prescreen}>全选通过预筛</button>
        {prescreenError && <span className="alert alert-error" style={{ display: 'inline' }}>{prescreenError}</span>}
      </div>

      <div className="crawl-toolbar row">
        <label className="checkbox">
          <input type="checkbox" checked={selected.size === results.results.length} onChange={toggleAll} />
          全选
        </label>
        <label>
          <span>匹配简历</span>
          <select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
            <option value="">选择简历…</option>
            {resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label>
          <span>分析 Agent</span>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}（{a.provider}）</option>)}
          </select>
        </label>
        <button className="btn btn-primary" disabled={importing} onClick={doImport}>
          {importing ? '导入派发中…' : `导入 ${selected.size} 条并派发匹配`}
        </button>
      </div>

      <div className="crawl-list">
        {results.results.map((it, i) => {
          const score = scoreOf(i);
          const salary = salaryOf(i);
          const passed = passedOf(i);
          return (
            <div
              className={`crawl-item${selected.has(i) ? ' selected' : ''}${prescreen && !passed ? ' faded' : ''}`}
              key={i}
            >
              <label className="checkbox">
                <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
              </label>
              <div className="crawl-item-body">
                <div className="crawl-item-title">
                  <strong>{it.position_title || it.company_name}</strong>
                  {salary ? (
                    <span className="tag tag-salary">{salary.minK != null ? `${salary.minK}-${salary.maxK ?? '∞'}K` : (it.salary || '面议')}</span>
                  ) : (
                    it.salary && <span className="tag tag-salary">{it.salary}</span>
                  )}
                  {score != null && (
                    <span className={`tag tag-score${score >= 60 ? ' ok' : score >= 40 ? ' mid' : ' low'}`}>
                      匹配 {score}
                    </span>
                  )}
                  {it.location && <span className="tag">{it.location}</span>}
                  {it.stage && <span className="tag">{it.stage}</span>}
                </div>
                <div className="muted">
                  {it.company_name}
                  {it.industry ? ` · ${it.industry}` : ''}
                  {it.source ? ` · 来源：${it.source}` : ''}
                  {it.source_url && (
                    <>
                      {' · '}
                      <a href={it.source_url} target="_blank" rel="noreferrer">原始链接</a>
                    </>
                  )}
                  {it.company_url && (
                    <>
                      {' · '}
                      <a href={it.company_url} target="_blank" rel="noreferrer">官网</a>
                    </>
                  )}
                </div>
                <p className="jd-preview">{it.jd_text}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

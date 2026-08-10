import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Agent, CrawlResults, Resume } from '../types';

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
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(results.results.map((_, i) => i))
  );
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [resumeId, setResumeId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    Promise.all([api.resumes.list(), api.agents.list()]).then(([r, a]) => {
      setResumes(r);
      setAgents(a);
      const resumeMatch = r.find((x) => x.id === defaultResumeId);
      setResumeId(resumeMatch ? resumeMatch.id : r.length > 0 ? r[0].id : '');
      const agentMatch = a.find((x) => x.id === defaultAgentId);
      setAgentId(agentMatch ? agentMatch.id : a.length > 0 ? a[0].id : '');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultResumeId, defaultAgentId]);

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

  return (
    <div className="card">
      <div className="crawl-head">
        <h2>采集结果：{results.keyword}（{results.city}）共 {results.results.length} 条</h2>
        <p className="hint">勾选需要导入的岗位，然后选择简历与 agent，一键入库并批量派发契合度分析。</p>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-ok">{message}</div>}

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
        {results.results.map((it, i) => (
          <div className={`crawl-item${selected.has(i) ? ' selected' : ''}`} key={i}>
            <label className="checkbox">
              <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
            </label>
            <div className="crawl-item-body">
              <div className="crawl-item-title">
                <strong>{it.position_title || it.company_name}</strong>
                {it.salary && <span className="tag tag-salary">{it.salary}</span>}
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
        ))}
      </div>
    </div>
  );
}

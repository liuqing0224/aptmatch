import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { MatchRow, Resume } from '../types';

export default function Compare() {
  const navigate = useNavigate();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [resumeId, setResumeId] = useState('');
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.resumes.list().then((r) => {
      setResumes(r);
      if (r.length > 0) setResumeId(r[0].id);
    });
  }, []);

  useEffect(() => {
    api.matches.list(resumeId || undefined).then(setMatches).catch((e) => setError(e.message));
  }, [resumeId]);

  const dimKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const m of matches) for (const k of Object.keys(m.dimensions)) keys.add(k);
    return [...keys];
  }, [matches]);

  const sorted = [...matches].sort((a, b) => b.overall_score - a.overall_score);

  return (
    <div>
      <div className="page-head">
        <h1>跨公司对比</h1>
        <select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
          <option value="">全部简历</option>
          {resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {sorted.length === 0 && <div className="empty">暂无已完成的分析，先去「新建匹配」派发任务。</div>}
      {sorted.length > 0 && (
        <div className="card table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th>公司</th>
                <th>总分</th>
                {dimKeys.map((k) => <th key={k}>{matches.find((m) => m.dimensions[k])?.dimensions[k].label ?? k}</th>)}
                <th>结论</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => (
                <tr key={m.task_id} onClick={() => navigate(`/tasks/${m.task_id}`)}>
                  <td>
                    <strong>{m.company_name}</strong>
                    <span className="muted block">{m.resume_name}</span>
                  </td>
                  <td><span className={`rank rank-${m.grade}`}>{m.overall_score} {m.grade}</span></td>
                  {dimKeys.map((k) => (
                    <td key={k}>
                      {m.dimensions[k] ? (
                        <span className={m.dimensions[k].score >= 70 ? 'ok' : m.dimensions[k].score >= 55 ? 'mid' : 'low'}>
                          {Math.round(m.dimensions[k].score)}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                  ))}
                  <td className="summary-cell" title={m.summary}>{m.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useResourceStore } from '../store';
import type { MatchRow, TrendPoint } from '../types';
import CompareHeatmap from '../components/CompareHeatmap';
import TrendChart from '../components/TrendChart';

export default function Compare() {
  const navigate = useNavigate();
  const resumes = useResourceStore((s) => s.resumes);
  const ensureLoaded = useResourceStore((s) => s.ensureLoaded);
  const [resumeId, setResumeId] = useState('');
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [error, setError] = useState('');
  const [view, setView] = useState<'table' | 'heatmap'>('table');
  const [trendCompanyId, setTrendCompanyId] = useState<string | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureLoaded(['resumes']).then(() => {
      if (cancelled) return;
      const r = useResourceStore.getState().resumes;
      setResumeId((cur) => cur || (r.length > 0 ? r[0].id : ''));
    });
    return () => {
      cancelled = true;
    };
  }, [ensureLoaded]);

  useEffect(() => {
    api.matches.list(resumeId || undefined).then(setMatches).catch((e) => setError(e.message));
    setTrendCompanyId(null);
    setTrend([]);
  }, [resumeId]);

  useEffect(() => {
    if (!trendCompanyId) return;
    setTrendLoading(true);
    api.matches
      .trend(trendCompanyId, resumeId || undefined)
      .then(setTrend)
      .catch((e) => setError(e.message))
      .finally(() => setTrendLoading(false));
  }, [trendCompanyId, resumeId]);

  const dimKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const m of matches) for (const k of Object.keys(m.dimensions)) keys.add(k);
    return [...keys];
  }, [matches]);

  const sorted = [...matches].sort((a, b) => b.overall_score - a.overall_score);
  const trendCompanyName = trendCompanyId
    ? matches.find((m) => m.company_id === trendCompanyId)?.company_name ?? ''
    : '';

  function toggleTrend(companyId: string | null) {
    setTrendCompanyId((prev) => (prev === companyId ? null : companyId));
    setTrend([]);
  }

  function exportPdf() {
    const suffix = resumeId ? `?resume_id=${encodeURIComponent(resumeId)}` : '';
    window.open(`/api/matches/export.pdf${suffix}`, '_blank');
  }

  return (
    <div>
      <div className="page-head">
        <h1>跨公司对比</h1>
        <div className="row">
          <select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
            <option value="">全部简历</option>
            {resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <div className="seg">
            <button className={`seg-btn${view === 'table' ? ' active' : ''}`} onClick={() => setView('table')}>表格</button>
            <button className={`seg-btn${view === 'heatmap' ? ' active' : ''}`} onClick={() => setView('heatmap')}>热力图</button>
          </div>
          {matches.length > 0 && (
            <button className="btn" onClick={exportPdf}>导出 PDF</button>
          )}
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {sorted.length === 0 && <div className="empty">暂无已完成的分析，先去「新建匹配」派发任务。</div>}

      {trendCompanyId && (
        <div className="card">
          <div className="trend-head">
            <h2>{trendCompanyName} 历史趋势</h2>
            <button className="btn" onClick={() => toggleTrend(trendCompanyId)}>收起</button>
          </div>
          {trendLoading && <div className="spinner" />}
          <TrendChart points={trend} dimKeys={dimKeys} />
        </div>
      )}

      {sorted.length > 0 && view === 'table' && (
        <div className="card table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th>公司</th>
                <th>总分</th>
                {dimKeys.map((k) => <th key={k}>{matches.find((m) => m.dimensions[k])?.dimensions[k].label ?? k}</th>)}
                <th>趋势</th>
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
                  <td>
                    {m.company_id && (
                      <button
                        className="quick-add"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTrend(m.company_id);
                        }}
                      >
                        {trendCompanyId === m.company_id ? '收起' : '趋势'}
                      </button>
                    )}
                  </td>
                  <td className="summary-cell" title={m.summary}>{m.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sorted.length > 0 && view === 'heatmap' && (
        <CompareHeatmap rows={sorted} dimKeys={dimKeys} />
      )}
    </div>
  );
}

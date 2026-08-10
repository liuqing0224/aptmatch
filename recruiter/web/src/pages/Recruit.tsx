import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Candidate, Company, Task } from '../types';
import ScoreBadge from '../components/ScoreBadge';

const CANDIDATE_STATUSES = ['待筛', '已筛', '通过', '待定', '淘汰'];
const FEISHU_HR_URL = 'https://guanghe.feishu.cn/';

type RecruitTab = 'positions' | 'candidates' | 'guide';

function collectStatusLabel(status: Task['status']) {
  const labels: Record<Task['status'], string> = {
    queued: '排队中',
    running: '运行中',
    done: '已完成',
    failed: '失败',
    cancelled: '已取消',
  };
  return labels[status];
}

function statusTone(status: string) {
  if (status === '通过') return 'positive';
  if (status === '淘汰') return 'negative';
  if (status === '待定') return 'warning';
  return 'neutral';
}

export default function Recruit() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState<RecruitTab>(initialTab === 'candidates' || initialTab === 'guide' ? initialTab : 'positions');
  const [positions, setPositions] = useState<Company[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const [collectTask, setCollectTask] = useState<Task | null>(null);
  const [pName, setPName] = useState('');
  const [pDocUrl, setPDocUrl] = useState('');
  const [pJd, setPJd] = useState('');
  const [filterPosition, setFilterPosition] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [query, setQuery] = useState('');
  const [analysisBusyId, setAnalysisBusyId] = useState('');

  async function refresh() {
    const p = await api.positions.list();
    const positionId = filterPosition && p.some((position) => position.id === filterPosition)
      ? filterPosition
      : p[0]?.id ?? '';
    setPositions(p);
    if (positionId !== filterPosition) {
      setFilterPosition(positionId);
      if (!positionId) setCandidates([]);
      return;
    }
    const c = await api.candidates.list({ position_id: positionId, status: filterStatus || undefined });
    setCandidates(c);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const onFocus = () => refresh().catch(() => {});
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterPosition, filterStatus, tab]);

  useEffect(() => {
    if (!collectTask?.id || !['queued', 'running'].includes(collectTask.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const task = await api.tasks.get(collectTask.id);
        setCollectTask(task);
        if (['done', 'failed', 'cancelled'].includes(task.status)) refresh().catch(() => {});
      } catch {
        // A transient polling failure should not interrupt the active workflow.
      }
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectTask?.id, collectTask?.status]);

  const visibleCandidates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return candidates;
    return candidates.filter((candidate) =>
      [candidate.resume_name, candidate.position_name, candidate.summary]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    );
  }, [candidates, query]);

  const candidateStats = useMemo(() => ({
    pending: candidates.filter((c) => c.status === '待筛').length,
    passed: candidates.filter((c) => c.status === '通过').length,
    scored: candidates.filter((c) => c.overall_score != null).length,
  }), [candidates]);
  const activePosition = positions.find((position) => position.id === filterPosition) ?? null;

  async function createPosition(e: React.FormEvent) {
    e.preventDefault();
    if (!pName.trim()) {
      setError('请输入职位名');
      return;
    }
    setBusy(true);
    setError('');
    setMsg('');
    try {
      await api.positions.create({ name: pName.trim(), feishu_doc_url: pDocUrl.trim(), jd_text: pJd });
      setPName('');
      setPDocUrl('');
      setPJd('');
      setMsg('职位已创建，可以开始采集候选人');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removePosition(id: string, name: string) {
    if (!window.confirm(`删除职位「${name}」？`)) return;
    try {
      await api.positions.remove(id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function setStatus(candidate: Candidate, status: string) {
    try {
      const updated = await api.candidates.update(candidate.id, { status });
      setCandidates((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function startCollect() {
    if (!filterPosition) {
      setError('请先在「职位与 JD」创建一个职位');
      return;
    }
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const task = await api.candidates.collectStart({ position_id: filterPosition });
      setCollectTask(task);
      setMsg('采集任务已启动；已登录的独立浏览器会话将直接开始采集，无需扫码等待');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function generateAnalysis(candidate: Candidate) {
    setAnalysisBusyId(candidate.id);
    setError('');
    setMsg('');
    try {
      if (candidate.analysis_task_id) {
        await api.tasks.rerun(candidate.analysis_task_id);
      } else {
        await api.tasks.create({ resume_id: candidate.resume_id, company_id: candidate.position_id });
      }
      setCandidates((current) => current.map((item) => (
        item.id === candidate.id ? { ...item, analysis_task_status: 'queued' } : item
      )));
      setMsg(`已为「${candidate.resume_name}」派发多维分析任务`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setAnalysisBusyId('');
    }
  }

  return (
    <div className="recruit-workspace">
      <header className="recruit-header">
        <div>
          <div className="recruit-eyebrow">RECRUITING WORKSPACE</div>
          <h1>招聘端</h1>
          <p>从职位建档、飞书采集到候选人决策，集中在一个工作台。</p>
        </div>
        <button className="btn btn-primary recruit-header-action" onClick={() => setTab('candidates')}>
          进入候选人库
        </button>
      </header>

      <section className="recruit-metrics" aria-label="招聘数据概览">
        <div className="recruit-metric">
          <span>在招职位</span>
          <strong>{positions.length}</strong>
          <small>已建立 JD 档案</small>
        </div>
        <div className="recruit-metric">
          <span>候选人</span>
          <strong>{candidates.length}</strong>
          <small>{candidateStats.scored} 人已完成评估</small>
        </div>
        <div className="recruit-metric recruit-metric-attention">
          <span>待处理</span>
          <strong>{candidateStats.pending}</strong>
          <small>等待首轮筛选</small>
        </div>
        <div className="recruit-metric recruit-metric-success">
          <span>已通过</span>
          <strong>{candidateStats.passed}</strong>
          <small>可进入下一环节</small>
        </div>
      </section>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {msg && <div className="alert alert-ok" role="status">{msg}</div>}

      <div className="recruit-tabs" role="tablist" aria-label="招聘工作台导航">
        <button role="tab" aria-selected={tab === 'positions'} className={tab === 'positions' ? 'active' : ''} onClick={() => setTab('positions')}>
          职位与 JD <span>{positions.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'candidates'} className={tab === 'candidates' ? 'active' : ''} onClick={() => setTab('candidates')}>
          候选人库 <span>{candidates.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'guide'} className={tab === 'guide' ? 'active' : ''} onClick={() => setTab('guide')}>
          采集指引
        </button>
      </div>

      {tab === 'positions' && (
        <div className="recruit-position-layout">
          <form className="recruit-panel recruit-position-form form" onSubmit={createPosition}>
            <div className="recruit-panel-head">
              <div>
                <span className="recruit-section-index">01</span>
                <h2>新建职位</h2>
              </div>
              <p>建立职位档案后，即可关联飞书候选人并启动评估。</p>
            </div>
            <label>
              <span>职位名 *</span>
              <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="例如：高级前端工程师（数据中台）" />
            </label>
            <label>
              <span>飞书文档链接（JD，可选）</span>
              <input value={pDocUrl} onChange={(e) => setPDocUrl(e.target.value)} placeholder="https://xxx.feishu.cn/docx/…（由本地 lark-cli 读取）" />
            </label>
            <label className="recruit-jd-field">
              <span>粘贴 JD 文本</span>
              <textarea rows={9} value={pJd} onChange={(e) => setPJd(e.target.value)} placeholder="粘贴岗位职责、任职要求…" />
              <em className="hint">与飞书链接二选一；同时填写时优先使用粘贴内容。</em>
            </label>
            <div className="form-actions">
              <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? '创建中…' : '创建职位'}</button>
            </div>
          </form>

          <section className="recruit-panel recruit-position-list">
            <div className="recruit-panel-head recruit-panel-head-inline">
              <div>
                <span className="recruit-section-index">02</span>
                <h2>职位列表</h2>
              </div>
              <span className="recruit-total">{positions.length} 个职位</span>
            </div>
            {positions.length === 0 && <div className="empty">还没有职位，先建立第一个 JD 档案</div>}
            <div className="recruit-position-items">
              {positions.map((position) => (
                <article key={position.id} className="recruit-position-item">
                  <div className="recruit-position-main">
                    <div className="recruit-position-title">
                      <span className="recruit-position-mark">{position.name.charAt(0)}</span>
                      <div>
                        <strong>{position.name}</strong>
                        <span>{position.url ? '已关联飞书 JD' : '手动录入 JD'}</span>
                      </div>
                    </div>
                    <p>{position.jd_text?.slice(0, 150) || '暂无 JD 正文'}</p>
                  </div>
                  <div className="recruit-item-actions">
                    <button className="btn btn-sm" onClick={() => { setFilterPosition(position.id); setTab('candidates'); }}>采集候选人</button>
                    {position.url && <a className="btn btn-sm" href={position.url} target="_blank" rel="noreferrer">飞书文档</a>}
                    <button className="btn btn-sm btn-danger" onClick={() => removePosition(position.id, position.name)}>删除</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === 'candidates' && (
        <div className="recruit-candidate-layout">
          <section className="recruit-position-scope" aria-label="当前职位">
            <div>
              <span>当前职位</span>
              <strong>{activePosition?.name ?? '请先创建职位'}</strong>
              <p>候选人、分析任务与筛选状态均按职位独立管理</p>
            </div>
            <label>
              <span>切换职位</span>
              <select aria-label="候选人库职位" value={filterPosition} onChange={(e) => setFilterPosition(e.target.value)}>
                {positions.length === 0 && <option value="">（暂无职位）</option>}
                {positions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
              </select>
            </label>
          </section>

          <section className="recruit-panel recruit-collect-panel">
            <div className="recruit-panel-head recruit-panel-head-inline">
              <div>
                <span className="recruit-section-index">01</span>
                <h2>开始采集</h2>
              </div>
              {collectTask && <span className={`recruit-task-state state-${collectTask.status}`}>{collectStatusLabel(collectTask.status)}</span>}
            </div>
            <p className="recruit-panel-copy">Agent 会打开独立 Chromium，按当前职位采集飞书招聘「待筛选」简历；已登录时直接采集，仅在会话失效时才等待扫码，导入后自动派发评估任务。</p>
            <div className="recruit-collect-actions">
              <div className="recruit-collect-target">
                <span>采集目标</span>
                <strong>{activePosition?.name ?? '未选择职位'}</strong>
              </div>
              <button className="btn btn-primary" onClick={startCollect} disabled={busy || !filterPosition}>
                {busy ? '启动中…' : '启动独立浏览器采集'}
              </button>
            </div>
            {collectTask && (
              <div className="recruit-task-detail">
                <strong>采集任务：{collectStatusLabel(collectTask.status)}</strong>
                {collectTask.status === 'done' && (collectTask.result as { message?: string } | null)?.message && (
                  <span>{(collectTask.result as { message?: string }).message}</span>
                )}
                {collectTask.error && <span>{collectTask.error}</span>}
              </div>
            )}
          </section>

          <section className="recruit-panel recruit-candidate-panel">
            <div className="recruit-candidate-head">
              <div>
                <span className="recruit-section-index">02</span>
                <h2>{activePosition?.name ?? '候选人库'}</h2>
                <p>共 {candidates.length} 人，当前显示 {visibleCandidates.length} 人</p>
              </div>
              <div className="recruit-filter-bar">
                <input aria-label="搜索候选人" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索姓名、职位或摘要" />
                <select aria-label="筛选状态" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="">全部状态</option>
                  {CANDIDATE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
            </div>

            {visibleCandidates.length === 0 && <div className="empty">暂无符合条件的候选人</div>}
            <div className="recruit-candidate-table" role="table" aria-label="候选人列表">
              {visibleCandidates.length > 0 && (
                <div className="recruit-candidate-row recruit-candidate-labels" role="row">
                  <span role="columnheader">候选人</span>
                  <span role="columnheader">匹配评估</span>
                  <span role="columnheader">状态</span>
                  <span role="columnheader">来源</span>
                </div>
              )}
              {visibleCandidates.map((candidate) => (
                <article key={candidate.id} className="recruit-candidate-row" role="row">
                  <div className="recruit-candidate-person" role="cell">
                    <span className="recruit-avatar">{candidate.resume_name.charAt(0)}</span>
                    <div>
                      <strong>{candidate.resume_name}</strong>
                      <span>{candidate.position_name}</span>
                    </div>
                  </div>
                  <div className="recruit-candidate-score" role="cell">
                    {candidate.overall_score != null ? <ScoreBadge score={candidate.overall_score} grade={candidate.grade} /> : <span className="muted">待评分</span>}
                    <p>{candidate.summary || '评估任务完成后将显示摘要'}</p>
                  </div>
                  <div role="cell">
                    <select aria-label={`${candidate.resume_name}状态`} className={`cand-status tone-${statusTone(candidate.status)}`} value={candidate.status} onChange={(e) => setStatus(candidate, e.target.value)}>
                      {CANDIDATE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </div>
                  <CandidateAnalysisActions
                    candidate={candidate}
                    busy={analysisBusyId === candidate.id}
                    onGenerate={() => generateAnalysis(candidate)}
                  />
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === 'guide' && (
        <section className="recruit-panel recruit-guide">
          <div className="recruit-panel-head">
            <div>
              <span className="recruit-section-index">WORKFLOW</span>
              <h2>飞书招聘采集流程</h2>
            </div>
            <p>只需配置职位，剩余的采集、导入和评估由 Agent 串联完成。</p>
          </div>
          <ol className="recruit-steps">
            <li><span>1</span><div><strong>建立职位档案</strong><p>粘贴 JD 文本，或关联飞书文档链接。</p></div></li>
            <li><span>2</span><div><strong>启动飞书采集</strong><p>选择目标职位，Agent 读取「待筛选」列表中的候选人。</p></div></li>
            <li><span>3</span><div><strong>自动匹配评估</strong><p>候选人导入后自动获得评分、等级与匹配摘要。</p></div></li>
            <li><span>4</span><div><strong>完成筛选决策</strong><p>在候选人库中直接标记通过、待定或淘汰。</p></div></li>
          </ol>
          <div className="recruit-guide-action">
            <a className="btn btn-primary btn-lg" href={FEISHU_HR_URL} target="_blank" rel="noreferrer">打开飞书招聘</a>
            <button className="btn btn-lg" onClick={() => setTab('positions')}>先创建职位</button>
          </div>
        </section>
      )}
    </div>
  );
}

function CandidateAnalysisActions({
  candidate,
  busy,
  onGenerate,
}: {
  candidate: Candidate;
  busy: boolean;
  onGenerate: () => void;
}) {
  const taskId = candidate.analysis_task_id;
  const taskStatus = candidate.analysis_task_status;
  return (
    <div className="recruit-source" role="cell">
      {taskStatus === 'done' && taskId ? (
        <Link className="recruit-analysis-link" to={`/tasks/${taskId}?from=recruit`}>查看完整分析</Link>
      ) : taskStatus === 'queued' || taskStatus === 'running' ? (
        <span className="recruit-analysis-state">多维分析中</span>
      ) : taskStatus === 'failed' && taskId ? (
        <>
          <button className="recruit-generate-button" disabled={busy} onClick={onGenerate}>
            {busy ? '派发中…' : '重新生成分析'}
          </button>
          <Link className="recruit-resume-link" to={`/tasks/${taskId}?from=recruit`}>查看失败原因</Link>
        </>
      ) : (
        <button className="recruit-generate-button" disabled={busy} onClick={onGenerate}>
          {busy ? '派发中…' : '生成完整分析'}
        </button>
      )}
      {candidate.source_url && <a className="recruit-resume-link" href={candidate.source_url} target="_blank" rel="noreferrer">原始简历</a>}
    </div>
  );
}

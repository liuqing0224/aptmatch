import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useResourceStore } from '../store';
import type { Resume } from '../types';

function QuickNewResume({
  onCreated,
  onCancel,
}: {
  onCreated: (r: Resume) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) {
      setErr('请粘贴简历文本');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const form = new FormData();
      if (name.trim()) form.append('name', name.trim());
      form.append('text', text);
      const resume = await api.resumes.create(form);
      onCreated(resume);
    } catch (err2) {
      setErr(err2 instanceof ApiError ? err2.message : String(err2));
      setSaving(false);
    }
  }

  return (
    <div className="card quick-resume">
      <form onSubmit={save}>
        <div className="form-grid">
          <label>
            <span>名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：李四-数据平台-3年" />
          </label>
          <label>
            <span>粘贴简历文本 *</span>
            <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="粘贴简历全文…" />
          </label>
        </div>
        {err && <div className="alert alert-error">{err}</div>}
        <div className="form-actions">
          <button className="btn btn-primary" disabled={saving}>{saving ? '保存中…' : '保存并选择'}</button>
          <button type="button" className="btn" onClick={onCancel}>取消</button>
        </div>
      </form>
    </div>
  );
}

export default function NewMatch() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'fit' | 'crawl'>('fit');

  const resumes = useResourceStore((s) => s.resumes);
  const companies = useResourceStore((s) => s.companies);
  const agents = useResourceStore((s) => s.agents);
  const ensureLoaded = useResourceStore((s) => s.ensureLoaded);
  const refreshResources = useResourceStore((s) => s.refresh);
  const addResume = useResourceStore((s) => s.addResume);

  const [resumeId, setResumeId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [showNewResume, setShowNewResume] = useState(false);

  const [companyId, setCompanyId] = useState('');
  const [fitKeyword, setFitKeyword] = useState('');
  const [mode, setMode] = useState('fit');
  const [extraPrompt, setExtraPrompt] = useState('');

  const [keyword, setKeyword] = useState('');
  const [city, setCity] = useState('全国');
  const [limit, setLimit] = useState(6);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    ensureLoaded().catch(() => {});
    const onFocus = () => refreshResources().catch(() => {});
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [ensureLoaded, refreshResources]);

  useEffect(() => {
    setResumeId((cur) => cur || resumes[0]?.id || '');
    setAgentId((cur) => cur || agents[0]?.id || '');
  }, [resumes, agents]);

  async function submitFit(e: React.FormEvent) {
    e.preventDefault();
    if (!resumeId) {
      setError('请先选择简历');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      if (!companyId) {
        // 未选目标公司：按简历求职意向自动发现岗位（采集 → 导入 → 匹配）
        const task = await api.crawl.create({
          keyword: fitKeyword.trim(),
          city: '全国',
          limit: 6,
          resume_id: resumeId,
          agent_id: agentId || undefined,
        });
        navigate(`/tasks/${task.id}`);
        return;
      }
      const task = await api.tasks.create({
        resume_id: resumeId,
        company_id: companyId,
        agent_id: agentId || undefined,
        mode,
        extra_prompt: extraPrompt,
      });
      navigate(`/tasks/${task.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSubmitting(false);
    }
  }

  async function submitCrawl(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim()) {
      setError('请输入搜索关键词（如：高级数据工程师）');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const task = await api.crawl.create({
        keyword: keyword.trim(),
        city: city.trim() || '全国',
        limit,
        resume_id: resumeId || undefined,
        agent_id: agentId || undefined,
      });
      navigate(`/tasks/${task.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSubmitting(false);
    }
  }

  function handleCreated(resume: Resume) {
    addResume(resume);
    setResumeId(resume.id);
    setShowNewResume(false);
  }

  const resumeSelect = (
    <label>
      <span>
        候选人简历{' '}
        <button type="button" className="quick-add" onClick={() => setShowNewResume((v) => !v)}>
          ＋ 新建
        </button>
      </span>
      <select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
        <option value="">选择简历…</option>
        {resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {resumes.length === 0 && !showNewResume && (
        <em className="hint">还没有简历，点「＋ 新建」直接创建，或到「简历与公司」上传</em>
      )}
    </label>
  );

  const crawlResumeSelect = (
    <label>
      <span>
        参考简历（可选）{' '}
        <button type="button" className="quick-add" onClick={() => setShowNewResume((v) => !v)}>
          ＋ 新建
        </button>
      </span>
      <select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
        <option value="">不参考简历</option>
        {resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
    </label>
  );

  return (
    <div>
      <div className="page-head">
        <h1>新建匹配</h1>
      </div>
      <div className="tabs">
        <button className={`tab${tab === 'fit' ? ' active' : ''}`} onClick={() => setTab('fit')}>
          单个匹配
        </button>
        <button className={`tab${tab === 'crawl' ? ' active' : ''}`} onClick={() => setTab('crawl')}>
          批量爬取并匹配
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {showNewResume && (
        <QuickNewResume onCreated={handleCreated} onCancel={() => setShowNewResume(false)} />
      )}

      {tab === 'fit' && (
        <form className="card form" onSubmit={submitFit}>
          <div className="form-grid">
            {resumeSelect}
            <label>
              <span>目标公司与岗位（可选）</span>
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">选择公司…</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {companies.length === 0 && <em className="hint">还没有公司资料，可先用「批量爬取并匹配」抓取</em>}
            </label>
            {!companyId && (
              <label>
                <span>岗位关键词（未选公司时用于发现岗位）</span>
                <input
                  value={fitKeyword}
                  onChange={(e) => setFitKeyword(e.target.value)}
                  placeholder="例如：高级数据工程师 / 数据分析师…"
                />
                <em className="hint">不填则尝试从简历「求职意向」自动识别</em>
              </label>
            )}
            <label>
              <span>分析 Agent</span>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}（{a.provider}）</option>)}
              </select>
            </label>
            <label>
              <span>分析模式</span>
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="fit">标准契合度分析</option>
                <option value="research">深度调研模式（更侧重联网调研）</option>
              </select>
            </label>
          </div>
          <label>
            <span>附加说明（可选）</span>
            <textarea
              rows={4}
              placeholder="例如：优先考虑能远程的岗位；薪资预期 30-40k；不接受频繁出差…"
              value={extraPrompt}
              onChange={(e) => setExtraPrompt(e.target.value)}
            />
          </label>
          <div className="form-actions">
            <button className="btn btn-primary btn-lg" disabled={submitting}>
              {submitting
                ? '派发中…'
                : companyId
                  ? '派发给 Agent 分析'
                  : '自动发现岗位并分析'}
            </button>
            <p className="hint">
              {companyId
                ? '任务提交后会进入本地队列，由所选 coding agent 自动完成分析（默认联网调研公司）。'
                : '未选公司也没关系：系统会抓取相关岗位，之后勾选导入即可批量匹配。'}
            </p>
          </div>
        </form>
      )}

      {tab === 'crawl' && (
        <form className="card form" onSubmit={submitCrawl}>
          <div className="form-grid">
            <label>
              <span>岗位关键词</span>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="例如：高级数据工程师、AI 产品经理…"
              />
            </label>
            <label>
              <span>城市</span>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="全国 / 北京 / 上海 / 深圳…" />
            </label>
            <label>
              <span>目标数量</span>
              <input
                type="number"
                min={1}
                max={20}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value) || 6)}
              />
            </label>
            <label>
              <span>采集 Agent</span>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}（{a.provider}）</option>)}
              </select>
            </label>
            {crawlResumeSelect}
          </div>
          <div className="form-actions">
            <button className="btn btn-primary btn-lg" disabled={submitting}>
              {submitting ? '派发中…' : '派发采集任务'}
            </button>
            <p className="hint">
              采集 agent 会从 BOSS 直聘职位详情页 / 公司官网招聘页等公开来源抓取真实 JD，
              完成后可在报告页勾选结果、一键导入公司库并批量派发契合度分析。
            </p>
          </div>
        </form>
      )}
    </div>
  );
}

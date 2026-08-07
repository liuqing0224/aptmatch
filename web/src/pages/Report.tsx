import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Task } from '../types';
import RadarChart from '../components/RadarChart';
import ScoreBadge from '../components/ScoreBadge';
import StatusPill from '../components/StatusPill';
import CrawlResultsView from '../components/CrawlResultsView';
import type { BlacklistEntry, CrawlResults, FitReport } from '../types';

function exportMarkdown(task: Task) {
  const r = task.result;
  if (!r || 'results' in r) return;
  const rep = r as FitReport;
  const lines = [
    `# 契合度报告：${task.company?.name ?? ''}`,
    '',
    `- 候选人：${task.resume?.name ?? ''}`,
    `- 总分：${rep.overall_score}（${rep.grade}）`,
    `- 生成时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    `> ${rep.summary}`,
    '',
    '## 各维度得分',
    '',
    ...rep.dimensions.map((d) => `### ${d.label}：${d.score}/100\n\n${d.reason}\n`),
    '## 匹配要点',
    '',
    ...rep.matched.map((m) => `- ${m}`),
    '',
    '## 差距与弥补',
    '',
    ...rep.gaps.map((g) => `- **${g.item}**（${g.severity}）：${g.mitigation}`),
    '',
    '## 优势（面试突出）',
    '',
    ...rep.strengths.map((s) => `- ${s}`),
    '',
    '## 风险',
    '',
    ...(rep.risks.length ? rep.risks.map((x) => `- ${x}`) : ['- 无明显风险']),
    '',
    '## 建议向公司确认的问题',
    '',
    ...rep.questions.map((q) => `- ${q.question}（原因：${q.why}）`),
    '',
    '## 可执行建议',
    '',
    ...rep.suggestions.map((s) => `- ${s}`),
    '',
    '## 调研来源',
    '',
    ...(rep.research.length
      ? rep.research.map((x) => `- [${x.source}](${x.url})：${x.finding}`)
      : ['- 本次未做额外联网调研']),
    '',
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `契合度报告-${task.company?.name ?? '公司'}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Report() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState('');
  const [log, setLog] = useState('');
  const [followup, setFollowup] = useState('');
  const [sending, setSending] = useState(false);
  const [blkHits, setBlkHits] = useState<BlacklistEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const t = await api.tasks.get(id);
      setTask(t);
      setError('');
      if (t.company?.name) {
        try {
          setBlkHits(await api.blacklist.check(t.company.name));
        } catch {
          /* 黑名单检查失败不影响报告展示 */
        }
      }
      if (t.status === 'failed') setLog(await api.tasks.log(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    load();
    timerRef.current = setInterval(async () => {
      const t = await api.tasks.get(id!);
      setTask(t);
      if (t.status === 'done' || t.status === 'failed' || t.status === 'cancelled') {
        if (timerRef.current) clearInterval(timerRef.current);
      }
      if (t.status === 'failed') setLog(await api.tasks.log(id!));
    }, 2500);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [id, load]);

  async function sendFollowup() {
    if (!followup.trim() || !id) return;
    setSending(true);
    try {
      const t = await api.tasks.followup(id, followup.trim());
      setFollowup('');
      setSending(false);
      window.location.href = `/tasks/${t.id}`;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setSending(false);
    }
  }

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!task) return <div className="empty">加载中…</div>;

  const r = task.result;
  const busy = task.status === 'queued' || task.status === 'running';
  const isCrawl = task.mode === 'crawl';
  const crawlResults = isCrawl && r && 'results' in r ? (r as CrawlResults) : null;
  const fitReport = !isCrawl && r ? (r as FitReport) : null;

  return (
    <div>
      <div className="page-head">
        <div>
          <Link to="/board" className="back-link">← 返回看板</Link>
          <h1>{task.title}</h1>
        </div>
        <StatusPill status={task.status} />
      </div>

      {blkHits.length > 0 && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <strong>⚠️ 黑名单警示：</strong>
          该公司在社区企业黑名单中（{blkHits.map((h) => h.company_name).join('、')}）。
          上榜原因：{blkHits[0].issue || '详见来源'}。请面试前重点核实，详情见
          <Link to="/blacklist" style={{ textDecoration: 'underline' }}> 黑名单页面</Link>。
        </div>
      )}

      {busy && (
        <div className="card running-card">
          <div className="spinner" />
          {isCrawl
            ? '采集进行中：agent 正在从 BOSS 直聘 / 公司官网等公开来源抓取岗位 JD…'
            : '分析进行中：agent 正在阅读材料、调研公司并撰写报告…'}
        </div>
      )}

      {task.status === 'failed' && (
        <div className="card">
          <h2>任务失败</h2>
          <div className="alert alert-error">{task.error || '未知错误'}</div>
          {log && <pre className="log-box">{log}</pre>}
        </div>
      )}

      {task.status === 'cancelled' && (
        <div className="alert">任务已取消，可回到看板重跑。</div>
      )}

      {crawlResults && (
        <CrawlResultsView
          taskId={task.id}
          results={crawlResults}
          defaultResumeId={task.resume?.id}
          defaultAgentId={task.agent?.id}
        />
      )}

      {fitReport && (
        <>
          <div className="report-top">
            <div className="card score-card">
              <ScoreBadge score={fitReport.overall_score} grade={fitReport.grade} />
              <p className="summary">{fitReport.summary}</p>
              <div className="report-actions">
                <button className="btn" onClick={() => exportMarkdown(task)}>导出 Markdown</button>
              </div>
            </div>
            <div className="card radar-card">
              <RadarChart dimensions={fitReport.dimensions} />
            </div>
          </div>

          <div className="grid-2">
            {fitReport.dimensions.map((d) => (
              <div className="card dim-card" key={d.key}>
                <div className="dim-head">
                  <h3>{d.label}</h3>
                  <div className="dim-right">
                    {d.weight != null && <span className="hint">权重 {d.weight}%</span>}
                    <strong className={d.score >= 70 ? 'ok' : d.score >= 55 ? 'mid' : 'low'}>
                      {Math.round(d.score)}
                    </strong>
                  </div>
                </div>
                <p>{d.reason}</p>
                {d.evidence.length > 0 && (
                  <ul className="evidence">
                    {d.evidence.slice(0, 3).map((e, i) => <li key={i}>“{e}”</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <div className="card">
            <h2>匹配要点</h2>
            <div className="chips">
              {fitReport.matched.map((m, i) => <span key={i} className="chip chip-ok">{m}</span>)}
              {fitReport.matched.length === 0 && <span className="hint">无</span>}
            </div>
          </div>

          <div className="card">
            <h2>差距与弥补</h2>
            {fitReport.gaps.length === 0 && <p className="hint">未发现明显差距</p>}
            <ul className="gap-list">
              {fitReport.gaps.map((g, i) => (
                <li key={i}>
                  <strong>{g.item}</strong>
                  <span className={`severity severity-${g.severity}`}>{g.severity}</span>
                  <p>{g.mitigation}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid-2">
            <div className="card">
              <h2>优势（面试应突出）</h2>
              <ul className="plain-list">
                {fitReport.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
            <div className="card">
              <h2>风险与不确定性</h2>
              <ul className="plain-list">
                {fitReport.risks.map((s, i) => <li key={i}>{s}</li>)}
                {fitReport.risks.length === 0 && <li className="hint">无明显风险</li>}
              </ul>
            </div>
          </div>

          <div className="card">
            <h2>建议向公司确认的问题</h2>
            <ol className="q-list">
              {fitReport.questions.map((q, i) => (
                <li key={i}>
                  <strong>{q.question}</strong>
                  {q.why && <p className="hint">为什么问：{q.why}</p>}
                </li>
              ))}
            </ol>
          </div>

          <div className="card">
            <h2>可执行建议</h2>
            <ul className="plain-list">
              {fitReport.suggestions.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>

          <div className="card">
            <h2>调研来源</h2>
            {fitReport.research.length === 0 && <p className="hint">本次未记录额外联网调研来源（或网络受限已降级）。</p>}
            <ul className="research-list">
              {fitReport.research.map((x, i) => (
                <li key={i}>
                  <strong>{x.source}</strong>
                  {x.url && <a href={x.url} target="_blank" rel="noreferrer">来源链接</a>}
                  <p>{x.finding}</p>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {task.status === 'done' && !isCrawl && (
        <div className="card followup-card">
          <h2>继续追问</h2>
          <p className="hint">基于这份报告继续让 agent 分析，例如「换一个岗位方向再对比」「按这个岗位修改我的简历侧重点」。</p>
          <div className="row">
            <input
              value={followup}
              onChange={(e) => setFollowup(e.target.value)}
              placeholder="输入追问内容…"
              onKeyDown={(e) => e.key === 'Enter' && sendFollowup()}
            />
            <button className="btn btn-primary" disabled={sending || !followup.trim()} onClick={sendFollowup}>
              {sending ? '派发中…' : '发起追问'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

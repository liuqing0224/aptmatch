import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { subscribeEvents } from '../events';
import type { MockInterviewChain } from '../types';
import StatusPill from './StatusPill';

export default function MockInterview({ taskId }: { taskId: string }) {
  const [chain, setChain] = useState<MockInterviewChain | null>(null);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      setChain(await api.tasks.mockInterviewChain(taskId));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [taskId]);

  useEffect(() => {
    load();
    const unsub = subscribeEvents((event, data) => {
      if (event === 'task' && data?.task?.id === taskId) load();
    });
    return unsub;
  }, [taskId, load]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!chain) return <div className="empty">加载中…</div>;

  const turns = chain.turns;
  const last = turns[turns.length - 1];
  const busy = !!turns.find((t) => t.status === 'queued' || t.status === 'running');
  const ended = last?.finished;

  async function sendAnswer() {
    if (!answer.trim() || !last) return;
    setSending(true);
    setError('');
    try {
      const t = await api.tasks.mockInterviewAnswer(last.task_id, answer.trim());
      setAnswer('');
      setSending(false);
      window.location.href = `/tasks/${t.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSending(false);
    }
  }

  return (
    <div className="card interview-box">
      <div className="trend-head">
        <h2>模拟面试（共 {turns.length} 轮）</h2>
        {!ended && chain.fit && <Link to={`/tasks/${chain.fit.id}`} className="btn">查看原报告</Link>}
      </div>
      {busy && (
        <div className="card running-card" style={{ marginBottom: 12 }}>
          <div className="spinner" />
          面试官正在思考本轮问题…
        </div>
      )}
      <div className="interview-chat">
        {turns.map((t) => (
          <div key={t.task_id} className={`interview-turn${t.status === 'running' || t.status === 'queued' ? ' pending' : ''}`}>
            <div className="interview-meta">
              <span className="count">第 {t.round} 轮</span>
              {busy && <StatusPill status={t.status} />}
            </div>
            {t.question && (
              <div className="bubble bubble-agent">
                <strong>面试官</strong>
                <span>{t.question}</span>
              </div>
            )}
            {t.answer && (
              <div className="bubble bubble-candidate">
                <strong>你</strong>
                <span>{t.answer}</span>
              </div>
            )}
            {(t.evaluation || t.hint) && (
              <div className="feedback-panel">
                {t.evaluation && <p><strong>点评</strong>{t.evaluation}</p>}
                {t.evaluation && t.hint && <div className="feedback-divider" />}
                {t.hint && <p className="feedback-hint"><strong>答题提示</strong>{t.hint}</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      {ended && chain.turns.some((t) => t.overall_assessment) && (
        <div className="bubble bubble-summary interview-summary">
          <strong>面试结束 · 整体评估</strong>
          <span>{chain.turns.find((t) => t.overall_assessment)?.overall_assessment}</span>
        </div>
      )}

      {!ended && last && last.status === 'done' && (
        <div className="answer-bar">
          <textarea
            rows={2}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="输入你的回答…（Enter 提交，Shift+Enter 换行）"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendAnswer();
              }
            }}
            disabled={busy}
          />
          <button className="btn btn-primary" disabled={busy || sending || !answer.trim()} onClick={sendAnswer}>
            {sending ? '提交中…' : '提交回答'}
          </button>
        </div>
      )}
      {ended && (
        <div className="interview-actions">
          {chain.fit && <Link to={`/tasks/${chain.fit.id}`} className="btn btn-primary">查看完整报告</Link>}
        </div>
      )}
    </div>
  );
}

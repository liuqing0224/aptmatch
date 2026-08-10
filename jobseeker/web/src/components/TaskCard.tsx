import { useNavigate } from 'react-router-dom';
import type { Task } from '../types';
import { api } from '../api';
import ScoreBadge from './ScoreBadge';
import StatusPill from './StatusPill';

function fmt(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function TaskCard({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const navigate = useNavigate();
  const busy = task.status === 'queued' || task.status === 'running';

  async function cancel() {
    await api.tasks.cancel(task.id);
    onChanged();
  }
  async function rerun() {
    await api.tasks.rerun(task.id);
    onChanged();
  }

  return (
    <div
      className={`card task-card${busy ? ' task-card--running' : ''}`}
      onClick={() => navigate(`/tasks/${task.id}`)}
    >
      <div className="task-card-head">
        <StatusPill status={task.status} />
        {task.result && 'overall_score' in task.result && (
          <ScoreBadge score={task.result.overall_score} grade={task.result.grade} />
        )}
      </div>
      <div className="task-title" title={task.title}>{task.title}</div>
      <div className="task-meta">
        {task.agent ? <span>agent：{task.agent.name}</span> : <span>agent：-</span>}
        {task.mode === 'followup' && <span className="tag">追问</span>}
        {task.mode === 'crawl' && <span className="tag">采集</span>}
      </div>
      {task.resume && task.company && (
        <div className="task-route">
          {task.resume.name} → {task.company.name}
        </div>
      )}
      {task.status === 'failed' && task.error && <div className="task-error">{task.error}</div>}
      <div className="task-card-foot">
        <span className="muted">{fmt(task.created_at)}</span>
        <span className="actions" onClick={(e) => e.stopPropagation()}>
          {task.status === 'running' && (
            <button className="btn btn-sm" onClick={cancel}>取消</button>
          )}
          {task.status === 'queued' && (
            <button className="btn btn-sm" onClick={cancel}>取消排队</button>
          )}
          {(task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') && !busy && (
            <button className="btn btn-sm" onClick={rerun}>重跑</button>
          )}
          <button className="btn btn-sm btn-primary" onClick={() => navigate(`/tasks/${task.id}`)}>
            查看
          </button>
        </span>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Task } from '../types';
import TaskCard from '../components/TaskCard';
import { useTaskStore } from '../store';

type Filter = 'all' | 'active' | 'done' | 'dead';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'done', label: '已完成' },
  { key: 'dead', label: '失败 / 取消' },
];

function fmtDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
function latest(arr: Task[]) {
  return arr.reduce((m, t) => (t.created_at > m ? t.created_at : m), '');
}

export default function Board() {
  const tasks = useTaskStore((s) => s.tasks);
  const refresh = useTaskStore((s) => s.refresh);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    refresh().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const counts = useMemo(() => {
    const c = { all: tasks.length, active: 0, done: 0, dead: 0 };
    for (const t of tasks) {
      if (t.status === 'queued' || t.status === 'running') c.active += 1;
      else if (t.status === 'done') c.done += 1;
      else if (t.status === 'failed' || t.status === 'cancelled') c.dead += 1;
    }
    return c;
  }, [tasks]);

  const filtered = useMemo(
    () =>
      tasks.filter((t) =>
        filter === 'all'
          ? true
          : filter === 'active'
            ? t.status === 'queued' || t.status === 'running'
            : filter === 'done'
              ? t.status === 'done'
              : t.status === 'failed' || t.status === 'cancelled'
      ),
    [tasks, filter]
  );

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; tasks: Task[] }>();
    for (const t of filtered) {
      const key = t.resume?.id ?? '__none__';
      const label = t.resume?.name ?? '未关联简历';
      if (!map.has(key)) map.set(key, { label, tasks: [] });
      map.get(key)!.tasks.push(t);
    }
    const arr = [...map.values()];
    arr.sort((a, b) => latest(b.tasks).localeCompare(latest(a.tasks)));
    for (const g of arr) g.tasks.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return arr;
  }, [filtered]);

  return (
    <div>
      <div className="page-head">
        <h1>任务看板</h1>
        <Link to="/new" className="btn btn-primary">+ 新建匹配</Link>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="tabs board-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`tab${filter === f.key ? ' active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label} <span className="count">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {groups.length === 0 && (
        <div className="empty">
          暂无任务
          <div className="hint" style={{ marginTop: 6 }}>去「新建匹配」派发第一个分析任务，任务会按简历（人）分组展示</div>
        </div>
      )}

      {groups.map((g) => (
        <section className="person-section" key={g.label}>
          <div className="person-head">
            <span className="person-avatar" aria-hidden="true">{g.label.charAt(0)}</span>
            <h2>{g.label}</h2>
            <div className="person-head-right">
              <span className="muted">最近 {fmtDay(latest(g.tasks))}</span>
              <span className="person-count">{g.tasks.length} 个任务</span>
            </div>
          </div>
          <div className="person-grid">
            {g.tasks.map((t) => <TaskCard key={t.id} task={t} onChanged={refresh} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

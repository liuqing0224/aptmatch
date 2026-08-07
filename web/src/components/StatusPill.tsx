import type { TaskStatus } from '../types';

const labels: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '运行中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export default function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={`status status-${status}`}>{labels[status]}</span>;
}

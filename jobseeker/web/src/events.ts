type EventHandler = (event: string, data: any) => void;

let source: EventSource | null = null;
const listeners = new Set<EventHandler>();
const openHandlers = new Set<() => void>();
const HANDLED_EVENTS = ['task', 'blacklist', 'resource'] as const;

function connect() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/events');
  for (const name of HANDLED_EVENTS) {
    source.addEventListener(name, (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        for (const fn of [...listeners]) fn(name, data);
      } catch {
        /* 忽略无法解析的帧 */
      }
    });
  }
  source.onopen = () => {
    for (const fn of [...openHandlers]) fn();
  };
  // onerror 时 EventSource 会自动重连；重连成功后触发 openHandlers 做一次全量刷新兜底
}

export function subscribeEvents(fn: EventHandler): () => void {
  connect();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function onEventSourceOpen(fn: () => void): () => void {
  openHandlers.add(fn);
  return () => {
    openHandlers.delete(fn);
  };
}

export function subscribeTaskLog(taskId: string, onChunk: (data: string) => void): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  const es = new EventSource(`/api/tasks/${encodeURIComponent(taskId)}/log/stream`);
  es.addEventListener('log', (e) => {
    try {
      const parsed = JSON.parse((e as MessageEvent).data);
      if (typeof parsed?.data === 'string') onChunk(parsed.data);
    } catch {
      /* 忽略坏帧 */
    }
  });
  return () => es.close();
}

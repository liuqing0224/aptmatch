import { EventEmitter } from 'node:events';

/**
 * 进程内事件总线 + SSE 推送。
 * - emit(channel, payload)：触发本地监听，并把非 log 事件推给所有 /api/events 客户端。
 * - log 频道体量大且只有「实时日志」端点关心，只派发给 hub.on 订阅者，避免刷爆看板流。
 */
export function createEventHub() {
  const bus = new EventEmitter();
  const clients = new Set();

  function frame(event, payload) {
    return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  }

  return {
    on(channel, fn) {
      bus.on(channel, fn);
      return () => bus.off(channel, fn);
    },
    emit(channel, payload) {
      bus.emit(channel, payload);
      if (channel !== 'log') {
        const out = frame(channel, payload);
        for (const res of clients) {
          res.write(out);
        }
      }
    },
    addClient(res) {
      clients.add(res);
      res.on('close', () => clients.delete(res));
    },
    clientCount() {
      return clients.size;
    },
  };
}

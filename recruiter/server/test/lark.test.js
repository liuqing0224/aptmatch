import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { extractDocText, fetchDocFromLark } from '../lib/lark.js';

describe('extractDocText', () => {
  it('兼容字符串与常见字段形状', () => {
    expect(extractDocText('直接文本')).toBe('直接文本');
    expect(extractDocText({ content: 'content 字段' })).toBe('content 字段');
    expect(extractDocText({ data: { markdown: 'markdown 字段' } })).toBe('markdown 字段');
    expect(extractDocText({ blocks: [{ text: '块一' }, { content: '块二' }] })).toBe('块一\n块二');
    expect(extractDocText({ ok: false })).toBe('');
  });
});

function fakeChild({ stdoutText = '', stderrText = '', code = 0, emitError = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => child.emit('close', 143);
  child.on = child.on.bind(child);
  // 下一轮事件循环再派发数据与退出，模拟真实异步
  setTimeout(() => {
    if (stdoutText) child.stdout.emit('data', Buffer.from(stdoutText));
    if (stderrText) child.stderr.emit('data', Buffer.from(stderrText));
    if (emitError) child.emit('error', new Error('spawn failed'));
    else child.emit('close', code);
  }, 0);
  return child;
}

describe('fetchDocFromLark', () => {
  it('成功时返回文档正文', async () => {
    const text = await fetchDocFromLark({
      url: 'https://x.feishu.cn/docx/abc',
      spawnFn: () => fakeChild({ stdoutText: JSON.stringify({ ok: true, data: { content: 'JD 正文' } }) }),
    });
    expect(text).toBe('JD 正文');
  });

  it('ok=false 时透传飞书错误信息', async () => {
    await expect(
      fetchDocFromLark({
        url: 'https://x.feishu.cn/docx/bad',
        spawnFn: () =>
          fakeChild({
            stdoutText: JSON.stringify({ ok: false, error: { message: 'Invalid document_id or document not found' } }),
          }),
      })
    ).rejects.toThrow('Invalid document_id or document not found');
  });

  it('非零退出码时报告 stderr', async () => {
    await expect(
      fetchDocFromLark({
        url: 'https://x.feishu.cn/docx/bad',
        spawnFn: () => fakeChild({ stderrText: 'no such command', code: 1 }),
      })
    ).rejects.toThrow('exit 1');
  });

  it('启动失败（spawn error）时报可读错误', async () => {
    await expect(
      fetchDocFromLark({ url: 'u', spawnFn: () => fakeChild({ emitError: true }) })
    ).rejects.toThrow('无法启动 lark-cli');
  });
});

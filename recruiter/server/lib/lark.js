import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// 在 PATH 中定位 lark-cli；找不到时退回 npx（本地已装 @larksuite/cli，不会联网安装）
export function resolveLarkCli() {
  const dirs = (process.env.PATH ?? '').split(':').filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, 'lark-cli');
    try {
      if (fs.statSync(candidate).mode & 0o111) return { cmd: candidate, args: [] };
    } catch {
      /* 继续找 */
    }
  }
  return { cmd: 'npx', args: ['--no-install', '@larksuite/cli'] };
}

// 轻量 HTML → 纯文本：去掉标签、解码常见实体、压缩空白
export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

// 元数据键：不可能是文档正文，兜底遍历时跳过
const META_KEYS = new Set([
  'ok', 'identity', 'error', '_notice', 'code', 'msg', 'message',
  'request_id', 'log_id', 'type', 'status', 'updated', 'update',
]);

// 从 lark-cli docs +fetch 的 JSON 输出里提取文档正文，兼容多种字段形状
export function extractDocText(value) {
  if (typeof value === 'string') return /<[a-z][\s\S]*>/i.test(value) ? htmlToText(value) : value;
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(extractDocText).filter(Boolean).join('\n');
  const directKeys = ['content', 'markdown', 'text', 'content_text', 'plain_text'];
  for (const k of directKeys) {
    if (value[k] == null) continue;
    const t = extractDocText(value[k]);
    if (t) return t;
  }
  // 优先递归对象（正文通常在嵌套结构里）
  for (const k of Object.keys(value)) {
    if (META_KEYS.has(k)) continue;
    const v = value[k];
    if (v && typeof v === 'object') {
      const t = extractDocText(v);
      if (t) return t;
    }
  }
  // 字符串候选需足够长，避免 identity/状态词（如 "user"）误命中
  for (const k of Object.keys(value)) {
    if (META_KEYS.has(k)) continue;
    const v = value[k];
    if (typeof v === 'string' && v.trim().length >= 20) {
      const t = extractDocText(v);
      if (t) return t;
    }
  }
  return '';
}

// 通过本地 lark-cli（用户身份）读取飞书文档正文，供「职位 JD」使用
export function fetchDocFromLark({ url, timeoutMs = 60_000, spawnFn = spawn }) {
  return new Promise((resolve, reject) => {
    const { cmd, args } = resolveLarkCli();
    const child = spawnFn(
      cmd,
      [...args, 'docs', '+fetch', '--doc', url, '--api-version', 'v2', '--as', 'user', '--format', 'json'],
      { env: process.env }
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* 已退出 */
      }
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`无法启动 lark-cli：${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `lark-cli 读取文档失败（exit ${code}）：${stderr.trim().slice(0, 300) || '未知错误，请检查飞书文档链接与权限'}`
          )
        );
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed?.ok === false) {
          reject(new Error(`lark-cli 读取文档失败：${parsed?.error?.message ?? '未知错误'}`));
          return;
        }
        const text = extractDocText(parsed).trim();
        if (!text) {
          reject(new Error('lark-cli 未返回文档内容（请确认链接可访问且当前账号有权限）'));
          return;
        }
        resolve(text);
      } catch (e) {
        reject(new Error(`解析 lark-cli 输出失败：${e.message}`));
      }
    });
  });
}

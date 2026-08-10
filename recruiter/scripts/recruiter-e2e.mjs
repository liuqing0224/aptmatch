#!/usr/bin/env node
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('playwright');
const port = 8897;
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'aptmatch-recruit-e2e-'));
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, RUNNER: 'mock' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(pathname, init) {
  const response = await fetch(`${base}${pathname}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${pathname}: ${body.error || response.status}`);
  return body;
}
async function waitFor(check, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await wait(250);
  }
  throw new Error(`等待超时：${label}`);
}
async function jsonPost(pathname, body) {
  return api(pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

try {
  await waitFor(async () => (await fetch(`${base}/api/health`).catch(() => null))?.ok, '招聘 API');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const browserErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.locator('.recruit-position-form input').first().fill('E2E 前端职位');
  await page.locator('.recruit-position-form textarea').fill('负责前端研发；要求 React、TypeScript 和 3 年经验。');
  await page.getByRole('button', { name: '创建职位' }).click();
  await page.getByText('E2E 前端职位', { exact: true }).first().waitFor();

  const positions = (await api('/api/positions')).positions;
  const position = positions.find((item) => item.name === 'E2E 前端职位');
  if (!position) throw new Error('职位创建后未出现在 API 列表');

  const imported = await jsonPost('/api/candidates/import-feishu', {
    position_id: position.id,
    candidates: [
      { name: 'E2E 张三', text: 'React TypeScript 前端 5 年', source_url: 'https://feishu/e2e/a' },
      { name: 'E2E 李四', text: 'Node.js 后端 3 年', source_url: 'https://feishu/e2e/b' },
    ],
  });
  if (imported.imported.length !== 2 || imported.dispatched.length !== 2) throw new Error('候选人导入或任务派发数量错误');

  await page.getByRole('tab', { name: /候选人库/ }).click();
  await waitFor(async () => {
    const body = await page.locator('body').innerText();
    return body.includes('E2E 张三') || false;
  }, '前端候选人列表');
  await waitFor(async () => (await api(`/api/candidates?position_id=${position.id}`)).candidates.every((item) => item.overall_score != null), '多维分析任务');
  const scored = (await api(`/api/candidates?position_id=${position.id}`)).candidates;
  if (scored.length !== 2 || scored.some((item) => item.overall_score == null)) throw new Error('候选人未完成评分回写');

  const firstRow = page.getByRole('row').filter({ hasText: 'E2E 张三' });
  await firstRow.getByRole('combobox').selectOption('通过');
  await waitFor(async () => (await api(`/api/candidates?position_id=${position.id}&status=通过`)).candidates.length === 1, '候选人状态更新');

  const secondPosition = (await jsonPost('/api/positions', { name: 'E2E 另一职位', jd_text: '另一职位 JD' })).position;
  const sameResume = await jsonPost('/api/candidates/import-feishu', {
    position_id: secondPosition.id,
    candidates: [{ name: 'E2E 张三', text: 'React TypeScript 前端 5 年', source_url: 'https://feishu/e2e/a' }],
  });
  if (sameResume.imported.length !== 1) throw new Error('同一简历无法进入另一职位候选人库');

  const collect = await jsonPost('/api/candidates/collect-start', { position_id: position.id });
  await waitFor(async () => (await api(`/api/tasks/${collect.task.id}`)).task.status === 'done', '采集任务完成');
  if (browserErrors.length) throw new Error(`浏览器 console error：${browserErrors.join(' | ')}`);
  await browser.close();
  console.log(JSON.stringify({ ok: true, checks: ['职位创建', '按职位导入', '自动分析回写', '状态决策', '跨职位简历隔离', '采集任务闭环'] }));
} finally {
  server.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
}

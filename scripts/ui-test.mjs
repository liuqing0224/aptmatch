#!/usr/bin/env node
/**
 * AptMatch 全站 UI 自动化测试（外置 Playwright）
 *
 * 运行：node scripts/ui-test.mjs
 * 环境：PLAYWRIGHT_ROOT（默认 /Users/l/Documents/gameLearn/）下有 playwright；
 *       AptMatch 服务运行在 http://127.0.0.1:8787（默认，可用 BASE_URL 覆盖）。
 *
 * 覆盖：导航栏、看板、新建匹配、对比、简历与公司、Agent 管理、设置、
 *       黑名单、招聘端、报告页。
 * 只读为主：不创建/删除数据，不保存设置，不触发黑名单同步。
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const PLAYWRIGHT_ROOT = process.env.PLAYWRIGHT_ROOT ?? '/Users/l/Documents/gameLearn/';
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const { chromium } = require(path.join(PLAYWRIGHT_ROOT, 'node_modules/playwright'));

let passed = 0, failed = 0;
const failures = [];
function assert(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}
async function waitText(page, text, ms = 8000) {
  try { await page.getByText(text, { exact: false }).first().waitFor({ timeout: ms }); return true; }
  catch { return false; }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });

try {
  console.log('=== AptMatch 全站 UI 自动化测试 ===\n');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);

  // ---------- 导航 ----------
  console.log('[导航栏]');
  const nav = ['看板', '新建匹配', '对比', '简历与公司', 'Agent 管理', '设置', '招聘端', '黑名单'];
  for (const label of nav) {
    assert(`导航项「${label}」存在`, (await page.locator('.nav-link', { hasText: label }).count()) === 1);
  }

  // ---------- 看板 ----------
  console.log('\n[看板 /board]');
  assert('看板标题', await waitText(page, '任务看板'));
  const boardText = await page.evaluate(() => document.body.innerText);
  assert('看板有任务分组', ['待运行', '运行中', '已完成'].some((s) => boardText.includes(s)) || /(\d+) 个任务/.test(boardText));

  // ---------- 新建匹配 ----------
  console.log('\n[新建匹配 /new]');
  await page.locator('.nav-link', { hasText: '新建匹配' }).click();
  await page.waitForTimeout(1000);
  const newText = await page.evaluate(() => document.body.innerText);
  assert('页面标题（新建匹配/选择简历与公司）', newText.includes('新建匹配') || newText.includes('选择简历') || newText.includes('添加简历') || newText.includes('保存并选择'));
  const hasResumeSelect = (await page.locator('select').count()) >= 1 && newText.includes('选择简历');
  const hasQuickAdd = (await page.locator('.quick-add').count()) >= 1;
  assert('简历/公司选择器存在', hasResumeSelect || hasQuickAdd);

  // ---------- 对比 ----------
  console.log('\n[对比 /compare]');
  await page.locator('.nav-link', { hasText: '对比' }).click();
  await page.waitForTimeout(1000);
  assert('跨公司对比标题', await waitText(page, '跨公司对比'));

  // ---------- 简历与公司 ----------
  console.log('\n[简历与公司 /resources]');
  await page.locator('.nav-link', { hasText: '简历与公司' }).click();
  await page.waitForTimeout(1000);
  assert('页面标题', await waitText(page, '简历与公司'));
  assert('简历/公司两个 Tab', (await page.getByRole('button', { name: '简历' }).count()) >= 1 && (await page.getByRole('button', { name: '公司' }).count()) >= 1);
  assert('新增简历表单', (await page.getByPlaceholder('例如：张三-前端-5年').count()) > 0 || (await page.getByPlaceholder('粘贴简历全文…').count()) > 0);

  // ---------- Agent 管理 ----------
  console.log('\n[Agent 管理 /agents]');
  await page.locator('.nav-link', { hasText: 'Agent 管理' }).click();
  await page.waitForTimeout(1000);
  assert('Agent 管理标题', await waitText(page, 'Agent 管理'));
  assert('新建 Agent 表单', (await page.getByPlaceholder('例如：行业研究 agent').count()) > 0);

  // ---------- 设置 ----------
  console.log('\n[设置 /settings]');
  await page.locator('.nav-link', { hasText: '设置' }).click();
  await page.waitForTimeout(1000);
  assert('设置标题', await waitText(page, '设置'));
  assert('保存设置按钮', (await page.getByRole('button', { name: '保存设置' }).count()) === 1);

  // ---------- 黑名单 ----------
  console.log('\n[黑名单 /blacklist]');
  await page.locator('.nav-link', { hasText: '黑名单' }).click();
  await page.waitForTimeout(1000);
  const blText = await page.evaluate(() => document.body.innerText);
  assert('企业黑名单标题', blText.includes('企业黑名单'));
  assert('搜索框存在', (await page.getByPlaceholder('搜索公司名 / 问题关键词…').count()) === 1);

  // ---------- 招聘端 ----------
  console.log('\n[招聘端 /recruit]');
  await page.locator('.nav-link', { hasText: '招聘端' }).click();
  await page.waitForTimeout(1200);
  assert('招聘端标题', await waitText(page, '招聘端'));
  assert('三个 Tab', (await page.getByRole('button', { name: '职位与 JD' }).count()) === 1
    && (await page.getByRole('button', { name: '候选人库' }).count()) === 1
    && (await page.getByRole('button', { name: '采集指引' }).count()) === 1);
  await page.getByRole('button', { name: '候选人库' }).click();
  await page.waitForTimeout(1200);
  const candText = await page.evaluate(() => document.body.innerText);
  assert('候选人库展示评分', /\d+\s*[ABC]/.test(candText) || candText.includes('待评分'));
  assert('候选人状态选项', ['待筛', '已筛', '通过', '待定', '淘汰'].every((s) => candText.includes(s)));

  // ---------- 报告页 ----------
  console.log('\n[报告页 /tasks/:id]');
  const doneTask = await page.evaluate(async () => {
    const r = await fetch('/api/tasks?limit=500');
    const j = await r.json();
    const ts = Array.isArray(j) ? j : (j.tasks ?? []);
    return ts.find((t) => t.status === 'done' && t.result && t.mode !== 'collect') ?? ts[0] ?? null;
  });
  if (doneTask) {
    await page.goto(`${BASE_URL}/tasks/${doneTask.id}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);
    const repText = await page.evaluate(() => document.body.innerText);
    assert('报告页可渲染', repText.length > 100);
    assert('报告含分析内容', /契合度|评分|报告|分析|建议/.test(repText));
  } else {
    assert('存在已完成任务用于报告页', false, '无任务');
  }

  // ---------- 汇总 ----------
  console.log(`\n=== 结果：通过 ${passed}，失败 ${failed} ===`);
  if (failures.length) {
    console.log('失败明细：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}

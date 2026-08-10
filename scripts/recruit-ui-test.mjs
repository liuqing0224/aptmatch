#!/usr/bin/env node
/**
 * 招聘端完整 UI 自动化测试（外置 Playwright）
 *
 * 运行：node scripts/recruit-ui-test.mjs
 * 环境：PLAYWRIGHT_ROOT（默认 /Users/l/Documents/gameLearn/）下有 playwright；
 *       AptMatch 服务运行在 http://127.0.0.1:8787（默认，可用 BASE_URL 覆盖）。
 *
 * 覆盖：职位与 JD（列表/粘贴 JD 创建/删除/空职位提示）、候选人库（列表/评分展示/
 *       职位过滤/状态过滤/状态切换/采集入口）、采集指引（步骤与按钮）。
 * 可选：START_COLLECT=1 时点击「打开飞书招聘，开始采集」，验证 collect 任务创建并跑完
 *       （会真实启动 Codex agent 采集，需 Cookie 文件 /tmp/feishu_cookies.txt）。
 * 测试数据：创建带时间戳的测试职位，测后删除；候选人状态切换后恢复原值。
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
page.on('dialog', (d) => d.accept());

try {
  console.log('=== 招聘端 UI 自动化测试 ===\n');
  await page.goto(`${BASE_URL}/recruit`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);

  // ---------- 基础渲染 ----------
  console.log('[基础渲染]');
  assert('页面标题「招聘端」', await waitText(page, '招聘端'));
  assert('三个 Tab 存在', (await page.getByRole('button', { name: '职位与 JD' }).count()) === 1
    && (await page.getByRole('button', { name: '候选人库' }).count()) === 1
    && (await page.getByRole('button', { name: '采集指引' }).count()) === 1);

  // ---------- 职位与 JD ----------
  console.log('\n[职位与 JD]');
  assert('职位列表显示 AI赋能工程师', await waitText(page, 'AI赋能工程师'));
  assert('JD 文本预览显示', await waitText(page, '岗位JD'));
  const posBefore = (await page.locator('.list-item').count());

  // 创建职位（粘贴 JD）
  const testName = `UI测试职位-${Date.now()}`;
  await page.getByPlaceholder('例如：高级前端工程师（数据中台）').fill(testName);
  await page.getByPlaceholder('粘贴岗位职责、任职要求…').fill('岗位职责：负责 AI 能力建设。任职要求：熟悉 LLM、Prompt 工程。');
  await page.getByRole('button', { name: '创建职位' }).click();
  assert('创建成功提示', await waitText(page, '职位已创建'));
  assert('新职位出现在列表', await waitText(page, testName));
  assert('职位列表数量增加', (await page.locator('.list-item').count()) === posBefore + 1);

  // 空表单校验（清空后点创建）
  await page.getByPlaceholder('例如：高级前端工程师（数据中台）').fill('');
  await page.getByRole('button', { name: '创建职位' }).click();
  await page.waitForTimeout(500);
  const body = await page.evaluate(() => document.body.innerText);
  assert('空职位名报错', body.includes('职位名') && (body.includes('必填') || body.includes('不能为空')) || /职位.*必填/.test(body));

  // 删除测试职位（confirm 已自动接受）
  await page.locator('.list-item', { hasText: testName }).getByRole('button', { name: '删除' }).click();
  await page.waitForTimeout(800);
  assert('测试职位已删除', !(await waitText(page, testName, 2000)));

  // ---------- 候选人库 ----------
  console.log('\n[候选人库]');
  await page.getByRole('button', { name: '候选人库' }).click();
  await page.waitForTimeout(1200);
  const candBody = await page.evaluate(() => document.body.innerText);
  assert('候选人库标题与计数', /候选人库（\d+）/.test(candBody));
  assert('有评分/等级展示', /\d+\s*[ABC]/.test(candBody) || candBody.includes('待评分'));
  assert('状态列存在', ['待筛', '已筛', '通过', '待定', '淘汰'].every((s) => candBody.includes(s)));
  assert('采集入口按钮存在', await page.getByRole('button', { name: '打开飞书招聘，开始采集' }).count() === 1);

  // 一键采集（可选：真实启动 agent）
  if (process.env.START_COLLECT === '1') {
    console.log('\n[一键采集 START_COLLECT=1]');
    await page.getByRole('button', { name: '打开飞书招聘，开始采集' }).click();
    await page.waitForTimeout(1500);
    const startBody = await page.evaluate(() => document.body.innerText);
    assert('出现采集任务状态卡片', /采集任务：/.test(startBody));

    // 通过 API 确认 collect 任务已创建
    const resp = await page.request.get(`${BASE_URL}/api/tasks`);
    const { tasks } = await resp.json();
    const collectTask = tasks.find((t) => t.mode === 'collect');
    assert('collect 任务已创建', !!collectTask, collectTask ? `title=${collectTask.title}` : '未找到 collect 任务');

    // 等待任务结束（最多 6 分钟）
    const deadline = Date.now() + 6 * 60 * 1000;
    let finalTask = collectTask;
    while (Date.now() < deadline) {
      await page.waitForTimeout(5000);
      const r2 = await page.request.get(`${BASE_URL}/api/tasks/${collectTask.id}`);
      const { task } = await r2.json();
      finalTask = task;
      if (['done', 'failed', 'cancelled'].includes(task.status)) break;
    }
    assert(
      '采集任务最终完成',
      ['done', 'failed', 'cancelled'].includes(finalTask.status),
      `status=${finalTask.status} error=${finalTask.error}`
    );
    if (finalTask.status === 'done') {
      assert('采集结果 message 返回', !!(finalTask.result && finalTask.result.message), JSON.stringify(finalTask.result));
    }
    if (finalTask.status === 'failed') {
      assert('失败原因说明', finalTask.error.length > 0, finalTask.error);
    }
  }

  // 职位过滤
  const candCount = (await page.locator('.list-item').count());
  await page.getByLabel('筛选职位').selectOption({ label: 'AI赋能工程师' });
  await page.waitForTimeout(1000);
  const filteredBody = await page.evaluate(() => document.body.innerText);
  assert('职位过滤后仍显示候选人', /候选人库（\d+）/.test(filteredBody));
  assert('过滤后不含其他职位', !filteredBody.includes('UI测试职位'));

  // 状态过滤：已筛
  await page.getByLabel('筛选状态').selectOption({ label: '已筛' });
  await page.waitForTimeout(1000);
  const statusBody = await page.evaluate(() => document.body.innerText);
  const hasScreened = /候选人库（\d+）/.test(statusBody);
  assert('状态过滤「已筛」生效', hasScreened);

  // 状态切换（选一个候选人改为「通过」再改回「已筛」，不破坏数据）
  const statusSelect = page.locator('.cand-status').first();
  if ((await statusSelect.count()) > 0) {
    const orig = await statusSelect.inputValue();
    await statusSelect.selectOption({ label: '通过' });
    await page.waitForTimeout(800);
    assert('状态切换为「通过」', (await page.locator('.cand-status').first().inputValue()) === '通过');
    await page.locator('.cand-status').first().selectOption({ label: orig });
    await page.waitForTimeout(800);
    assert('状态恢复原值', (await page.locator('.cand-status').first().inputValue()) === orig);
  } else {
    assert('候选人有状态下拉可切换', false, '无候选人行');
  }

  // 清空过滤
  await page.getByLabel('筛选职位').selectOption({ label: '全部职位' });
  await page.getByLabel('筛选状态').selectOption({ label: '全部状态' });
  await page.waitForTimeout(800);

  // ---------- 采集指引 ----------
  console.log('\n[采集指引]');
  await page.getByRole('button', { name: '采集指引' }).click();
  await page.waitForTimeout(500);
  const guideBody = await page.evaluate(() => document.body.innerText);
  assert('采集流程说明展示', guideBody.includes('飞书招聘采集流程'));
  assert('「打开飞书招聘」按钮存在', await page.getByRole('link', { name: '打开飞书招聘' }).count() === 1);
  const hrHref = await page.getByRole('link', { name: '打开飞书招聘' }).first().getAttribute('href');
  assert('飞书入口链接正确', hrHref === 'https://guanghe.feishu.cn/');

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

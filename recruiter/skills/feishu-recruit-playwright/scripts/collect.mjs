#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RECRUITER_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const requireFromRecruiter = createRequire(path.join(RECRUITER_ROOT, 'package.json'));
const { chromium } = requireFromRecruiter('playwright');

const HIRE_URL = 'https://guanghe.feishu.cn/hire/application-biz/evaluation/list';
const LIST_PATH = '/atsx/api/evaluation/list_v2/';
const RESUME_URL = '/atsx/api/application/get_default_resume/';
const RESUME_TEXT_URL = '/atsx/api/application/get_attachment_resume_text_ext/';

export function parseArgs(argv) {
  const args = {
    activityStatus: 0,
    apiBase: 'http://127.0.0.1:8887',
    import: false,
    jobName: '',
    limit: Infinity,
    listTimeout: 60,
    loginTimeout: 600,
    offset: 0,
    outDir: path.join(RECRUITER_ROOT, '.data', 'feishu-resumes'),
    positionId: '',
    profileDir: path.join(RECRUITER_ROOT, '.data', 'feishu-playwright-profile'),
    resultFile: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--activity-status') args.activityStatus = Number(argv[++i]);
    else if (value === '--api-base') args.apiBase = argv[++i];
    else if (value === '--import') args.import = true;
    else if (value === '--job-name') args.jobName = argv[++i];
    else if (value === '--limit') args.limit = Number(argv[++i]);
    else if (value === '--list-timeout') args.listTimeout = Number(argv[++i]);
    else if (value === '--login-timeout') args.loginTimeout = Number(argv[++i]);
    else if (value === '--offset') args.offset = Number(argv[++i]);
    else if (value === '--out-dir') args.outDir = path.resolve(argv[++i]);
    else if (value === '--position-id') args.positionId = argv[++i];
    else if (value === '--profile-dir') args.profileDir = path.resolve(argv[++i]);
    else if (value === '--result-file') args.resultFile = path.resolve(argv[++i]);
    else if (value === '--help') args.help = true;
    else throw new Error(`未知参数：${value}`);
  }
  return args;
}

function usage() {
  return `用法: node scripts/collect.mjs [选项]
  --position-id <id>       AptMatch 招聘端职位 ID（--import 时必填）
  --job-name <name>        飞书职位名；只采集该职位（必填）
  --api-base <url>         招聘 API（默认 http://127.0.0.1:8887）
  --import                 采集后导入招聘端
  --limit <n>              最多处理数量（默认全部）
  --offset <n>             从匹配结果第几条开始
  --profile-dir <dir>      Playwright 持久登录目录
  --out-dir <dir>          简历缓存目录
  --result-file <file>     始终写入任务结果 JSON
  --list-timeout <秒>      已登录时等待列表接口的时长（默认 60）
  --login-timeout <秒>     等待扫码登录时长（默认 600）`;
}

const normalize = (value) => String(value ?? '').trim().replace(/\s+/g, '').toLowerCase();
export function matchesJob(item, jobName) {
  const expected = normalize(jobName);
  const actual = normalize(item?.job?.title ?? item?.job_title ?? item?.job_name);
  return Boolean(expected && actual && (actual === expected || actual.includes(expected) || expected.includes(actual)));
}

const fmtDate = (value) => String(value ?? '').slice(0, 10).replace(/-/g, '.');
const DEGREE = { 4: '高中', 5: '大专', 6: '本科', 7: '硕士', 8: '博士' };
function section(title, lines) {
  const content = lines.filter(Boolean);
  return content.length ? `## ${title}\n${content.join('\n')}` : '';
}

export function toMarkdown(profile) {
  const parts = [`# ${profile.name || '未命名'}`];
  const info = [
    profile.age && `年龄：${profile.age}`,
    profile.gender && `性别：${profile.gender}`,
    profile.email && `邮箱：${profile.email}`,
    profile.mobile && `电话：${profile.mobile}`,
    profile.current_location && `现居：${profile.current_location}`,
    profile.experience_years && `工作年限：${profile.experience_years}年`,
  ].filter(Boolean);
  if (info.length) parts.push(`## 基本信息\n${info.join('；')}`);
  parts.push(section('教育背景', (profile.educations || []).map((item) =>
    `- ${fmtDate(item.start_date)} ~ ${fmtDate(item.end_date)} | ${item.school || ''} | ${item.major || ''} | ${DEGREE[item.degree] || item.degree || ''}`)));
  const careers = [];
  for (const item of [...(profile.careers || []), ...(profile.intern_ships || [])]) {
    careers.push(`- ${fmtDate(item.start_date)} ~ ${fmtDate(item.end_date)} | ${item.company || ''} | ${item.title || ''}`);
    if (item.jd) careers.push(`  ${String(item.jd).replace(/\n/g, '\n  ')}`);
  }
  parts.push(section('工作经历', careers));
  const projects = [];
  for (const item of profile.project_list || []) {
    projects.push(`- ${item.name || ''} ${item.role || ''} ${fmtDate(item.start_date)}~${fmtDate(item.end_date)}`);
    if (item.description) projects.push(`  ${String(item.description).replace(/\n/g, '\n  ')}`);
  }
  parts.push(section('项目经历', projects));
  if (profile.self_evaluation) parts.push(`## 自我评价\n${profile.self_evaluation}`);
  if (profile.skills) parts.push(`## 技能\n${profile.skills}`);
  if (profile.content) parts.push(`## 简历原文\n${profile.content}`);
  return parts.filter(Boolean).join('\n\n');
}

export function createListInterceptor(page, activityStatus = 0) {
  const items = new Map();
  const waiters = new Set();
  let total = null;
  let responses = 0;
  let lastError = null;

  const notify = () => {
    for (const waiter of waiters) waiter();
    waiters.clear();
  };
  const onResponse = async (response) => {
    try {
      const url = new URL(response.url());
      if (url.pathname !== LIST_PATH || response.request().method() !== 'POST') return;
      const requestBody = response.request().postDataJSON?.() ?? {};
      if (Number(requestBody.activity_status ?? 0) !== activityStatus) return;
      const body = await response.json();
      if (!body?.success || !Array.isArray(body?.data?.evaluation_list)) {
        lastError = `list_v2 返回异常：${JSON.stringify(body).slice(0, 240)}`;
        notify();
        return;
      }
      responses += 1;
      total = Number(body.data.count ?? body.data.evaluation_list.length);
      for (const item of body.data.evaluation_list) {
        const key = item.application_id || `${item.talent_id}:${item.job?.id || item.job?.title || ''}`;
        items.set(key, item);
      }
      notify();
    } catch (error) {
      lastError = `解析 list_v2 响应失败：${error instanceof Error ? error.message : String(error)}`;
      notify();
    }
  };
  page.on('response', onResponse);

  return {
    snapshot: () => ({ items: [...items.values()], total, responses, lastError }),
    waitForChange: (timeoutMs = 2000) => new Promise((resolve) => {
      let timer;
      const done = () => {
        clearTimeout(timer);
        waiters.delete(done);
        resolve();
      };
      waiters.add(done);
      timer = setTimeout(done, timeoutMs);
    }),
    dispose: () => page.off('response', onResponse),
  };
}

export function isFeishuLoginUrl(value) {
  try {
    const url = new URL(value);
    return /(^|\.)(accounts|passport)\.feishu\.cn$/i.test(url.hostname) || /\/(login|sso|auth)(\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function driveListPagination(page) {
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const scrollables = [...document.querySelectorAll('*')].filter((element) => {
      const style = getComputedStyle(element);
      return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 40;
    });
    for (const element of scrollables) element.scrollTop = element.scrollHeight;
  });
  await page.mouse.wheel(0, 2400).catch(() => {});
  const candidates = page.getByText(/下一页|Next/i, { exact: true });
  for (let index = (await candidates.count().catch(() => 0)) - 1; index >= 0; index -= 1) {
    const next = candidates.nth(index);
    if (await next.isVisible().catch(() => false)) {
      await next.click({ timeout: 1000 }).catch(() => {});
      break;
    }
  }
}

export async function collectInterceptedList(page, interceptor, { timeoutSeconds = 600, listTimeoutSeconds = 60 } = {}) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let loginAnnounced = false;
  let sessionAnnounced = false;
  let sessionStart = null;
  let loginHits = 0;
  let stalled = 0;
  while (Date.now() < deadline) {
    const before = interceptor.snapshot();
    if (before.lastError) throw new Error(before.lastError);
    if (before.responses > 0 && before.total !== null && before.items.length >= before.total) return before.items;

    const currentUrl = typeof page.url === 'function' ? await page.url() : '';
    const onLoginPage = isFeishuLoginUrl(currentUrl);
    if (before.responses === 0) {
      if (onLoginPage) {
        loginHits += 1;
        sessionStart = null;
        if (loginHits >= 2 && !loginAnnounced) {
          console.log('LOGIN_REQUIRED: 当前位于飞书登录页面，请扫码；登录后将自动继续。');
          loginAnnounced = true;
        }
      } else {
        loginHits = 0;
        if (!sessionAnnounced) {
          console.log('已登录：持久会话有效，跳过扫码等待，直接采集。');
          sessionAnnounced = true;
          sessionStart = Date.now();
        }
        if (sessionStart && Date.now() - sessionStart > listTimeoutSeconds * 1000) {
          throw new Error(`已登录但招聘列表接口未在 ${listTimeoutSeconds} 秒内返回，请检查飞书页面是否正常加载`);
        }
      }
    } else {
      loginHits = 0;
      sessionStart = null;
    }
    if (before.responses > 0) await driveListPagination(page);
    await interceptor.waitForChange(before.responses > 0 ? 1800 : 1200);
    const after = interceptor.snapshot();
    stalled = after.responses === before.responses && after.items.length === before.items.length ? stalled + 1 : 0;
    if (after.responses === 0 && stalled >= 1) {
      const reloadUrl = typeof page.url === 'function' ? await page.url() : '';
      if (!isFeishuLoginUrl(reloadUrl) && typeof page.goto === 'function') {
        console.log('页面未返回招聘列表接口，重新加载待评估列表页。');
        await page.goto(HIRE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
        stalled = 0;
      }
    }
    if (before.responses > 0 && stalled >= 3) {
      if (after.total === null || after.items.length >= after.total) return after.items;
      throw new Error(`只拦截到 ${after.items.length}/${after.total} 条招聘列表，页面未继续发起分页请求`);
    }
  }
  throw new Error(`等待飞书扫码登录或招聘列表接口超时（${timeoutSeconds} 秒）`);
}

async function fetchJson(page, url) {
  const result = await page.evaluate(async (endpoint) => {
    const response = await fetch(endpoint, { headers: { accept: 'application/json' } });
    return response.json();
  }, url);
  if (result?.success === false) throw new Error(`飞书接口失败：${JSON.stringify(result).slice(0, 240)}`);
  return result;
}

function writeResult(file, result) {
  if (!file) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function importCandidates(args, candidates) {
  let imported = 0;
  let skipped = 0;
  let dispatched = 0;
  for (let i = 0; i < candidates.length; i += 100) {
    const response = await fetch(`${args.apiBase.replace(/\/$/, '')}/api/candidates/import-feishu`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ position_id: args.positionId, candidates: candidates.slice(i, i + 100) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `招聘端导入失败（HTTP ${response.status}）`);
    imported += body.imported?.length || 0;
    skipped += body.skipped || 0;
    dispatched += body.dispatched?.length || 0;
  }
  return { imported, skipped, dispatched };
}

export async function run(args) {
  if (!args.jobName) throw new Error('必须提供 --job-name，避免跨职位导入候选人');
  if (args.import && !args.positionId) throw new Error('--import 需要 --position-id');
  mkdirSync(args.profileDir, { recursive: true, mode: 0o700 });
  chmodSync(args.profileDir, 0o700);
  mkdirSync(args.outDir, { recursive: true });

  const context = await chromium.launchPersistentContext(args.profileDir, { headless: false });
  let listInterceptor;
  try {
    const pages = context.pages();
    const page = pages[0] || await context.newPage();
    listInterceptor = createListInterceptor(page, args.activityStatus);
    await page.goto(HIRE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    const all = await collectInterceptedList(page, listInterceptor, {
      timeoutSeconds: args.loginTimeout,
      listTimeoutSeconds: args.listTimeout,
    });
    console.log(`已通过 Playwright 网络响应拦截获取 ${all.length} 条待评估记录。`);

    const availableJobs = [...new Set(all.map((item) => item?.job?.title).filter(Boolean))];
    const matched = all.filter((item) => matchesJob(item, args.jobName));
    if (matched.length === 0) {
      throw new Error(`飞书待评估列表中没有匹配职位「${args.jobName}」；可见职位：${availableJobs.join('、') || '无'}`);
    }
    const target = matched.slice(args.offset, Number.isFinite(args.limit) ? args.offset + args.limit : undefined);
    const candidates = [];
    let noResume = 0;
    let cached = 0;
    for (let i = 0; i < target.length; i += 1) {
      const item = target[i];
      const talentId = item.talent_id;
      const applicationId = item.application_id;
      const cacheFile = path.join(args.outDir, `${talentId}-${applicationId}.json`);
      let record;
      if (existsSync(cacheFile)) {
        record = JSON.parse(readFileSync(cacheFile, 'utf8'));
        cached += 1;
      } else {
        const resume = await fetchJson(page, `${RESUME_URL}?talent_id=${encodeURIComponent(talentId)}&application_id=${encodeURIComponent(applicationId)}`);
        const attachment = resume?.data?.default_attachment;
        let text = '';
        if (attachment?.attachment_resume_id) {
          const detail = await fetchJson(page, `${RESUME_TEXT_URL}?talent_id=${encodeURIComponent(talentId)}&attachment_resume_id=${encodeURIComponent(attachment.attachment_resume_id)}`);
          const parsed = detail?.data?.parsed_content;
          if (parsed) text = toMarkdown(typeof parsed === 'string' ? JSON.parse(parsed) : parsed);
        }
        record = {
          name: item.talent?.name || '未知',
          job: item.job?.title || '',
          source_url: `https://guanghe.feishu.cn/hire/talent/${talentId}?application_id=${applicationId}`,
          text,
        };
        writeFileSync(cacheFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
      }
      if (record.text) candidates.push({ name: record.name, text: record.text, source_url: record.source_url });
      else noResume += 1;
      if ((i + 1) % 20 === 0) console.log(`采集进度 ${i + 1}/${target.length}`);
      await page.waitForTimeout(100);
    }

    const imported = args.import && candidates.length ? await importCandidates(args, candidates) : { imported: 0, skipped: 0, dispatched: 0 };
    return {
      ok: true,
      ...imported,
      collected: candidates.length,
      cached,
      no_resume: noResume,
      matched: matched.length,
      message: `职位「${args.jobName}」采集 ${candidates.length} 份，导入 ${imported.imported} 份，跳过 ${imported.skipped} 份，派发 ${imported.dispatched} 个分析任务`,
    };
  } finally {
    listInterceptor?.dispose();
    await context.close();
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    const result = await run(args);
    writeResult(args.resultFile, result);
    console.log(JSON.stringify(result));
  } catch (error) {
    const result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    writeResult(args?.resultFile, result);
    console.error(`ERR: ${result.error}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

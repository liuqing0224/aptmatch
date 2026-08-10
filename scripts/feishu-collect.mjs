#!/usr/bin/env node
/**
 * 飞书招聘简历批量采集（外置 Playwright 驱动）
 *
 * 用法：
 *   node scripts/feishu-collect.mjs --cookie-file <cookie.txt> [--limit 20] [--import] [--position-id <id>]
 *
 * 流程：
 *   1. 用 Cookie 启动外置 Playwright（headless Chromium），在页面主 realm 调飞书招聘 API
 *   2. list_v2 拉「待评估」候选人列表（分页）
 *   3. get_default_resume + get_attachment_resume_text_ext 拉每份简历解析全文
 *   4. 转成 Markdown 简历并输出到 out-dir（默认 /tmp/feishu_api）
 *   5. --import 时自动调用本地 AptMatch import-feishu 接口（≤100 条/批）
 *
 * Cookie 获取：登录飞书招聘后，在浏览器 DevTools 复制请求 Cookie 头保存为文本文件。
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const PLAYWRIGHT_ROOT = process.env.PLAYWRIGHT_ROOT ?? '/Users/l/Documents/gameLearn/';
const { chromium } = require(path.join(PLAYWRIGHT_ROOT, 'node_modules/playwright'));

const LIST_URL = 'https://guanghe.feishu.cn/atsx/api/evaluation/list_v2/';
const RESUME_URL = 'https://guanghe.feishu.cn/atsx/api/application/get_default_resume/';
const RESUME_TEXT_URL = 'https://guanghe.feishu.cn/atsx/api/application/get_attachment_resume_text_ext/';

function parseArgs(argv) {
  const out = { limit: Infinity, offset: 0, import: false, cookieFile: null, outDir: '/tmp/feishu_api', positionId: null, activityStatus: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cookie-file') out.cookieFile = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--offset') out.offset = Number(argv[++i]);
    else if (a === '--import') out.import = true;
    else if (a === '--position-id') out.positionId = argv[++i];
    else if (a === '--out-dir') out.outDir = argv[++i];
    else if (a === '--activity-status') out.activityStatus = Number(argv[++i]);
    else if (a === '--help') { console.log(usage()); process.exit(0); }
  }
  return out;
}
function usage() {
  return `用法: node scripts/feishu-collect.mjs --cookie-file <cookie.txt> [选项]
  --cookie-file <file>  会话 Cookie 文本（必填）
  --limit <n>           最多采集条数（默认全部）
  --offset <n>          从第几条开始（默认 0）
  --out-dir <dir>       输出目录（默认 /tmp/feishu_api）
  --import              采集后自动导入本地 AptMatch
  --position-id <id>    导入用职位 id（--import 时必填）
  --activity-status <n> 列表状态：0=待评估（默认）`;
}

const DEG = { 4: '高中', 5: '大专', 6: '本科', 7: '硕士', 8: '博士' };
const fmtDate = (s) => (s || '').slice(0, 10).replace(/-/g, '.');
function mdSection(title, lines) {
  const body = lines.filter(Boolean);
  return body.length ? `## ${title}\n${body.join('\n')}` : null;
}
function toMarkdown(pc) {
  const parts = [`# ${pc.name || '未命名'}`];
  const info = [];
  if (pc.age) info.push(`年龄：${pc.age}`);
  if (pc.gender) info.push(`性别：${pc.gender}`);
  if (pc.email) info.push(`邮箱：${pc.email}`);
  if (pc.mobile) info.push(`电话：${pc.mobile}`);
  if (pc.current_location) info.push(`现居：${pc.current_location}`);
  if (pc.experience_years) info.push(`工作年限：${pc.experience_years}年`);
  if (info.length) parts.push(`## 基本信息\n${info.join('；')}`);
  const edus = (pc.educations || []).map((e) => `- ${fmtDate(e.start_date)} ~ ${fmtDate(e.end_date)} | ${e.school} | ${e.major} | ${DEG[e.degree] || e.degree}`);
  const s = mdSection('教育背景', edus); if (s) parts.push(s);
  const careers = [];
  for (const c of pc.careers || []) {
    careers.push(`- ${fmtDate(c.start_date)} ~ ${fmtDate(c.end_date)} | ${c.company} | ${c.title}`);
    if (c.jd) careers.push(`  ${c.jd.replace(/\n/g, '\n  ')}`);
  }
  const s2 = mdSection('工作经历', careers); if (s2) parts.push(s2);
  const interns = [];
  for (const c of pc.intern_ships || []) {
    interns.push(`- ${fmtDate(c.start_date)} ~ ${fmtDate(c.end_date)} | ${c.company} | ${c.title}`);
    if (c.jd) interns.push(`  ${c.jd.replace(/\n/g, '\n  ')}`);
  }
  const s3 = mdSection('实习经历', interns); if (s3) parts.push(s3);
  const projs = [];
  for (const p of pc.project_list || []) {
    projs.push(`- ${p.name || ''} ${p.role || ''} ${fmtDate(p.start_date)}~${fmtDate(p.end_date)}`);
    if (p.description) projs.push(`  ${p.description.replace(/\n/g, '\n  ')}`);
  }
  const s4 = mdSection('项目经历', projs); if (s4) parts.push(s4);
  const extras = [];
  if (pc.self_evaluation) extras.push(`自我评价：${pc.self_evaluation}`);
  if (pc.skills) extras.push(`技能：${pc.skills}`);
  for (const name of ['award_list', 'certificate_list', 'competition_list', 'language_list']) {
    const vals = pc[name] || [];
    if (vals.length) {
      const joined = vals.map((v) => (typeof v === 'string' ? v : v.name || v.description || JSON.stringify(v))).join('；');
      extras.push(`${name.replace('_list', '')}：${joined}`);
    }
  }
  const s5 = mdSection('其他', extras); if (s5) parts.push(s5);
  if (pc.content) parts.push(`## 简历原文\n${pc.content}`);
  return parts.join('\n\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.cookieFile || !existsSync(args.cookieFile)) {
    console.error('缺少 --cookie-file 或文件不存在');
    console.error(usage());
    process.exit(1);
  }
  mkdirSync(args.outDir, { recursive: true });
  const cookieStr = readFileSync(args.cookieFile, 'utf8').trim();
  const cookies = cookieStr.split(';').map((pair) => {
    const idx = pair.indexOf('=');
    return { name: pair.slice(0, idx).trim(), value: pair.slice(idx + 1).trim(), domain: '.feishu.cn', path: '/' };
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    });
    await ctx.addCookies(cookies);
    const page = await ctx.newPage();
    await page.goto('https://guanghe.feishu.cn/hire/application-biz/evaluation/list', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    const apiCall = async (url) =>
      await page.evaluate(async (u) => {
        const r = await fetch(u, { method: 'GET', headers: { accept: 'application/json' } });
        return await r.json();
      }, url);

    // 1) 列表
    const listAll = [];
    let offset = 0;
    for (;;) {
      const body = JSON.stringify({ q: '', filters: '{}', activity_status: args.activityStatus, offset, limit: 20 });
      const resp = await page.evaluate(async (b) => {
        const r = await fetch('/atsx/api/evaluation/list_v2/', {
          method: 'POST', headers: { 'content-type': 'application/json;charset=UTF-8' }, body: b,
        });
        return await r.json();
      }, body);
      if (!resp?.success) throw new Error(`list_v2 失败: ${JSON.stringify(resp).slice(0, 200)}`);
      const items = resp.data.evaluation_list;
      listAll.push(...items);
      const total = resp.data.count || 0;
      if (items.length < 20 || listAll.length >= total) break;
      offset += 20;
      await page.waitForTimeout(120);
    }
    console.log(`列表：共 ${listAll.length} 条`);

    // 2) 简历
    const slice = args.offset === 0 ? listAll : listAll.slice(args.offset, args.offset + args.limit);
    const target = slice.slice(0, args.limit);
    const results = [];
    let noResume = 0;
    for (let i = 0; i < target.length; i++) {
      const it = target[i];
      const tid = it.talent_id, aid = it.application_id;
      const fname = path.join(args.outDir, `${tid}.json`);
      if (existsSync(fname)) { results.push({ i, tid, cached: true }); continue; }
      const def = await apiCall(`${RESUME_URL}?talent_id=${tid}&application_id=${aid}`);
      const att = def?.data?.default_attachment;
      let text = '';
      if (att?.attachment_resume_id) {
        const ext = await apiCall(`${RESUME_TEXT_URL}?talent_id=${tid}&attachment_resume_id=${att.attachment_resume_id}`);
        const pc = ext?.data?.parsed_content;
        if (pc) {
          const parsed = typeof pc === 'string' ? JSON.parse(pc) : pc;
          text = toMarkdown(parsed);
        }
      }
      if (!text) noResume++;
      writeFileSync(fname, JSON.stringify({
        name: it.talent?.name || '未知', job: it.job?.title, resume_name: att?.name || null, has_resume: !!text,
        talent_id: tid, application_id: aid,
        source_url: `https://guanghe.feishu.cn/hire/talent/${tid}?application_id=${aid}`,
        text,
      }, null, 1));
      results.push({ i, tid, name: it.talent?.name, len: text.length });
      if ((i + 1) % 20 === 0) console.log(`进度 ${i + 1}/${target.length}`);
      await page.waitForTimeout(120);
    }
    console.log(`采集完成：${results.filter((r) => !r.cached).length} 份新简历，无简历 ${noResume} 份，缓存跳过 ${results.filter((r) => r.cached).length} 份`);

    // 3) 可选导入
    if (args.import) {
      if (!args.positionId) throw new Error('--import 需要 --position-id');
      const cands = results
        .filter((r) => !r.cached)
        .map((r) => {
          const d = JSON.parse(readFileSync(path.join(args.outDir, `${r.tid}.json`), 'utf8'));
          return { name: d.name, text: d.text, source_url: d.source_url };
        });
      for (let i = 0; i < cands.length; i += 100) {
        const batch = cands.slice(i, i + 100);
        const body = JSON.stringify({ position_id: args.positionId, candidates: batch });
        const resp = await fetch('http://127.0.0.1:8787/api/candidates/import-feishu', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body,
        }).then((r) => r.json());
        console.log(`导入 ${i / 100 + 1}: ${resp.message ?? JSON.stringify(resp)}`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });

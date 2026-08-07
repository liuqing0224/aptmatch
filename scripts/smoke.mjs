/**
 * 端到端冒烟测试：真实启动 server，走完 上传简历 → 添加公司 → 派发任务 → 等待报告 → 校验结果。
 *
 * 用法：
 *   node scripts/smoke.mjs            # 真实调用本地 codex agent（需要 codex CLI 与网络）
 *   SMOKE_MOCK=1 node scripts/smoke.mjs  # 使用 mock runner（CI / 无 codex 环境）
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.SMOKE_PORT ?? 8899);
const USE_MOCK = process.env.SMOKE_MOCK === '1';
const RESUME_TEXT = `张三
前端工程师，5 年工作经验
技能：React、TypeScript、Node.js、CSS
工作经历：
- 2021-2026 某电商公司 高级前端工程师：负责订单后台搭建与重构，性能优化 40%
- 2018-2021 某创业公司 前端工程师：负责 H5 活动页开发
项目：数据可视化大屏、组件库建设
`;
const JD_TEXT = `高级前端工程师（数据中台方向）
岗位职责：
- 负责数据中台前端架构设计与开发
- 主导组件库建设与前端工程化
任职要求：
- 5 年以上前端经验，精通 React、TypeScript
- 熟悉 Node.js，有组件库/工程化经验优先
- 自驱、抗压、结果导向
`;

const dataDir = mkdtempSync(path.join(tmpdir(), 'jfm-smoke-'));
console.log(`[smoke] dataDir=${dataDir} mock=${USE_MOCK}`);

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    RUNNER: USE_MOCK ? 'mock' : '',
    PORT: String(PORT),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', (d) => (serverOutput += d));
server.stderr.on('data', (d) => (serverOutput += d));

const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      /* 尚未就绪 */
    }
    await sleep(300);
  }
  throw new Error(`server 启动超时\n${serverOutput}`);
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${url} -> ${data.error ?? res.status}`);
  return data;
}

function assert(cond, msg) {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

let failed = false;
try {
  await waitHealth();
  console.log('[smoke] server 就绪');

  const agents = await (await fetch(`${base}/api/agents`)).json();
  assert(agents.agents.length >= 1, '默认 agent 已创建');
  const agentId = agents.agents[0].id;

  const fd = new FormData();
  fd.append('name', '张三');
  fd.append('text', RESUME_TEXT);
  const resumeRes = await fetch(`${base}/api/resumes`, { method: 'POST', body: fd });
  const { resume } = await resumeRes.json();
  assert(resumeRes.ok && resume.id, '简历创建成功');
  console.log('[smoke] 简历已创建');

  const cd = new FormData();
  cd.append('name', '示例科技');
  cd.append('industry', '互联网');
  cd.append('stage', '成长');
  cd.append('url', 'https://example.com');
  cd.append('jd_text', JD_TEXT);
  const companyRes = await fetch(`${base}/api/companies`, { method: 'POST', body: cd });
  const { company } = await companyRes.json();
  assert(companyRes.ok && company.id, '公司创建成功');
  console.log('[smoke] 公司与 JD 已创建');

  const { task } = await postJson(`${base}/api/tasks`, {
    agent_id: agentId,
    resume_id: resume.id,
    company_id: company.id,
    mode: 'fit',
  });
  console.log(`[smoke] 任务已派发：${task.id}`);

  const deadline = Date.now() + (USE_MOCK ? 60_000 : 8 * 60_000);
  let done = null;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/tasks/${task.id}`);
    const { task: t } = await res.json();
    if (t.status === 'done') {
      done = t;
      break;
    }
    if (t.status === 'failed' || t.status === 'cancelled') {
      throw new Error(`任务失败：${t.error}`);
    }
    await sleep(3000);
  }
  if (!done) throw new Error('任务超时');

  const r = done.result;
  assert(typeof r.overall_score === 'number' && r.overall_score >= 0 && r.overall_score <= 100, 'overall_score 合法');
  assert(['S', 'A', 'B', 'C', 'D'].includes(r.grade), 'grade 合法');
  assert(r.dimensions.length === 10, '十维齐全');
  const weightSum = r.dimensions.reduce((s, d) => s + d.weight, 0);
  assert(Math.abs(weightSum - 100) <= 1, '权重之和为 100');
  assert(typeof r.summary === 'string' && r.summary.length > 0, 'summary 存在');
  console.log(`[smoke] 报告完成：${r.overall_score} 分（${r.grade}）`);

  const matches = await (await fetch(`${base}/api/matches`)).json();
  assert(matches.matches.length === 1, 'matches 可查');
  console.log(`[smoke] 对比数据 OK：${matches.matches[0].company_name}`);
  console.log('[smoke] ✅ 全部通过');
} catch (err) {
  failed = true;
  console.error('[smoke] ❌', err.message);
  if (serverOutput) console.error(serverOutput.slice(-2000));
} finally {
  server.kill('SIGTERM');
  setTimeout(() => process.exit(failed ? 1 : 0), 500);
}

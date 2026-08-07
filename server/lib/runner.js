import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { taskLogPath, taskWorkspace } from './paths.js';
import { buildCommand } from './providers.js';
import { validateReport, validateCrawlResults } from './validate.js';
import { appendLearnings, agentDir, readAgentProfile, skillsDir } from './agentfs.js';
import { rowById } from '../db.js';
import { CRAWL_AGENTS_MD, parseCrawlParams, buildCrawlPrompt } from './crawl.js';

const USE_MOCK = process.env.RUNNER === 'mock';
const OUTPUT_FILE = (task) =>
  task.mode === 'crawl' ? path.join('output', 'crawl_results.json') : path.join('output', 'report.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TaskRunner {
  constructor({ db, getSettings }) {
    this.db = db;
    this.getSettings = getSettings;
    this.running = new Map(); // taskId -> { child, cancelled }
  }

  async run(task) {
    const ws = taskWorkspace(task.id);
    try {
      fs.rmSync(ws, { recursive: true, force: true });
      fs.mkdirSync(path.join(ws, 'input'), { recursive: true });
      fs.mkdirSync(path.join(ws, 'output'), { recursive: true });
      fs.mkdirSync(path.dirname(taskLogPath(task.id)), { recursive: true });
      this.writeInputs(task, ws);

      const settings = this.getSettings();
      if (USE_MOCK) {
        await this.runMock(task, ws);
        return;
      }
      await this.runProvider(task, ws, settings);
    } catch (err) {
      this.finish(task.id, 'failed', null, `运行出错：${err.message}`);
    }
  }

  writeInputs(task, ws) {
    const resume = task.resume_id ? rowById(this.db, 'resumes', task.resume_id) : null;
    const company = task.company_id ? rowById(this.db, 'companies', task.company_id) : null;

    fs.writeFileSync(path.join(ws, 'input', 'resume.md'), resume?.text ?? '（未提供简历）', 'utf8');
    fs.writeFileSync(path.join(ws, 'input', 'jd.md'), company?.jd_text ?? '（未提供职位描述）', 'utf8');
    const companyMd = [
      `# ${company?.name ?? '未知公司'}`,
      `- 行业：${company?.industry || '未提供'}`,
      `- 阶段：${company?.stage || '未提供'}`,
      `- 官网/链接：${company?.url || '未提供'}`,
    ].join('\n');
    fs.writeFileSync(path.join(ws, 'input', 'company.md'), companyMd, 'utf8');

    if (task.parent_task_id) {
      const parent = rowById(this.db, 'tasks', task.parent_task_id);
      if (parent?.result) {
        fs.writeFileSync(
          path.join(ws, 'input', 'previous_report.json'),
          parent.result,
          'utf8'
        );
      }
    }

    if (task.agent_id) {
      const agent = rowById(this.db, 'agents', task.agent_id);
      if (agent) {
        const profile = task.mode === 'crawl' ? CRAWL_AGENTS_MD : readAgentProfile(agent.slug);
        fs.writeFileSync(path.join(ws, 'AGENTS.md'), profile || '# 角色：契合度分析师\n', 'utf8');
        const src = skillsDir(agent.slug);
        const dst = path.join(ws, 'skills');
        fs.mkdirSync(dst, { recursive: true });
        if (fs.existsSync(src)) {
          for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.md'))) {
            fs.copyFileSync(path.join(src, f), path.join(dst, f));
          }
        }
      }
    }

    if (task.mode === 'crawl') {
      const p = parseCrawlParams(task.extra_prompt);
      fs.writeFileSync(
        path.join(ws, 'input', 'task.md'),
        [
          '# 采集任务',
          `- 关键词：${p.keyword}`,
          `- 城市：${p.city}`,
          `- 目标数量：${p.limit} 条`,
          '- 用途：为「简历 × 公司契合度分析」提供真实岗位 JD',
        ].join('\n'),
        'utf8'
      );
      fs.writeFileSync(path.join(ws, 'prompt.txt'), buildCrawlPrompt(p), 'utf8');
      return;
    }

    const prompt = buildPrompt(task, { resume, company });
    fs.writeFileSync(path.join(ws, 'prompt.txt'), prompt, 'utf8');
  }

  async runProvider(task, ws, settings) {
    const agent = task.agent_id ? rowById(this.db, 'agents', task.agent_id) : null;
    const provider = agent?.provider || settings.defaultProvider;
    const prompt = fs.readFileSync(path.join(ws, 'prompt.txt'), 'utf8');
    const { cmd, args, cwd } = buildCommand(provider, {
      workspace: ws,
      prompt,
      model: agent?.model || undefined,
    });

    const logPath = taskLogPath(task.id);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    logStream.write(`[${new Date().toISOString()}] $ ${cmd} ${args.join(' ')}\n`);

    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      logStream.end();
      this.finish(task.id, 'failed', null, `无法启动 ${provider} CLI：${err.message}`);
      return;
    }

    child.stdout.on('data', (d) => logStream.write(d));
    child.stderr.on('data', (d) => logStream.write(d));

    this.running.set(task.id, { child, cancelled: false });
    this.db.prepare('UPDATE tasks SET pid = ? WHERE id = ?').run(child.pid, task.id);

    const timeoutMs = (settings.timeoutMinutes || 10) * 60 * 1000;
    const deadline = Date.now() + timeoutMs;
    const entry = () => this.running.get(task.id);

    let outcome = null; // { kind: 'report'|'timeout'|'cancelled'|'exited', report? }
    while (true) {
      if (entry()?.cancelled) {
        outcome = { kind: 'cancelled' };
        break;
      }
      const rp = path.join(ws, OUTPUT_FILE(task));
      if (fs.existsSync(rp)) {
        let report = null;
        try {
          report = JSON.parse(fs.readFileSync(rp, 'utf8'));
        } catch (e) {
          outcome = { kind: 'badjson', message: e.message };
          break;
        }
        outcome = { kind: 'report', report };
        break;
      }
      if (Date.now() > deadline) {
        outcome = { kind: 'timeout' };
        break;
      }
      if (child.exitCode !== null) {
        outcome = { kind: 'exited', code: child.exitCode };
        break;
      }
      await sleep(1500);
    }

    if (outcome.kind === 'timeout' || outcome.kind === 'cancelled') {
      this.killGroup(child);
    }
    await sleep(200); // let log flush
    logStream.end();

    this.running.delete(task.id);

    if (outcome.kind === 'report') {
      const v = task.mode === 'crawl' ? validateCrawlResults(outcome.report) : validateReport(outcome.report);
      if (!v.ok) {
        this.finish(task.id, 'failed', null, `报告 schema 校验失败：${v.errors.slice(0, 8).join('；')}`);
        return;
      }
      if (task.agent_id) {
        const agentRow = rowById(this.db, 'agents', task.agent_id);
        if (agentRow) appendLearnings(agentRow.slug, v.report.learnings ?? []);
      }
      this.finish(task.id, 'done', v.report, '');
      return;
    }
    if (outcome.kind === 'timeout') {
      this.finish(task.id, 'failed', null, `任务超时（超过 ${settings.timeoutMinutes} 分钟）`);
      return;
    }
    if (outcome.kind === 'cancelled') {
      this.finish(task.id, 'cancelled', null, '用户取消');
      return;
    }
    if (outcome.kind === 'badjson') {
      this.finish(task.id, 'failed', null, `report.json 不是合法 JSON：${outcome.message}`);
      return;
    }
    this.finish(task.id, 'failed', null, `agent 进程退出（code=${outcome.code}）但未产出 report.json，请查看日志`);
  }

  async runMock(task, ws) {
    const report = {
      schema_version: 1,
      summary: '模拟运行：材料齐全，整体匹配度良好，建议进入面试流程。',
      overall_score: 78,
      grade: 'A',
      dimensions: [
        { key: 'hard_skills', label: '硬技能', score: 82, weight: 20, reason: '核心技能与 JD 要求基本重合。', evidence: ['模拟证据'] },
        { key: 'experience', label: '经验与行业背景', score: 75, weight: 14, reason: '年限接近，行业经验部分相关。', evidence: ['模拟证据'] },
        { key: 'responsibilities', label: '岗位职责', score: 70, weight: 13, reason: '过往职责覆盖大部分岗位要求。', evidence: ['模拟证据'] },
        { key: 'gate', label: '硬性门槛与资质', score: 85, weight: 14, reason: '学历与年限硬要求均达标。', evidence: ['模拟证据'] },
        { key: 'tech_direction', label: '技术方向与深度', score: 78, weight: 12, reason: '技术方向与岗位一致。', evidence: ['模拟证据'] },
        { key: 'compensation', label: '薪资与职级', score: 74, weight: 8, reason: '薪资区间与职级大致匹配。', evidence: ['模拟证据'] },
        { key: 'culture', label: '文化价值观与工作强度', score: 80, weight: 8, reason: '价值观关键词匹配度较高。', evidence: ['模拟证据'] },
        { key: 'stability', label: '稳定性与成长空间', score: 76, weight: 6, reason: '履历稳定性正常。', evidence: ['模拟证据'] },
        { key: 'company_health', label: '公司经营与赛道风险', score: 80, weight: 3, reason: '公开信息未见明显风险。', evidence: ['模拟证据'] },
        { key: 'preference', label: '个人偏好契合', score: 85, weight: 2, reason: '公司阶段与个人偏好一致。', evidence: ['模拟证据'] },
      ],
      matched: ['技能A', '技能B'],
      gaps: [{ item: '缺少某技能', severity: 'low', mitigation: '面试前快速学习并准备案例' }],
      strengths: ['项目经验完整'],
      risks: [],
      questions: [{ question: '团队对该岗位的成长路径？', why: '确认发展空间' }],
      suggestions: ['突出项目成果数据'],
      research: [],
      learnings: [],
    };
    fs.writeFileSync(path.join(ws, OUTPUT_FILE(task)), JSON.stringify(report, null, 2), 'utf8');
    this.finish(task.id, 'done', report, '');
  }

  cancel(taskId) {
    const entry = this.running.get(taskId);
    if (entry) {
      entry.cancelled = true;
      this.killGroup(entry.child);
      return true;
    }
    return false;
  }

  killGroup(child) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        /* 已退出 */
      }
    }
  }

  finish(taskId, status, result, error) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE tasks SET status = ?, result = ?, error = ?, finished_at = ? WHERE id = ?`
      )
      .run(status, result ? JSON.stringify(result) : null, error, now, taskId);
  }
}

export function buildPrompt(task, { resume, company }) {
  const parts = [];
  if (task.mode === 'crawl') {
    parts.push(
      `任务：采集与「${parseCrawlParams(task.extra_prompt).keyword}」相关的真实岗位 JD。`,
      '请严格阅读并遵守工作区中的 AGENTS.md（采集员角色与输出 schema）。',
      '把最终结果写入 output/crawl_results.json（UTF-8，合法 JSON，schema_version=1）。',
      '不要修改工作区外的任何文件。'
    );
  } else if (task.mode === 'followup') {
    parts.push(
      '你正在对上一次「契合度分析」进行追问。请阅读 input/previous_report.json（上一次报告）与 input/ 下的材料，',
      '针对用户的新问题重新分析，仍按 AGENTS.md 的要求把完整报告写入 output/report.json（可部分沿用上次结论，但必须针对新问题更新）。',
      `用户追问：${task.extra_prompt || '（无附加说明）'}`
    );
  } else {
    parts.push(
      `任务：分析候选人（input/resume.md）与「${company?.name || '目标公司'}」招聘岗位（input/jd.md、input/company.md）的契合度。`
    );
    if (task.mode === 'research') {
      parts.push('模式：深度调研——请重点联网调研公司并展开分析。');
    }
    if (task.extra_prompt) {
      parts.push(`候选人附加要求：${task.extra_prompt}`);
    }
  }
  parts.push(
    '请严格阅读并遵守工作区中的 AGENTS.md（角色、评分准则与输出 schema）。',
    '把最终报告写入 output/report.json（UTF-8，合法 JSON，schema_version=1）。',
    '不要修改工作区外的任何文件。'
  );
  return parts.join('\n\n');
}

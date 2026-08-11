import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { taskLogPath, taskWorkspace } from './paths.js';
import { buildCommand } from './providers.js';
import { validateReport, validateCrawlResults, validateInterviewTurn } from './validate.js';
import { appendLearnings, agentDir, readAgentProfile, skillsDir } from './agentfs.js';
import { rowById } from '../db.js';
import { emitTaskChanged } from './serialize.js';
import { CRAWL_AGENTS_MD, parseCrawlParams, buildCrawlPrompt } from './crawl.js';
import { INTERVIEW_AGENTS_MD, parseInterviewParams, buildInterviewPrompt } from './interview.js';

const USE_MOCK = process.env.RUNNER === 'mock';
const OUTPUT_FILE = (task) =>
  task.mode === 'crawl'
    ? path.join('output', 'crawl_results.json')
    : task.mode === 'collect'
      ? path.join('output', 'collect_result.json')
      : path.join('output', 'report.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TaskRunner {
  constructor({ db, getSettings, hub = null }) {
    this.db = db;
    this.getSettings = getSettings;
    this.hub = hub;
    this.running = new Map(); // taskId -> { child, cancelled }
  }

  async run(task) {
    const ws = taskWorkspace(task.id);
    try {
      fs.rmSync(ws, { recursive: true, force: true });
      fs.mkdirSync(path.join(ws, 'input'), { recursive: true });
      fs.mkdirSync(path.join(ws, 'output'), { recursive: true });
      fs.mkdirSync(path.dirname(taskLogPath(task.id)), { recursive: true });

      const settings = this.getSettings();
      this.writeInputs(task, ws, settings);
      if (USE_MOCK) {
        await this.runMock(task, ws);
        return;
      }
      await this.runProvider(task, ws, settings);
    } catch (err) {
      this.finish(task.id, 'failed', null, `运行出错：${err.message}`);
    }
  }

  writeInputs(task, ws, settings = {}) {
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

    if (task.mode === 'interview') {
      fs.writeFileSync(
        path.join(ws, 'input', 'interview_history.md'),
        buildInterviewHistory(this.db, task),
        'utf8'
      );
    }

    if (task.agent_id) {
      const agent = rowById(this.db, 'agents', task.agent_id);
      if (agent) {
        const profile =
          task.mode === 'crawl'
            ? CRAWL_AGENTS_MD
            : task.mode === 'interview'
              ? INTERVIEW_AGENTS_MD
              : readAgentProfile(agent.slug);
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

    if (task.mode === 'collect') {
      const position = rowById(this.db, 'companies', task.company_id);
      fs.writeFileSync(path.join(ws, 'prompt.txt'), buildCollectPrompt(task, { position, settings }), 'utf8');
      return;
    }

    const prompt = buildPrompt(task, { resume, company });
    fs.writeFileSync(path.join(ws, 'prompt.txt'), prompt, 'utf8');
  }

  async runProvider(task, ws, settings) {
    const agent = task.agent_id ? rowById(this.db, 'agents', task.agent_id) : null;
    const provider = agent?.provider || settings.defaultProvider;
    const model = agent?.model || undefined;
    let prompt = fs.readFileSync(path.join(ws, 'prompt.txt'), 'utf8');

    // 校验失败自愈：最多额外重跑一次，把 schema 错误注入工作区让 agent 修正后再判成败
    const selfHealLimit = 1;
    for (let heal = 0; heal <= selfHealLimit; heal++) {
      const { cmd, args, cwd } = buildCommand(provider, { workspace: ws, prompt, model });
      const outcome = await this.runOnce(task, ws, settings, { cmd, args, cwd, provider });
      if (outcome.kind !== 'report') return; // timeout/cancelled/badjson/exited 已在 runOnce 内收尾

      if (task.mode === 'collect') {
        const summary = outcome.report ?? {};
        const ok = summary.ok === true;
        this.finish(task.id, ok ? 'done' : 'failed', summary, ok ? '' : summary.error || '采集未成功');
        return;
      }

      const v =
        task.mode === 'crawl'
          ? validateCrawlResults(outcome.report)
          : task.mode === 'interview'
            ? validateInterviewTurn(outcome.report)
            : validateReport(outcome.report);
      if (v.ok) {
        if (task.agent_id) {
          const agentRow = rowById(this.db, 'agents', task.agent_id);
          if (agentRow) appendLearnings(agentRow.slug, v.report.learnings ?? []);
        }
        this.finish(task.id, 'done', v.report, '');
        return;
      }

      if (heal < selfHealLimit) {
        const outFile = OUTPUT_FILE(task);
        const errors = v.errors.slice(0, 8).join('；');
        fs.writeFileSync(
          path.join(ws, 'input', 'validation_errors.txt'),
          [
            `# 上一份 ${outFile} 未通过 schema 校验`,
            `错误：${errors}`,
            `请阅读错误后，把修正后的完整报告重新写入 ${outFile}（UTF-8，合法 JSON）。`,
          ].join('\n'),
          'utf8'
        );
        // 清除上一份非法输出，确保自愈重跑不会误读旧文件
        fs.rmSync(path.join(ws, outFile), { force: true });
        prompt = [
          prompt,
          '',
          `【校验未通过，请修正】你上一份 ${outFile} 不符合输出 schema，错误已写入 input/validation_errors.txt。请阅读后修正，把完整报告重新写入 ${outFile}。`,
        ].join('\n\n');
        continue;
      }
      this.finish(task.id, 'failed', null, `报告 schema 校验失败：${v.errors.slice(0, 8).join('；')}`);
      return;
    }
  }

  // 单次调用 provider CLI，监控直到产出报告/超时/取消/退出，并完成非 report 结局的收尾
  async runOnce(task, ws, settings, { cmd, args, cwd, provider }) {
    const logPath = taskLogPath(task.id);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    logStream.write(`[${new Date().toISOString()}] $ ${cmd} ${args.join(' ')}\n`);
    const streamLog = (chunk) => {
      const data = chunk.toString('utf8');
      if (this.hub) this.hub.emit('log', { taskId: task.id, data });
    };

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
      return { kind: 'exited', code: -1 };
    }

    child.stdout.on('data', (d) => {
      logStream.write(d);
      streamLog(d);
    });
    child.stderr.on('data', (d) => {
      logStream.write(d);
      streamLog(d);
    });

    this.running.set(task.id, { child, cancelled: false });
    this.db.prepare('UPDATE tasks SET pid = ? WHERE id = ?').run(child.pid, task.id);

    // 采集任务涉及飞书分页拉取与批量导入，给予更宽松的超时
    const baseMinutes = settings.timeoutMinutes || 10;
    const timeoutMs = (task.mode === 'collect' ? Math.max(baseMinutes, 30) : baseMinutes) * 60 * 1000;
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

    // 报告已产出也要结束进程，避免自愈重跑时两个 agent 同时写 output
    if (outcome.kind === 'timeout' || outcome.kind === 'cancelled' || outcome.kind === 'report') {
      this.killGroup(child);
    }
    await sleep(200); // let log flush
    logStream.end();

    this.running.delete(task.id);

    if (outcome.kind === 'timeout') {
      this.finish(task.id, 'failed', null, `任务超时（超过 ${settings.timeoutMinutes} 分钟）`);
      return { kind: 'finished' };
    }
    if (outcome.kind === 'cancelled') {
      this.finish(task.id, 'cancelled', null, '用户取消');
      return { kind: 'finished' };
    }
    if (outcome.kind === 'badjson') {
      this.finish(task.id, 'failed', null, `report.json 不是合法 JSON：${outcome.message}`);
      return { kind: 'finished' };
    }
    if (outcome.kind === 'exited') {
      this.finish(task.id, 'failed', null, `agent 进程退出（code=${outcome.code}）但未产出 report.json，请查看日志`);
      return { kind: 'finished' };
    }
    return outcome; // { kind: 'report', report }
  }

  async runMock(task, ws) {
    if (task.mode === 'collect') {
      const summary = {
        ok: true,
        imported: 0,
        skipped: 0,
        dispatched: 0,
        message: '模拟采集：未真实连接飞书（RUNNER=mock）',
      };
      fs.writeFileSync(path.join(ws, OUTPUT_FILE(task)), JSON.stringify(summary, null, 2), 'utf8');
      this.finish(task.id, 'done', summary, '');
      return;
    }
    if (task.mode === 'interview') {
      const p = parseInterviewParams(task.extra_prompt);
      const finished = p.round >= p.maxRounds;
      const report = {
        schema_version: 1,
        type: 'interview_turn',
        round: p.round,
        question: finished
          ? ''
          : `第 ${p.round} 轮问题：请结合项目讲讲你如何解决高并发问题？`,
        evaluation: p.answer ? `回答思路清晰，但缺少量化数据支撑（第 ${p.round} 轮点评），建议补充指标。` : '',
        hint: '用 STAR 法则组织回答，突出量化结果。',
        finished,
        overall_assessment: finished ? '模拟面试完成：整体表现良好，重点补充项目量化成果。' : '',
        learnings: [],
      };
      fs.writeFileSync(path.join(ws, OUTPUT_FILE(task)), JSON.stringify(report, null, 2), 'utf8');
      this.finish(task.id, 'done', report, '');
      return;
    }
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
    if (status === 'done' && result) {
      this.syncCandidateResult(taskId, result);
    }
    const updated = rowById(this.db, 'tasks', taskId);
    if (updated) emitTaskChanged(this.hub, this.db, updated);
  }

  // 招聘端：fit 任务完成时把评分/等级/摘要写回候选人，并把「待筛」推进为「已筛」
  syncCandidateResult(taskId, report) {
    const task = rowById(this.db, 'tasks', taskId);
    if (!task?.resume_id || !task?.company_id || typeof report?.overall_score !== 'number') return;
    const position = rowById(this.db, 'companies', task.company_id);
    if (!position || position.kind !== 'position') return;
    this.db
      .prepare(
        `UPDATE candidates
         SET overall_score = ?, grade = ?, summary = ?,
             status = CASE WHEN status = '待筛' THEN '已筛' ELSE status END,
             updated_at = ?
         WHERE resume_id = ? AND position_id = ?`
      )
      .run(
        report.overall_score,
        report.grade ?? '',
        report.summary ?? '',
        new Date().toISOString(),
        task.resume_id,
        task.company_id
      );
  }
}

// 沿 parent_task_id 链回溯，汇总此前所有 interview 轮次的提问/回答/点评
export function buildInterviewHistory(db, task) {
  const turns = [];
  let cur = task.parent_task_id ? rowById(db, 'tasks', task.parent_task_id) : null;
  while (cur) {
    if (cur.mode === 'interview' && cur.result) {
      try {
        const r = JSON.parse(cur.result);
        const p = parseInterviewParams(cur.extra_prompt);
        turns.unshift({ round: r.round, question: r.question, answer: p.answer, evaluation: r.evaluation });
      } catch {
        /* 忽略非法轮次 */
      }
    }
    cur = cur.parent_task_id ? rowById(db, 'tasks', cur.parent_task_id) : null;
  }
  if (turns.length === 0) return '';
  const lines = ['# 模拟面试历史', ''];
  for (const t of turns) {
    lines.push(`## 第 ${t.round} 轮`, '');
    lines.push(`面试官提问：${t.question}`, '');
    if (t.answer) lines.push(`候选人回答：${t.answer}`, '');
    if (t.evaluation) lines.push(`面试官点评：${t.evaluation}`, '');
    lines.push('');
  }
  return lines.join('\n').trim();
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
  } else if (task.mode === 'interview') {
    parts.push(
      buildInterviewPrompt(parseInterviewParams(task.extra_prompt), task.title)
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

export function buildCollectPrompt(task, { position, settings = {} }) {
  const positionId = task.company_id ?? '';
  const name = position?.name || '未知职位';
  const skillDir = String(settings?.collectSkillDir ?? '').trim();
  const cookiePath = String(settings?.collectCookiePath ?? '').trim() || '/tmp/feishu_cookies.txt';
  const skillMd = skillDir
    ? path.join(skillDir, 'SKILL.md')
    : '（未配置，请在设置页填写 feishu-recruit-collect skill 目录）';
  const scriptPath = skillDir
    ? path.join(skillDir, 'scripts', 'feishu-collect.mjs')
    : 'feishu-collect.mjs（未找到 skill 目录，需先在设置页配置）';
  return [
    '任务：通过 feishu-recruit-collect skill 为 AptMatch 招聘端执行飞书招聘候选人采集，并自动导入。',
    '',
    `背景：目标职位「${name}」（position_id=${positionId}）；AptMatch 服务运行在 http://127.0.0.1:8787。`,
    `请先阅读 ${skillMd}，按其流程与约束执行。`,
    '',
    '执行步骤：',
    `1. 检查 Cookie 文件 ${cookiePath} 是否存在；不存在则停止，写入 output/collect_result.json：`,
    `   {"ok":false,"error":"缺少飞书 Cookie 文件 ${cookiePath}，请先在浏览器登录飞书招聘并复制 Cookie 头"}`,
    `2. 运行采集脚本（必须带 --import --position-id ${positionId}）：`,
    `   node ${scriptPath} \\`,
    `     --cookie-file ${cookiePath} --out-dir /tmp/feishu_api \\`,
    `     --import --position-id ${positionId}`,
    '3. 若脚本报 Cookie 失效（list_v2 返回 code!=0 或网络错误）：停止并写入 output/collect_result.json：',
    `   {"ok":false,"error":"飞书 Cookie 已失效，请在浏览器重新登录并复制 Cookie 头到 ${cookiePath}"}`,
    '4. 采集并导入成功后，汇总写入 output/collect_result.json：',
    '   {"ok":true,"imported":<数量>,"skipped":<跳过数>,"dispatched":<派发的筛选任务数>,"message":"一句中文总结"}',
    '',
    '约束：',
    '- 只读采集，不要修改飞书侧任何候选人状态。',
    '- 脚本输出目录 /tmp/feishu_api 已有缓存会自动跳过；导入接口按 source_url 去重，不要重复导入。',
    '- 不要修改仓库内任何源码文件，不要执行 git 提交。',
  ].join('\n');
}

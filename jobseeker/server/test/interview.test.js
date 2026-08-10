import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { openDb } from '../db.js';
import { buildInterviewHistory } from '../lib/runner.js';
import { parseInterviewParams, buildInterviewPrompt } from '../lib/interview.js';
import { taskWorkspace } from '../lib/paths.js';

function insertInterviewTask(db, id, round, answer, parentId, result) {
  db.prepare(
    `INSERT INTO tasks (id, title, mode, parent_task_id, extra_prompt, result, status, created_at)
     VALUES (?, ?, 'interview', ?, ?, ?, 'done', ?)`
  ).run(
    id,
    `模拟面试 ${round}`,
    parentId,
    JSON.stringify({ round, answer, max_rounds: 5 }),
    result ? JSON.stringify(result) : null,
    new Date().toISOString()
  );
}

describe('buildInterviewHistory', () => {
  it('回溯 parent 链汇总历史，root 的 fit 报告不进入面试历史', () => {
    const db = openDb(':memory:');
    // root: fit 任务
    db.prepare(
      `INSERT INTO tasks (id, title, mode, status, created_at) VALUES ('fit1', '契合度：张三 × A', 'fit', 'done', ?)`
    ).run(new Date().toISOString());

    const t1 = { schema_version: 1, type: 'interview_turn', round: 1, question: '自我介绍', evaluation: '', hint: '', finished: false, overall_assessment: '', learnings: [] };
    const t2 = { schema_version: 1, type: 'interview_turn', round: 2, question: '项目深挖', evaluation: '回答清晰', hint: '补数据', finished: false, overall_assessment: '', learnings: [] };

    insertInterviewTask(db, 'iv1', 1, '', 'fit1', t1);
    insertInterviewTask(db, 'iv2', 2, '我负责推荐系统', 'iv1', t2);

    // 第 3 轮的 history 只含祖先（第 1、2 轮），不含 fit 报告与自身
    const iv3 = { schema_version: 1, type: 'interview_turn', round: 3, question: '团队协作', evaluation: '', hint: '', finished: false, overall_assessment: '', learnings: [] };
    insertInterviewTask(db, 'iv3', 3, '团队协作回答', 'iv2', iv3);
    const task3 = db.prepare(`SELECT * FROM tasks WHERE id = 'iv3'`).get();
    const hist = buildInterviewHistory(db, task3);

    expect(hist).toContain('第 1 轮');
    expect(hist).toContain('自我介绍');
    expect(hist).toContain('我负责推荐系统'); // 第 2 轮候选人的回答来自其 extra_prompt
    expect(hist).toContain('回答清晰');
    expect(hist).not.toContain('契合度：张三');
  });

  it('无祖先时返回空串', () => {
    const db = openDb(':memory:');
    db.prepare(
      `INSERT INTO tasks (id, title, mode, status, created_at) VALUES ('iv1', 'x', 'interview', 'queued', ?)`
    ).run(new Date().toISOString());
    const task = db.prepare(`SELECT * FROM tasks WHERE id = 'iv1'`).get();
    expect(buildInterviewHistory(db, task)).toBe('');
  });
});

describe('parseInterviewParams / buildInterviewPrompt', () => {
  it('解析默认参数', () => {
    expect(parseInterviewParams('')).toEqual({ round: 1, answer: '', maxRounds: 8 });
    expect(parseInterviewParams('not json')).toEqual({ round: 1, answer: '', maxRounds: 8 });
  });

  it('解析轮次与回答，max_rounds 上限 20', () => {
    const p = parseInterviewParams(JSON.stringify({ round: 3, answer: 'hello', max_rounds: 99 }));
    expect(p.round).toBe(3);
    expect(p.answer).toBe('hello');
    expect(p.maxRounds).toBe(20);
  });

  it('buildInterviewPrompt 含任务与回答', () => {
    const prompt = buildInterviewPrompt({ round: 2, answer: '我的回答', maxRounds: 8 }, '模拟面试：A');
    expect(prompt).toContain('第 2 轮');
    expect(prompt).toContain('我的回答');
    expect(prompt).toContain('interview_turn');
  });
});

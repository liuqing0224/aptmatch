import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Report from '../Report';

vi.mock('../../api', () => {
  const task = {
    id: 't1',
    title: '契合度：张三 × 示例科技',
    mode: 'fit',
    parent_task_id: null,
    extra_prompt: '',
    status: 'done',
    error: '',
    pid: null,
    created_at: '2026-08-07T02:00:00.000Z',
    started_at: null,
    finished_at: '2026-08-07T02:05:00.000Z',
    agent: null,
    resume: { id: 'r1', name: '张三', text: '', source_file: '', created_at: '' },
    company: { id: 'c1', name: '示例科技', industry: '', stage: '', url: '', jd_text: '', source_file: '', created_at: '' },
    result: {
      schema_version: 1,
      summary: '整体匹配良好，建议进入面试流程。',
      overall_score: 78,
      grade: 'A',
      dimensions: [
        { key: 'hard_skills', label: '硬技能', score: 82, reason: '核心技能重合度高。', evidence: ['熟悉 React'] },
        { key: 'experience', label: '经验', score: 70, reason: '年限接近。', evidence: [] },
        { key: 'responsibilities', label: '职责', score: 60, reason: '部分覆盖。', evidence: [] },
        { key: 'culture', label: '文化', score: 90, reason: '契合。', evidence: [] },
        { key: 'stability', label: '稳定性', score: 75, reason: '正常。', evidence: [] },
        { key: 'preference', label: '偏好', score: 66, reason: '一般。', evidence: [] },
      ],
      matched: ['React', 'TypeScript'],
      gaps: [{ item: '缺少数据中台经验', severity: 'medium', mitigation: '准备相关案例' }],
      strengths: ['电商后台搭建'],
      risks: [],
      questions: [{ question: '团队技术栈未来方向？', why: '确认成长空间' }],
      suggestions: ['突出项目数据'],
      research: [{ source: '官网', url: 'https://example.com', finding: '主营 SaaS' }],
      learnings: [],
    },
  };
  return {
    api: {
      tasks: {
        get: vi.fn().mockResolvedValue(task),
        log: vi.fn().mockResolvedValue(''),
        followup: vi.fn().mockResolvedValue({ id: 't2' }),
      },
      blacklist: {
        check: vi.fn().mockResolvedValue([]),
      },
      __esModule: true,
    },
  };
});

describe('Report', () => {
  it('渲染总分、摘要、维度与差距', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks/t1']}>
        <Routes>
          <Route path="/tasks/:id" element={<Report />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText('整体匹配良好，建议进入面试流程。')).toBeInTheDocument();
    expect(screen.getByText('78')).toBeInTheDocument();
    expect(screen.getByText('硬技能')).toBeInTheDocument();
    expect(screen.getByText('缺少数据中台经验')).toBeInTheDocument();
    expect(screen.getByText('团队技术栈未来方向？')).toBeInTheDocument();
  });

  it('公司命中黑名单时显示警示条', async () => {
    const { api } = await import('../../api');
    vi.mocked(api.blacklist.check).mockResolvedValueOnce([
      {
        id: 'e1',
        source_id: 's1',
        company_name: '示例科技',
        industry: '',
        city: '',
        address: '',
        issue: '拖欠工资',
        detail: '',
        source_url: '',
        added_at: '',
        source_name: '测试源',
        owner: 'o',
        repo: 'r',
        branch: 'master',
      },
    ]);
    render(
      <MemoryRouter initialEntries={['/tasks/t1']}>
        <Routes>
          <Route path="/tasks/:id" element={<Report />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText(/黑名单警示/)).toBeInTheDocument();
    expect(screen.getByText(/拖欠工资/)).toBeInTheDocument();
  });
});

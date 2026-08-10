import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Recruit from '../Recruit';
import { api } from '../../api';

const { position, candidates } = vi.hoisted(() => ({
  position: {
    id: 'pos1',
    name: '高级前端工程师',
    industry: '',
    stage: '',
    url: 'https://xxx.feishu.cn/docx/abc',
    jd_text: '岗位职责：负责数据中台架构设计',
    source_file: '',
    kind: 'position',
    created_at: '2026-08-07T06:00:00.000Z',
  },
  candidates: [
    {
      id: 'c1',
      resume_id: 'r1',
      position_id: 'pos1',
      source_url: 'https://feishu/hr/c1',
      status: '已筛',
      overall_score: 88,
      grade: 'A',
      summary: '匹配良好，建议面试',
      note: '',
      created_at: '2026-08-07T06:00:00.000Z',
      updated_at: '2026-08-07T06:00:00.000Z',
      resume_name: '张三',
      position_name: '高级前端工程师',
      analysis_task_id: 't-fit-1',
      analysis_task_status: 'done',
    },
    {
      id: 'c2',
      resume_id: 'r2',
      position_id: 'pos1',
      source_url: '',
      status: '待筛',
      overall_score: null,
      grade: '',
      summary: '',
      note: '',
      created_at: '2026-08-07T06:00:00.000Z',
      updated_at: '2026-08-07T06:00:00.000Z',
      resume_name: '李四',
      position_name: '高级前端工程师',
    },
  ],
}));

vi.mock('../../api', () => ({
  api: {
    positions: {
      list: vi.fn().mockResolvedValue([position]),
      create: vi.fn().mockResolvedValue({ position }),
      remove: vi.fn().mockResolvedValue({ ok: true }),
    },
    candidates: {
      list: vi.fn().mockResolvedValue(candidates),
      importFeishu: vi
        .fn()
        .mockResolvedValue({ imported: [], skipped: 0, dispatched: [], message: 'ok' }),
      collectStart: vi.fn().mockResolvedValue({
        id: 't-collect',
        title: '采集：高级前端工程师 飞书候选人',
        mode: 'collect',
        parent_task_id: null,
        extra_prompt: '',
        status: 'queued',
        result: null,
        error: '',
        pid: null,
        created_at: '2026-08-07T06:00:00.000Z',
        started_at: null,
        finished_at: null,
        agent: null,
        resume: null,
        company: position,
      }),
      update: vi.fn().mockImplementation((_id: string, body: { status?: string }) =>
        Promise.resolve({ ...candidates[0], status: body.status ?? candidates[0].status })
      ),
    },
    tasks: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({
        id: 't-collect',
        title: '采集：高级前端工程师 飞书候选人',
        mode: 'collect',
        parent_task_id: null,
        extra_prompt: '',
        status: 'done',
        result: { ok: true, imported: 2, skipped: 0, dispatched: 2, message: '已导入 2 位候选人' },
        error: '',
        pid: null,
        created_at: '2026-08-07T06:00:00.000Z',
        started_at: '2026-08-07T06:00:01.000Z',
        finished_at: '2026-08-07T06:00:10.000Z',
        agent: null,
        resume: null,
        company: position,
      }),
    },
  },
}));

describe('Recruit（招聘端）', () => {
  it('渲染职位列表与 JD 预览', async () => {
    render(
      <MemoryRouter>
        <Recruit />
      </MemoryRouter>
    );
    expect(screen.getByText('招聘端')).toBeTruthy();
    expect(await screen.findByText('高级前端工程师')).toBeTruthy();
    expect(screen.getByText(/数据中台架构设计/)).toBeTruthy();
    expect(screen.getByText('新建职位')).toBeTruthy();
  });

  it('新建职位调用 create 接口（飞书文档链接 + 粘贴 JD）', async () => {
    render(
      <MemoryRouter>
        <Recruit />
      </MemoryRouter>
    );
    const nameInput = (await screen.findByPlaceholderText(
      '例如：高级前端工程师（数据中台）'
    )) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '后端工程师' } });
    const docInput = screen.getByPlaceholderText(/xxx.feishu.cn\/docx/) as HTMLInputElement;
    fireEvent.change(docInput, { target: { value: 'https://x.feishu.cn/docx/jd1' } });
    fireEvent.click(screen.getByText('创建职位'));

    await waitFor(() => {
      expect(vi.mocked(api.positions.create)).toHaveBeenCalledWith({
        name: '后端工程师',
        feishu_doc_url: 'https://x.feishu.cn/docx/jd1',
        jd_text: '',
      });
    });
  });

  it('候选人库展示评分/等级/摘要并可切换状态', async () => {
    render(
      <MemoryRouter>
        <Recruit />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('候选人库'));
    expect(await screen.findByText('张三')).toBeTruthy();
    expect(screen.getByText('李四')).toBeTruthy();
    expect(screen.getByText('88')).toBeTruthy();
    expect(screen.getByText('匹配良好，建议面试')).toBeTruthy();
    expect(screen.getByRole('link', { name: /查看完整分析/ })).toHaveAttribute(
      'href',
      '/tasks/t-fit-1?from=recruit'
    );

    const select = screen.getByDisplayValue('已筛') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '通过' } });
    await waitFor(() => {
      expect(vi.mocked(api.candidates.update)).toHaveBeenCalledWith('c1', { status: '通过' });
    });
  });

  it('候选人库「开始采集」按钮启动 agent 采集任务', async () => {
    render(
      <MemoryRouter>
        <Recruit />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('候选人库'));
    expect(await screen.findByText('开始采集')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '启动独立浏览器采集' }));

    await waitFor(() => {
      expect(vi.mocked(api.candidates.collectStart)).toHaveBeenCalledWith({ position_id: 'pos1' });
    });
    expect(screen.queryByText('手动导入候选人')).toBeNull();
  });

  it('采集指引展示流程与飞书入口', async () => {
    render(
      <MemoryRouter>
        <Recruit />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('采集指引'));
    expect(await screen.findByText(/飞书招聘采集流程/)).toBeTruthy();
    expect(screen.getByText('打开飞书招聘')).toBeTruthy();
  });
});

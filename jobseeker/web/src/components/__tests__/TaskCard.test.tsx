import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TaskCard from '../TaskCard';

vi.mock('../../api', () => ({
  api: {
    tasks: {
      cancel: vi.fn().mockResolvedValue({ ok: true }),
      rerun: vi.fn().mockResolvedValue({ ok: true }),
    },
  },
}));

const baseTask = {
  id: 't1',
  title: '契合度：张三 × 示例科技',
  mode: 'fit',
  parent_task_id: null,
  extra_prompt: '',
  error: '',
  pid: null,
  created_at: '2026-08-07T02:00:00.000Z',
  started_at: null,
  finished_at: null,
  agent: { id: 'a1', name: '分析师', slug: 'analyst', role: '', provider: 'codex', model: '', status: 'active', created_at: '', updated_at: '' },
  resume: { id: 'r1', name: '张三', text: '', source_file: '', created_at: '' },
  company: { id: 'c1', name: '示例科技', industry: '', stage: '', url: '', jd_text: '', source_file: '', created_at: '' },
};

describe('TaskCard', () => {
  it('展示标题、状态与 agent', () => {
    render(
      <MemoryRouter>
        <TaskCard task={{ ...baseTask, status: 'running' } as never} onChanged={() => {}} />
      </MemoryRouter>
    );
    expect(screen.getByText('契合度：张三 × 示例科技')).toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
    expect(screen.getByText(/agent：分析师/)).toBeInTheDocument();
  });

  it('done 状态展示评分', () => {
    render(
      <MemoryRouter>
        <TaskCard
          task={
            {
              ...baseTask,
              status: 'done',
              result: {
                schema_version: 1,
                summary: 's',
                overall_score: 78,
                grade: 'A',
                dimensions: [],
                matched: [],
                gaps: [],
                strengths: [],
                risks: [],
                questions: [],
                suggestions: [],
                research: [],
                learnings: [],
              },
            } as never
          }
          onChanged={() => {}}
        />
      </MemoryRouter>
    );
    expect(screen.getByText('78')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
  });
});

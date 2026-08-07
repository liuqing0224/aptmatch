import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Blacklist from '../Blacklist';
import { api } from '../../api';

const { overview } = vi.hoisted(() => ({
  overview: {
    sources: [
      {
        id: 'blk-default',
        name: '996ICU 企业黑名单（主要城市）',
        owner: 'it-job-blacklist',
        repo: '996ICU.job.blacklist_company',
        branch: 'master',
        enabled: true,
        entry_count: 2,
        last_synced_at: '2026-08-07T06:00:00.000Z',
        last_error: '',
        created_at: '',
        updated_at: '',
      },
    ],
    entries: [
      {
        id: 'e1',
        source_id: 'blk-default',
        company_name: '北京天拓四方科技有限公司',
        industry: '互联网',
        city: '北京市',
        address: '中关村',
        issue: '合同陷阱',
        detail: '面试谈 20k 合同写 4.8k，要求贴发票报销。',
        source_url:
          'https://github.com/it-job-blacklist/996ICU.job.blacklist_company/blob/master/Beijing.md',
        added_at: '',
        source_name: '996ICU 企业黑名单（主要城市）',
        owner: 'it-job-blacklist',
        repo: '996ICU.job.blacklist_company',
        branch: 'master',
      },
      {
        id: 'e2',
        source_id: 'blk-default',
        company_name: '上海示例科技',
        industry: '金融',
        city: '上海市',
        address: '张江',
        issue: '996',
        detail: '强制 996 无加班费。',
        source_url:
          'https://github.com/it-job-blacklist/996ICU.job.blacklist_company/blob/master/ShangHai.md',
        added_at: '',
        source_name: '996ICU 企业黑名单（主要城市）',
        owner: 'it-job-blacklist',
        repo: '996ICU.job.blacklist_company',
        branch: 'master',
      },
    ],
    total: 2,
    syncing: [],
    q: '',
    city: '',
  },
}));

vi.mock('../../api', () => ({
  api: {
    blacklist: {
      overview: vi.fn().mockResolvedValue(overview),
      sync: vi.fn().mockResolvedValue({ started: 1, syncing: [] }),
      addSource: vi.fn().mockResolvedValue({}),
      updateSource: vi.fn().mockResolvedValue({}),
      removeSource: vi.fn().mockResolvedValue({ ok: true }),
    },
  },
}));

describe('Blacklist', () => {
  it('渲染求职警示、统计、来源与榜单记录', async () => {
    render(
      <MemoryRouter>
        <Blacklist />
      </MemoryRouter>
    );
    expect(screen.getByText(/求职警示/)).toBeTruthy();
    expect(await screen.findByText('北京天拓四方科技有限公司')).toBeTruthy();
    expect(screen.getByText('上海示例科技')).toBeTruthy();
    expect(screen.getByText('996ICU 企业黑名单（主要城市）')).toBeTruthy();
    expect(screen.getByText('合同陷阱')).toBeTruthy();
    expect(screen.getByText('同步全部来源')).toBeTruthy();
  });

  it('搜索时按关键词过滤', async () => {
    render(
      <MemoryRouter>
        <Blacklist />
      </MemoryRouter>
    );
    const input = (await screen.findByPlaceholderText(
      '搜索公司名 / 问题关键词…'
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '上海' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      const mocked = vi.mocked(api.blacklist.overview);
      expect(mocked).toHaveBeenCalledWith(expect.objectContaining({ q: '上海' }));
    });
  });
});

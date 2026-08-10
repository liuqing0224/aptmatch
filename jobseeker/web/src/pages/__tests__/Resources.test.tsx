import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Resources from '../Resources';
import { api } from '../../api';

vi.mock('../../api', () => ({
  api: {
    resumes: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ resume: { id: 'r1', name: '张三', text: '', source_file: '', created_at: '' } }),
      parse: vi.fn().mockResolvedValue({ name: '张三', text: '张三的简历全文' }),
      remove: vi.fn().mockResolvedValue({ ok: true }),
    },
    companies: {
      list: vi.fn().mockResolvedValue([]),
    },
  },
  ApiError: class ApiError extends Error {},
}));

describe('Resources', () => {
  it('选择简历文件后自动填入姓名与简历全文', async () => {
    const { container } = render(
      <MemoryRouter>
        <Resources />
      </MemoryRouter>
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['张三的简历全文'], '张三.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(api.resumes.parse).toHaveBeenCalledWith(file));
    expect(screen.getByDisplayValue('张三')).toBeTruthy();
    expect(screen.getByDisplayValue('张三的简历全文')).toBeTruthy();
    expect(screen.getByText(/已自动填入/)).toBeTruthy();
  });
});

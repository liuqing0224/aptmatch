import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import RadarChart from '../RadarChart';

const dims = [
  { key: 'hard_skills', label: '硬技能', score: 82, reason: 'r', evidence: [] },
  { key: 'experience', label: '经验', score: 70, reason: 'r', evidence: [] },
  { key: 'responsibilities', label: '职责', score: 60, reason: 'r', evidence: [] },
  { key: 'culture', label: '文化', score: 90, reason: 'r', evidence: [] },
  { key: 'stability', label: '稳定性', score: 75, reason: 'r', evidence: [] },
  { key: 'preference', label: '偏好', score: 66, reason: 'r', evidence: [] },
];

describe('RadarChart', () => {
  it('渲染雷达图与全部维度标签', () => {
    render(<RadarChart dimensions={dims} />);
    const svg = screen.getByRole('img', { name: /契合度\d+维雷达图/ });
    expect(svg).toBeInTheDocument();
    for (const d of dims) {
      expect(screen.getByText(new RegExp(d.label))).toBeInTheDocument();
    }
  });

  it('维度少于 3 时也能渲染', () => {
    render(<RadarChart dimensions={dims.slice(0, 2)} />);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });
});

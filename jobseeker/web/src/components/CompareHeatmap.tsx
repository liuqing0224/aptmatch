import { useNavigate } from 'react-router-dom';
import type { MatchRow } from '../types';

// 分数 → 背景色渐变（低分深红 → 中黄 → 高分深绿），保证数值差异可感知
function heatColor(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  // stops: [score, color]
  const stops: [number, [number, number, number]][] = [
    [0, [239, 68, 68]],
    [45, [250, 204, 21]],
    [60, [163, 230, 53]],
    [75, [74, 194, 107]],
    [90, [22, 163, 74]],
    [100, [5, 122, 63]],
  ];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (s >= stops[i][0] && s <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
  }
  const t = (s - a[0]) / (b[0] - a[0] || 1);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${mix(a[1][0], b[1][0])}, ${mix(a[1][1], b[1][1])}, ${mix(a[1][2], b[1][2])})`;
}

// 深色背景用白字，浅色背景用深字
function heatText(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  return s >= 75 ? '#ffffff' : '#1f2937';
}

export default function CompareHeatmap({
  rows,
  dimKeys,
}: {
  rows: MatchRow[];
  dimKeys: string[];
}) {
  const navigate = useNavigate();
  const avg = dimKeys.map((k) => {
    const vals = rows.map((m) => m.dimensions[k]?.score).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });

  return (
    <div className="card table-wrap">
      <div className="heatmap-legend">
        <span className="hint">分数梯度：低 → 高（点击行跳转到报告）</span>
        <div className="heatmap-scale">
          {[0, 45, 60, 75, 90, 100].map((v) => (
            <span key={v} style={{ background: heatColor(v), color: heatText(v) }}>{v}</span>
          ))}
        </div>
      </div>
      <table className="compare-table heatmap">
        <thead>
          <tr>
            <th>公司</th>
            <th>总分</th>
            {dimKeys.map((k) => <th key={k}>{rows.find((m) => m.dimensions[k])?.dimensions[k].label ?? k}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.task_id} onClick={() => navigate(`/tasks/${m.task_id}`)}>
              <td><strong>{m.company_name}</strong></td>
              <td><span className={`rank rank-${m.grade}`}>{m.overall_score} {m.grade}</span></td>
              {dimKeys.map((k) => {
                const s = m.dimensions[k]?.score;
                return (
                  <td
                    key={k}
                    className="heat-cell"
                    style={s != null ? { background: heatColor(s), color: heatText(s) } : undefined}
                    title={m.dimensions[k]?.label}
                  >
                    {s != null ? Math.round(s) : '-'}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="heat-avg">
            <td><strong>平均</strong></td>
            <td>-</td>
            {avg.map((v, i) => (
              <td key={i} style={v != null ? { background: heatColor(v), color: heatText(v) } : undefined}>
                {v != null ? Math.round(v) : '-'}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

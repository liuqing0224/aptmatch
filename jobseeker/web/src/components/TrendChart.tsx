import type { TrendPoint } from '../types';

export default function TrendChart({
  points,
  dimKeys = [],
  width = 620,
  height = 220,
}: {
  points: TrendPoint[];
  dimKeys?: string[];
  width?: number;
  height?: number;
}) {
  if (points.length === 0) {
    return <div className="hint">暂无历史趋势数据（同公司尚未多次匹配）。</div>;
  }

  const pad = { l: 40, r: 20, t: 18, b: 26 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const times = points.map((p) => new Date(p.created_at).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const span = t1 - t0 || 1;

  const x = (t: number) => pad.l + (iw * (t - t0)) / span;
  const y = (score: number) => pad.t + ih - (ih * score) / 100;

  const fmtDay = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const colors = ['#7c3aed', '#0891b2', '#f59e0b', '#dc2626', '#16a34a', '#64748b'];

  const line = (getY: (p: TrendPoint) => number) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(new Date(p.created_at).getTime()).toFixed(1)},${getY(p).toFixed(1)}`).join(' ');

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="trend-chart" role="img" aria-label="同公司历史趋势图">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} y1={y(v)} x2={width - pad.r} y2={y(v)} className="trend-grid" />
            <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="trend-axis-label">{v}</text>
          </g>
        ))}
        <polyline points={line((p) => p.overall_score)} className="trend-line" />
        {points.map((p) => (
          <g key={p.task_id}>
            <circle
              cx={x(new Date(p.created_at).getTime())}
              cy={y(p.overall_score)}
              r={3.5}
              className="trend-dot"
            />
            <text x={x(new Date(p.created_at).getTime())} y={height - 8} textAnchor="middle" className="trend-x-label">
              {fmtDay(p.created_at)}
            </text>
          </g>
        ))}
        {dimKeys.map((k, di) => (
          <g key={k}>
            <polyline points={line((p) => p.dims[k] ?? 0)} className="trend-dim" style={{ stroke: colors[di % colors.length] }} />
            <text x={pad.l + 4} y={pad.t + 10 + di * 12} className="trend-legend">
              <tspan fill={colors[di % colors.length]}>{k}</tspan>
            </text>
          </g>
        ))}
      </svg>
      <div className="hint">
        总分走势（紫线）+ 维度走势：{points.map((p) => `${fmtDay(p.created_at)} ${p.overall_score}${p.grade}`).join(' → ')}
      </div>
    </div>
  );
}

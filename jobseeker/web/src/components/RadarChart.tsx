import type { Dimension } from '../types';

export default function RadarChart({ dimensions, size = 340 }: { dimensions: Dimension[]; size?: number }) {
  const n = Math.max(3, dimensions.length);
  const dense = dimensions.length >= 9;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.34;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i: number, value: number): [number, number] => [
    cx + Math.cos(angle(i)) * r * (value / 100),
    cy + Math.sin(angle(i)) * r * (value / 100),
  ];
  const ringPoints = (frac: number) =>
    dimensions.map((_, i) => point(i, frac * 100).join(',')).join(' ');
  const areaPoints = dimensions.map((d, i) => point(i, d.score).join(',')).join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="radar" role="img" aria-label={`契合度${dimensions.length}维雷达图`}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ringPoints(f)} className="radar-ring" />
      ))}
      {dimensions.map((d, i) => {
        const [x, y] = point(i, 100);
        return <line key={d.key} x1={cx} y1={cy} x2={x} y2={y} className="radar-axis" />;
      })}
      <polygon points={areaPoints} className="radar-area" />
      {dimensions.map((d, i) => {
        const [x, y] = point(i, d.score);
        return <circle key={d.key} cx={x} cy={y} r={3.5} className="radar-dot" />;
      })}
      {dimensions.map((d, i) => {
        const [x, y] = point(i, 124);
        return (
          <text key={d.key} x={x} y={y} textAnchor="middle" className="radar-label">
            {dense ? d.label : `${d.label} ${Math.round(d.score)}`}
          </text>
        );
      })}
    </svg>
  );
}

export default function ScoreBadge({ score, grade }: { score: number; grade?: string }) {
  const cls = grade === 'S' ? 'grade-s' : grade === 'A' ? 'grade-a' : grade === 'B' ? 'grade-b' : 'grade-c';
  return (
    <span className="score-badge">
      <strong className={cls}>{Math.round(score)}</strong>
      {grade && <em className={cls}>{grade}</em>}
    </span>
  );
}

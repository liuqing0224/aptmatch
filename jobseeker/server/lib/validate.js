export const DIMENSION_KEYS = [
  'hard_skills',
  'experience',
  'responsibilities',
  'gate',
  'tech_direction',
  'compensation',
  'culture',
  'stability',
  'company_health',
  'preference',
];

export const GRADES = ['S', 'A', 'B', 'C', 'D'];

export const DIMENSION_WEIGHTS = {
  hard_skills: 20,
  experience: 14,
  responsibilities: 13,
  gate: 14,
  tech_direction: 12,
  compensation: 8,
  culture: 8,
  stability: 6,
  company_health: 3,
  preference: 2,
};

const WEIGHT_SUM_TOLERANCE = 1;

export function validateReport(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['报告不是 JSON 对象'] };
  }
  if (typeof raw.schema_version !== 'number') {
    errors.push('schema_version 缺失或非数字');
  }
  if (typeof raw.summary !== 'string' || !raw.summary.trim()) {
    errors.push('summary 缺失');
  }
  if (
    typeof raw.overall_score !== 'number' ||
    !Number.isFinite(raw.overall_score) ||
    raw.overall_score < 0 ||
    raw.overall_score > 100
  ) {
    errors.push('overall_score 必须是 0-100 的数字');
  }
  if (!GRADES.includes(raw.grade)) {
    errors.push(`grade 必须是 ${GRADES.join('/')} 之一`);
  }
  if (!Array.isArray(raw.dimensions) || raw.dimensions.length === 0) {
    errors.push('dimensions 必须是非空数组');
  } else {
    const keys = new Set(raw.dimensions.map((d) => d?.key));
    for (const k of DIMENSION_KEYS) {
      if (!keys.has(k)) errors.push(`dimensions 缺少维度: ${k}`);
    }
    raw.dimensions.forEach((d, i) => {
      if (!d || typeof d !== 'object') {
        errors.push(`dimensions[${i}] 不是对象`);
        return;
      }
      if (
        typeof d.score !== 'number' ||
        !Number.isFinite(d.score) ||
        d.score < 0 ||
        d.score > 100
      ) {
        errors.push(`维度 ${d.key ?? i} 的 score 必须是 0-100 的数字`);
      }
      if (typeof d.reason !== 'string' || !d.reason.trim()) {
        errors.push(`维度 ${d.key ?? i} 缺少 reason`);
      }
      if (
        typeof d.weight !== 'number' ||
        !Number.isFinite(d.weight) ||
        d.weight < 0 ||
        d.weight > 100
      ) {
        errors.push(`维度 ${d.key ?? i} 的 weight 必须是 0-100 的数字`);
      }
      if (d.evidence !== undefined && !Array.isArray(d.evidence)) {
        errors.push(`维度 ${d.key ?? i} 的 evidence 必须是数组`);
      }
    });
    const weightSum = raw.dimensions.reduce(
      (s, d) => s + (typeof d?.weight === 'number' && Number.isFinite(d.weight) ? d.weight : 0),
      0
    );
    if (Math.abs(weightSum - 100) > WEIGHT_SUM_TOLERANCE) {
      errors.push(`dimensions 权重之和必须是 100（当前 ${weightSum}）`);
    }
  }
  for (const f of ['matched', 'strengths', 'risks', 'suggestions', 'learnings']) {
    if (raw[f] !== undefined && !Array.isArray(raw[f])) {
      errors.push(`${f} 必须是数组`);
    }
  }
  for (const f of ['gaps', 'research', 'questions']) {
    if (raw[f] !== undefined && !Array.isArray(raw[f])) {
      errors.push(`${f} 必须是数组`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, report: sanitize(raw) };
}

function sanitize(r) {
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
  return {
    schema_version: 1,
    summary: String(r.summary).trim(),
    overall_score: clamp(r.overall_score),
    grade: r.grade,
    dimensions: r.dimensions.map((d) => ({
      key: d.key,
      label: d.label || d.key,
      score: clamp(d.score),
      weight: clamp(typeof d.weight === 'number' ? d.weight : 0),
      reason: String(d.reason).trim(),
      evidence: Array.isArray(d.evidence) ? d.evidence.map(String) : [],
    })),
    matched: (r.matched || []).map(String),
    gaps: (r.gaps || []).map((g) => ({
      item: String(g?.item ?? ''),
      severity: ['high', 'medium', 'low'].includes(g?.severity) ? g.severity : 'medium',
      mitigation: String(g?.mitigation ?? ''),
    })),
    strengths: (r.strengths || []).map(String),
    risks: (r.risks || []).map(String),
    questions: (r.questions || []).map((q) => ({
      question: String(q?.question ?? ''),
      why: String(q?.why ?? ''),
    })),
    suggestions: (r.suggestions || []).map(String),
    research: (r.research || []).map((s) => ({
      source: String(s?.source ?? ''),
      url: String(s?.url ?? ''),
      finding: String(s?.finding ?? ''),
    })),
    learnings: (r.learnings || []).map(String),
  };
}

export function validateInterviewTurn(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['面试轮次不是 JSON 对象'] };
  }
  if (raw.type !== 'interview_turn') {
    errors.push('type 必须是 interview_turn');
  }
  if (typeof raw.schema_version !== 'number') {
    errors.push('schema_version 缺失或非数字');
  }
  if (!Number.isInteger(raw.round) || raw.round < 1) {
    errors.push('round 必须是正整数');
  }
  if (typeof raw.question !== 'string' || !raw.question.trim()) {
    errors.push('question 缺失');
  }
  if (typeof raw.evaluation !== 'string') {
    errors.push('evaluation 必须是字符串');
  }
  if (typeof raw.hint !== 'string') {
    errors.push('hint 必须是字符串');
  }
  if (typeof raw.finished !== 'boolean') {
    errors.push('finished 必须是布尔值');
  }
  if (raw.finished && (typeof raw.overall_assessment !== 'string' || !raw.overall_assessment.trim())) {
    errors.push('finished=true 时 overall_assessment 必须非空');
  }
  if (typeof raw.overall_assessment !== 'string') {
    errors.push('overall_assessment 必须是字符串');
  }
  for (const f of ['learnings']) {
    if (raw[f] !== undefined && !Array.isArray(raw[f])) {
      errors.push(`${f} 必须是数组`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    report: {
      schema_version: 1,
      type: 'interview_turn',
      round: raw.round,
      question: String(raw.question).trim(),
      evaluation: String(raw.evaluation ?? '').trim(),
      hint: String(raw.hint ?? '').trim(),
      finished: Boolean(raw.finished),
      overall_assessment: String(raw.overall_assessment ?? '').trim(),
      learnings: (raw.learnings || []).map(String),
    },
  };
}

export function validateCrawlResults(raw) {  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['爬取结果不是 JSON 对象'] };
  }
  if (typeof raw.schema_version !== 'number') {
    errors.push('schema_version 缺失或非数字');
  }
  if (typeof raw.keyword !== 'string' || !raw.keyword.trim()) {
    errors.push('keyword 缺失');
  }
  if (!Array.isArray(raw.results) || raw.results.length === 0) {
    errors.push('results 必须是非空数组');
  } else {
    raw.results.forEach((it, i) => {
      if (!it || typeof it !== 'object') {
        errors.push(`results[${i}] 不是对象`);
        return;
      }
      if (typeof it.company_name !== 'string' || !it.company_name.trim()) {
        errors.push(`results[${i}].company_name 缺失`);
      }
      if (typeof it.jd_text !== 'string' || !it.jd_text.trim()) {
        errors.push(`results[${i}].jd_text 缺失`);
      }
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, report: sanitizeCrawl(raw) };
}

function sanitizeCrawl(r) {
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    schema_version: 1,
    keyword: s(r.keyword),
    city: s(r.city),
    generated_at: s(r.generated_at),
    results: (r.results || []).map((it) => ({
      company_name: s(it.company_name),
      position_title: s(it.position_title),
      salary: s(it.salary),
      location: s(it.location),
      industry: s(it.industry),
      stage: s(it.stage),
      company_url: s(it.company_url),
      jd_text: s(it.jd_text),
      source: s(it.source),
      source_url: s(it.source_url),
    })),
    learnings: (r.learnings || []).map(String),
  };
}

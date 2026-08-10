import { describe, expect, it } from 'vitest';
import { buildFitReportPdf, buildComparePdf, findCjkFont } from '../lib/pdf.js';

function sampleReport() {
  return {
    schema_version: 1,
    summary: '整体匹配良好',
    overall_score: 80,
    grade: 'A',
    dimensions: [
      { key: 'hard_skills', label: '硬技能', score: 85, weight: 20, reason: '技能重合', evidence: [] },
      { key: 'compensation', label: '薪资职级', score: 72, weight: 8, reason: '匹配', evidence: [] },
    ],
    matched: ['React'],
    gaps: [{ item: '缺 Python', severity: 'high', mitigation: '补课' }],
    strengths: ['项目经验'],
    risks: [],
    questions: [{ question: '团队规模？', why: '确认' }],
    suggestions: ['突出成果'],
    research: [{ source: '官网', url: 'https://x.com', finding: '业务' }],
    learnings: [],
  };
}

function collectBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

describe('pdf', () => {
  it('探测到 CJK 字体（macOS 环境）', () => {
    const f = findCjkFont();
    expect(typeof f).toBe('string');
  });

  it('渲染契合度报告为 PDF', async () => {
    const task = {
      company: { name: '示例科技' },
      resume: { name: '张三' },
    };
    const doc = buildFitReportPdf(task, sampleReport());
    const buf = await collectBuffer(doc);
    expect(buf.length).toBeGreaterThan(100);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('渲染对比表为 PDF', async () => {
    const rows = [
      { company_name: 'A 公司', overall_score: 85, grade: 'S', dimensions: { hard_skills: { label: '硬技能', score: 90 } } },
      { company_name: 'B 公司', overall_score: 60, grade: 'C', dimensions: { hard_skills: { label: '硬技能', score: 55 } } },
    ];
    const doc = buildComparePdf(rows, ['hard_skills'], '对比：张三');
    const buf = await collectBuffer(doc);
    expect(buf.length).toBeGreaterThan(100);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

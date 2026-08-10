import { describe, expect, it } from 'vitest';
import { validateReport, validateCrawlResults } from '../lib/validate.js';

function validReport() {
  return {
    schema_version: 1,
    summary: '整体匹配良好',
    overall_score: 80,
    grade: 'A',
    dimensions: [
      { key: 'hard_skills', label: '硬技能', score: 85, weight: 20, reason: '技能重合', evidence: ['x'] },
      { key: 'experience', label: '经验', score: 80, weight: 14, reason: '年限接近', evidence: ['x'] },
      { key: 'responsibilities', label: '职责', score: 75, weight: 13, reason: '覆盖大部分', evidence: [] },
      { key: 'gate', label: '门槛', score: 90, weight: 14, reason: '达标', evidence: ['x'] },
      { key: 'tech_direction', label: '技术方向', score: 78, weight: 12, reason: '一致', evidence: ['x'] },
      { key: 'compensation', label: '薪资职级', score: 72, weight: 8, reason: '匹配', evidence: [] },
      { key: 'culture', label: '文化', score: 82, weight: 8, reason: '契合', evidence: ['x'] },
      { key: 'stability', label: '稳定性', score: 78, weight: 6, reason: '正常', evidence: [] },
      { key: 'company_health', label: '公司风险', score: 80, weight: 3, reason: '无明显风险', evidence: ['x'] },
      { key: 'preference', label: '偏好', score: 88, weight: 2, reason: '一致', evidence: ['x'] },
    ],
    matched: ['React'],
    gaps: [{ item: '缺 Python', severity: 'high', mitigation: '补课' }],
    strengths: ['项目经验'],
    risks: [],
    questions: [{ question: '团队规模？', why: '确认风险' }],
    suggestions: ['突出成果'],
    research: [{ source: '官网', url: 'https://x.com', finding: '业务' }],
    learnings: [],
  };
}

describe('validateReport', () => {
  it('接受合法报告并规范化', () => {
    const r = validateReport(validReport());
    expect(r.ok).toBe(true);
    expect(r.report.dimensions).toHaveLength(10);
    expect(r.report.dimensions[0].weight).toBe(20);
    expect(r.report.gaps[0].severity).toBe('high');
  });

  it('拒绝缺失维度的报告', () => {
    const bad = validReport();
    bad.dimensions = bad.dimensions.slice(0, 4);
    const r = validateReport(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join('')).toContain('stability');
    expect(r.errors.join('')).toContain('preference');
  });

  it('拒绝越界分数', () => {
    const bad = validReport();
    bad.overall_score = 120;
    expect(validateReport(bad).ok).toBe(false);
  });

  it('拒绝缺失权重', () => {
    const bad = validReport();
    delete bad.dimensions[0].weight;
    const r = validateReport(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join('')).toContain('weight');
  });

  it('拒绝权重之和不为 100', () => {
    const bad = validReport();
    bad.dimensions[0].weight = 10;
    const r = validateReport(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join('')).toContain('权重之和');
  });

  it('拒绝非法 grade', () => {
    const bad = validReport();
    bad.grade = 'F';
    expect(validateReport(bad).ok).toBe(false);
  });

  it('拒绝缺失 summary', () => {
    const bad = validReport();
    delete bad.summary;
    expect(validateReport(bad).ok).toBe(false);
  });

  it('拒绝非对象输入', () => {
    expect(validateReport(null).ok).toBe(false);
    expect(validateReport('x').ok).toBe(false);
  });
});

describe('validateCrawlResults', () => {
  function validCrawl() {
    return {
      schema_version: 1,
      keyword: '高级数据工程师',
      city: '北京',
      generated_at: '2026-08-07T00:00:00.000Z',
      results: [
        {
          company_name: '讯兔科技',
          position_title: '高级数据工程师',
          salary: '25-50K',
          location: '北京',
          industry: '计算机软件',
          stage: 'A轮 / 100-499人',
          company_url: 'https://example.com',
          jd_text: '职责：…… 要求：……',
          source: 'BOSS直聘',
          source_url: 'https://www.zhipin.com/job_detail/x.html',
        },
      ],
      learnings: [],
    };
  }

  it('接受合法爬取结果', () => {
    const r = validateCrawlResults(validCrawl());
    expect(r.ok).toBe(true);
    expect(r.report.results[0].company_name).toBe('讯兔科技');
  });

  it('拒绝空 results', () => {
    const bad = validCrawl();
    bad.results = [];
    expect(validateCrawlResults(bad).ok).toBe(false);
  });

  it('拒绝缺失 company_name 或 jd_text 的结果', () => {
    const bad1 = validCrawl();
    delete bad1.results[0].company_name;
    expect(validateCrawlResults(bad1).ok).toBe(false);

    const bad2 = validCrawl();
    delete bad2.results[0].jd_text;
    expect(validateCrawlResults(bad2).ok).toBe(false);
  });

  it('拒绝缺失 keyword', () => {
    const bad = validCrawl();
    delete bad.keyword;
    expect(validateCrawlResults(bad).ok).toBe(false);
  });

  it('规范化可选字段为字符串', () => {
    const r = validateCrawlResults(validCrawl());
    expect(r.ok).toBe(true);
    expect(r.report.results[0].company_url).toBe('https://example.com');
  });
});

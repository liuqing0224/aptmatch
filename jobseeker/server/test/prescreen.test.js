import { describe, expect, it } from 'vitest';
import {
  parseSalaryK,
  cityMatch,
  scoreMatch,
  prescreenResults,
} from '../lib/prescreen.js';

describe('parseSalaryK', () => {
  it('解析 K 区间', () => {
    expect(parseSalaryK('25-50K')).toEqual({ minK: 25, maxK: 50, raw: '25-50K' });
    expect(parseSalaryK('20-30K·13薪')).toEqual({ minK: 20, maxK: 30, raw: '20-30K·13薪' });
    expect(parseSalaryK('15~25k')).toEqual({ minK: 15, maxK: 25, raw: '15~25k' });
  });

  it('解析万单位', () => {
    expect(parseSalaryK('2-3万')).toEqual({ minK: 20, maxK: 30, raw: '2-3万' });
  });

  it('解析单边区间', () => {
    expect(parseSalaryK('25K以上')).toEqual({ minK: 25, maxK: null, raw: '25K以上' });
    expect(parseSalaryK('25K以下')).toEqual({ minK: null, maxK: 25, raw: '25K以下' });
  });

  it('无法解析时返回 null', () => {
    expect(parseSalaryK('面议')).toBeNull();
    expect(parseSalaryK('')).toBeNull();
    expect(parseSalaryK(undefined)).toBeNull();
    expect(parseSalaryK('薪资面议')).toBeNull();
  });
});

describe('cityMatch', () => {
  it('模糊匹配城市', () => {
    expect(cityMatch('北京·朝阳区', '北京')).toBe(true);
    expect(cityMatch('北京', '北京·朝阳')).toBe(true);
    expect(cityMatch('上海', '北京')).toBe(false);
  });

  it('空查询视为匹配', () => {
    expect(cityMatch('北京', '')).toBe(true);
    expect(cityMatch('北京', undefined)).toBe(true);
  });
});

describe('scoreMatch', () => {
  it('无重叠返回 0', () => {
    expect(scoreMatch('简历内容无关', '完全不相关的职位描述')).toBe(0);
  });

  it('有重合词汇时给出正分', () => {
    const resume = '熟悉 React TypeScript，三年前端开发经验，掌握 Node.js 与数据库';
    const jd = '要求精通 React、TypeScript、Node.js 前端开发，负责前端架构与页面性能优化';
    const s = scoreMatch(resume, jd);
    expect(s).toBeGreaterThan(0);
  });

  it('中文简历与中文 JD 共享技术词时给出正分', () => {
    const resume = '精通 React、TypeScript，熟悉前端性能优化与工程化实践';
    const jd = '熟练掌握前端性能优化，React 经验丰富，负责大前端架构建设';
    const s = scoreMatch(resume, jd);
    expect(s).toBeGreaterThan(0);
  });

  it('高度相似的中文文本得分明显更高', () => {
    const a = scoreMatch('资深前端工程师，负责前端性能优化与工程化建设', '资深前端工程师，负责前端性能优化与工程化建设');
    const b = scoreMatch('资深前端工程师，负责前端性能优化与工程化建设', '负责后端 C++ 服务开发与数据库运维');
    expect(a).toBeGreaterThan(50);
    expect(b).toBeLessThan(a);
  });

  it('完全无关的中文内容得分为 0', () => {
    expect(scoreMatch('简历内容无关', '完全不相关的职位描述')).toBe(0);
  });

  it('空文本返回 0', () => {
    expect(scoreMatch('', 'jd')).toBe(0);
    expect(scoreMatch('resume', '')).toBe(0);
  });
});

describe('prescreenResults', () => {
  const results = [
    { company_name: 'A', salary: '25-50K', location: '北京', jd_text: '熟悉 React 前端' },
    { company_name: 'B', salary: '8-12K', location: '上海', jd_text: 'C++ 后端开发' },
    { company_name: 'C', salary: '面议', location: '北京', jd_text: 'React 与 TypeScript' },
  ];
  const resume = '精通 React TypeScript 前端开发 北京';

  it('默认全部通过（无过滤条件）', () => {
    const out = prescreenResults(results, resume, {});
    expect(out).toHaveLength(3);
    expect(out.every((r) => r.passed)).toBe(true);
  });

  it('按最低薪资过滤', () => {
    const out = prescreenResults(results, resume, { minK: 20 });
    expect(out[0].passed).toBe(true); // 25-50K
    expect(out[1].passed).toBe(false); // 8-12K
    expect(out[2].passed).toBe(true); // 面议 -> maxK null 视为通过
  });

  it('按城市过滤', () => {
    const out = prescreenResults(results, resume, { city: '上海' });
    expect(out[1].passed).toBe(true);
    expect(out[0].passed).toBe(false);
  });

  it('按匹配分过滤', () => {
    const out = prescreenResults(results, resume, { minScore: 60 });
    expect(out[0].passed).toBe(true); // React/前端 高重合（100）
    expect(out[1].passed).toBe(false); // C++ 后端 与前端方向仅弱重合（50）
    expect(out[2].passed).toBe(true); // React/TypeScript 高重合（100）
  });
});

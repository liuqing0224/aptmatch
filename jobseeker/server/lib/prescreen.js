const K_UNIT_RE = /(\d+(?:\.\d+)?)\s*([kK]|千|万)/;
const RANGE_SPLIT_RE = /[-~—–至到]/;

export function parseSalaryK(salaryStr) {
  if (typeof salaryStr !== 'string' || !salaryStr.trim()) return null;
  const raw = salaryStr.trim();
  if (/面议|薪资面议|面谈|open/i.test(raw)) return null;

  const toK = (n, unit) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    if (unit === '万') return v * 10;
    if (unit === 'k' || unit === 'K' || unit === '千') return v;
    return null;
  };

  // 形如 25-50K / 20-30K·13薪 / 15~25k / 20到30千
  const range = raw.split(RANGE_SPLIT_RE);
  if (range.length >= 2) {
    const numAt = (part) => {
      const m = part.match(/^\s*(\d+(?:\.\d+)?)/);
      return m ? m[1] : null;
    };
    const unitM = raw.match(/([kK千]|万)/);
    const unit = unitM ? unitM[1] : 'k';
    const lo = toK(numAt(range[0]), unit);
    const hi = toK(numAt(range[1]), unit);
    if (lo != null && hi != null && hi >= lo) return { minK: lo, maxK: hi, raw };
  }

  // 形如 25K以上 / 30万以上 / 20K-30K（两段都带单位）
  const m = raw.match(/(\d+(?:\.\d+)?)\s*([kK千]|万)/);
  if (m) {
    const k = toK(m[1], m[2]);
    if (k != null) {
      if (/以上|起/.test(raw)) return { minK: k, maxK: null, raw };
      if (/以下|以内/.test(raw)) return { minK: null, maxK: k, raw };
    }
  }

  return null;
}

export function cityMatch(location, query) {
  if (!query || !query.trim()) return true;
  if (!location) return false;
  const q = query.trim().toLowerCase();
  const loc = location.toLowerCase();
  return loc.includes(q) || q.includes(loc);
}

const STOPWORDS = new Set([
  '我们', '以及', '进行', '要求', '负责', '相关', '经验', '能力', '岗位', '工作',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'on', 'at',
  'must', 'have', 'skills', 'years', 'experience', 'strong', 'good', 'ability',
]);

// 中文场景下几乎无区分度的常见 2-gram（几乎每份 JD 都出现，会拉平分数）
const CJK_STOPWORDS = new Set([
  '公司', '岗位', '负责', '要求', '招聘', '工作', '经验', '相关', '进行', '我们',
  '能够', '具备', '拥有', '良好', '并且', '以及', '至少', '优先', '加分', '职责',
  '任职', '需要', '具有', '一年', '两年', '三年', '四年', '五年', '学历', '本科',
  '硕士', '团队', '沟通', '管理', '支持', '参与', '完成', '提供', '主要',
  '熟悉', '掌握', '了解', '使用', '编写', '业务', '日常',
  // 高频通用技术 2-gram：几乎各类开发岗位都出现，跨方向命中会产生误报
  '开发', '工程', '系统', '技术', '数据', '算法', '架构', '平台',
  '设计', '测试', '服务', '维护', '优化', '建设', '实现', '落地',
]);

const CJK_RE = /\p{Script=Han}/u;

function tokenize(text) {
  const tokens = new Map();
  if (!text) return tokens;
  const parts = String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u);
  for (const t of parts) {
    if (!t) continue;
    if (!CJK_RE.test(t)) {
      // 拉丁/数字片段：保持单词级匹配
      if (t.length < 2) continue;
      if (STOPWORDS.has(t)) continue;
      tokens.set(t, (tokens.get(t) ?? 0) + 1);
      continue;
    }
    // 中文片段：生成重叠 2-gram 与 3-gram，避免整句被当成单个 token
    for (let n = 2; n <= 3; n++) {
      if (t.length < n) continue;
      for (let i = 0; i + n <= t.length; i++) {
        const gram = t.slice(i, i + n);
        if (CJK_STOPWORDS.has(gram)) continue;
        tokens.set(gram, (tokens.get(gram) ?? 0) + 1);
      }
    }
  }
  return tokens;
}

export function scoreMatch(resumeText, jdText) {
  const r = tokenize(resumeText);
  const j = tokenize(jdText);
  if (r.size === 0 || j.size === 0) return 0;

  let hit = 0;
  let jdHit = 0;
  for (const [tok, cnt] of j) {
    if (r.has(tok)) {
      hit += cnt;
      jdHit += cnt;
    }
  }
  // 覆盖率：JD 中命中词占 JD 词频比例，兼顾两者文本长度差异
  const jdTotal = [...j.values()].reduce((a, b) => a + b, 0);
  if (jdTotal === 0) return 0;
  return Math.round((hit / jdTotal) * 100);
}

export function prescreenResult(item, resumeText, filters = {}) {
  const f = filters ?? {};
  const salary = parseSalaryK(item?.salary);
  const score = resumeText ? scoreMatch(resumeText, item?.jd_text ?? '') : null;

  const salaryOk =
    salary == null ||
    (f.minK == null || f.minK === '' || (salary.maxK != null && salary.maxK >= Number(f.minK)));
  const salaryMaxOk =
    salary == null ||
    (f.maxK == null || f.maxK === '' || (salary.minK != null && salary.minK <= Number(f.maxK)));
  const salary_ok = salaryOk && salaryMaxOk;
  const city_ok = cityMatch(item?.location, f.city);
  const score_ok = score == null || f.minScore == null || f.minScore === '' || score >= Number(f.minScore);

  return {
    index: item._index ?? -1,
    salary,
    score,
    city_ok,
    salary_ok,
    score_ok,
    passed: salary_ok && city_ok && score_ok,
  };
}

export function prescreenResults(results, resumeText, filters = {}) {
  return (results ?? []).map((it, i) => prescreenResult({ ...it, _index: i }, resumeText, filters));
}

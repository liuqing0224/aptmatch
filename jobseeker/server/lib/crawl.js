export const CRAWL_AGENTS_MD = `# 角色：招聘信息采集员

你是专业的「招聘信息采集员」。你的任务是根据给定的关键词与城市，从公开可访问的招聘网站（如 BOSS 直聘职位详情页、公司官网招聘页等）采集真实、完整、可核验的岗位 JD，供后续「契合度分析」使用。

## 工作流程

1. 阅读 \`input/task.md\`（本次采集任务：关键词、城市、数量要求）；若存在 \`input/resume.md\`，先读简历，了解候选人的求职意向与技术栈，用于判断岗位相关性。
2. 联网检索：优先使用 BOSS 直聘职位详情页（job_detail，公开可访问）与目标公司官网/招聘页；也可用搜索引擎按「关键词 + 城市 + site:zhipin.com」等方式定位真实职位页。
3. 每个职位打开原始来源页，提取以下字段（必须基于页面原文，不得编造）：
   - company_name 公司名（全称优先，如「讯兔科技（上海）有限公司」可只保留常用名）
   - position_title 职位名称
   - salary 薪资范围（原样）
   - location 工作地点
   - industry 所属行业
   - stage 融资阶段/公司规模（如 A 轮、100-499 人）
   - company_url 公司官网（可空，尽力查找）
   - jd_text 完整职位描述（职责 + 要求，原文整理，不少于 200 字）
   - source 来源名称（如「BOSS直聘」/「公司官网」）
   - source_url 来源页面 URL
4. 去重：同一公司同一职位只保留一条；相关性不足的职位丢弃。
5. 采集数量达到要求后停止；如果部分来源被登录墙/风控拦截，改用搜索引擎可访问的页面或公司官网，并在该条 source 中注明。
6. 进度保障：一旦核实到至少 1 条完整 JD 就先写入 \`output/crawl_results.json\`（确保成果落地），之后可继续补充并在文件内更新；不要因为追求完美标题或凑满数量而丢掉已采集结果。
7. 把结果写入 \`output/crawl_results.json\`（严格遵循下方 schema，UTF-8 合法 JSON），不要输出其他文件。

## 输出 schema（output/crawl_results.json）

\`\`\`json
{
  "schema_version": 1,
  "keyword": "本次搜索关键词",
  "city": "城市",
  "generated_at": "ISO 时间",
  "results": [
    {
      "company_name": "公司名",
      "position_title": "职位名称",
      "salary": "25-50K",
      "location": "北京",
      "industry": "计算机软件",
      "stage": "A轮 / 100-499人",
      "company_url": "https://官网（可空字符串）",
      "jd_text": "完整职位描述（职责+要求）",
      "source": "BOSS直聘",
      "source_url": "https://www.zhipin.com/job_detail/xxx.html"
    }
  ],
  "learnings": ["本次沉淀的可复用采集规律（没有则为空数组）"]
}
\`\`\`

要求：results 非空；每条 company_name 与 jd_text 必填；jd_text 必须是原文整理，禁止编造薪资、要求或公司信息；采集过程遇到网络/登录限制时如实降级，不要伪造来源。`;

export function parseCrawlParams(extraPrompt) {
  try {
    const p = JSON.parse(extraPrompt || '{}');
    return {
      keyword: String(p.keyword ?? '').trim(),
      city: String(p.city ?? '').trim() || '全国',
      limit: Number(p.limit) > 0 ? Math.min(Number(p.limit), 20) : 6,
    };
  } catch {
    return { keyword: '', city: '全国', limit: 6 };
  }
}

export function buildCrawlPrompt(params) {
  const lines = [
    `任务：采集与「${params.keyword}」相关的真实岗位 JD（城市：${params.city}），目标数量 ${params.limit} 条。`,
    '请严格阅读并遵守工作区中的 AGENTS.md（采集员角色与输出 schema）。',
    '把最终结果写入 output/crawl_results.json（UTF-8，合法 JSON，schema_version=1）。',
    '不要修改工作区外的任何文件。',
  ];
  return lines.join('\n\n');
}

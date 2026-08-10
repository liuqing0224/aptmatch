export async function extractText({ buffer, filename }) {
  const ext = (filename || '').toLowerCase();
  if (ext.endsWith('.pdf')) return extractPdf(buffer);
  if (ext.endsWith('.docx')) return extractDocx(buffer);
  return buffer.toString('utf8');
}

export async function extractPdf(buffer) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text || '';
}

export async function extractDocx(buffer) {
  const mammoth = (await import('mammoth')).default;
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

/** 常见且不可能是姓名的行/词，跳过 */
const NAME_STOP_WORDS = new Set([
  '个人简历', '简历', '履历', '求职简历', '求职意向', '教育背景', '工作经历', '工作履历',
  '项目经验', '实习经历', '校园经历', '自我评价', '专业技能', '联系方式', '基本信息',
  '荣誉证书', '兴趣爱好', '姓名', '性别', '年龄', '籍贯', '电话', '邮箱', '手机', '期望',
  '工作描述', '个人描述', '个人简介', '自我介绍', '求职信', '简历全文', '完整简历',
  '中文简历', '英文简历', '简历模板', '模板', '新建文档', '未命名', '文档', '文本',
  '测试', '测试简历', '简历测试', '个人资料', '资料', '详细简历',
  'resume', 'cv', 'curriculum vitae',
]);

const HEADER_RE = /^(个人简历|简历|履历|求职简历|curriculum vitae|resume|cv)\s*[:：\-—]?$/i;

// 「姓名：xxx」/「姓 名：xxx」
const NAME_FIELD_RE = /姓\s*名\s*[:：]\s*([^\s，,。;；|｜]{2,20})/i;

function isPlausibleName(s) {
  if (!s) return false;
  if (s.length < 2) return false;
  if (/[@\d]/.test(s)) return false;
  if (NAME_STOP_WORDS.has(s.toLowerCase())) return false;
  if (/^[\u4e00-\u9fa5]{2,4}$/.test(s)) return true;
  if (/^[A-Za-z][A-Za-z .'’-]{1,29}$/.test(s)) return true;
  return false;
}

function firstTokenOf(line) {
  const parts = line.split(/[\s|｜·,，、:：\-—]+/).filter(Boolean);
  return parts[0] || '';
}

function nameFromLine(line) {
  if (!line) return '';
  // 姓名：xxx
  let m = line.match(NAME_FIELD_RE);
  if (m && isPlausibleName(m[1].trim())) return m[1].trim();
  // “张三 个人简历” / “张三的简历”
  m = line.match(/^([^\s，,。;；|｜]{2,12})\s*(?:的)?(?:个人|求职)?(?:简历|履历|resume|cv)\s*$/i);
  if (m && isPlausibleName(m[1].trim())) return m[1].trim();
  // “个人简历：张三” / “简历-张三”
  m = line.match(/^(?:个人|求职)?(?:简历|履历|resume|cv)\s*[:：\-—]?\s*([^\s，,。;；|｜]{2,20})$/i);
  if (m && isPlausibleName(m[1].trim())) return m[1].trim();
  // 整行就是中文名（2-4 字）
  if (/^[\u4e00-\u9fa5]{2,4}$/.test(line)) return line;
  // 英文全名（2-3 个词）
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 3 && line.length <= 30 && /^[A-Za-z][A-Za-z .'’-]*$/.test(line)) {
    return line;
  }
  // 形如 “张三 | 男 | 1995” 取第一段
  const tok = firstTokenOf(line);
  if (isPlausibleName(tok)) return tok;
  return '';
}

/**
 * 从简历文本（必要时回退文件名）推断姓名。
 * 返回空串表示未能识别。
 */
export function parseName(text, filename) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    const m = line.match(NAME_FIELD_RE);
    if (m && isPlausibleName(m[1].trim())) return m[1].trim();
  }
  for (const line of lines.slice(0, 8)) {
    if (HEADER_RE.test(line)) continue;
    const n = nameFromLine(line);
    if (n) return n;
  }
  // 回退：从文件名推断（如 张三的简历.pdf / 张三-前端-5年.pdf）
  const base = String(filename || '').replace(/\.[^.]+$/, '');
  const cleaned = base
    .replace(/(?:的)?(?:个人|求职)?(?:简历|履历|resume|cv)/gi, '')
    .replace(/\d{4}[-_.]\d{1,2}[-_.]\d{1,2}/g, '')
    .replace(/[-_\s（）()【】\[\]]+/g, '')
    .trim();
  if (isPlausibleName(cleaned)) return cleaned;
  const tok = firstTokenOf(base.replace(/[-_\s（）()【】\[\]]+/g, ' '));
  if (isPlausibleName(tok)) return tok;
  return '';
}

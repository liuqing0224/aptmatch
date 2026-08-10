import PDFDocument from 'pdfkit';
import fs from 'node:fs';

const CJK_FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/System/Library/Fonts/STHeiti Light.ttc',
  '/System/Library/Fonts/Hiragino Sans GB.ttc',
  '/System/Library/Fonts/PingFang.ttc',
  'C:/Windows/Fonts/msyh.ttc',
  'C:/Windows/Fonts/simhei.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
];

let cjkFontPathCache = null;

export function findCjkFont() {
  if (cjkFontPathCache !== null) return cjkFontPathCache;
  for (const p of CJK_FONT_CANDIDATES) {
    try {
      if (fs.existsSync(p)) {
        cjkFontPathCache = p;
        return p;
      }
    } catch {
      /* 忽略 */
    }
  }
  cjkFontPathCache = '';
  return cjkFontPathCache;
}

function addText(doc, text, opts = {}) {
  const x = opts.x;
  const y = opts.y;
  const base = findCjkFont() ? 'CJK' : 'Helvetica';
  const style = findCjkFont() && opts.bold ? 'Bold' : '';
  const font = opts.font ?? base;
  if (x != null && y != null) {
    doc.font(font + style).fontSize(opts.size ?? 11).text(String(text), x, y, { width: opts.width });
  } else {
    doc.font(font + style).fontSize(opts.size ?? 11).text(String(text), { width: opts.width });
  }
}

export function createPdfDoc() {
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  const fontPath = findCjkFont();
  if (fontPath) {
    doc.registerFont('CJK', fontPath);
    try {
      doc.registerFont('CJKBold', fontPath);
    } catch {
      /* 加粗用同一字体 */
    }
  }
  return doc;
}

function heading(doc, text, size = 14) {
  doc.moveDown(0.6);
  addText(doc, text, { size, bold: true });
  doc.moveDown(0.2);
}

export function buildFitReportPdf(task, report) {
  const doc = createPdfDoc();
  const fontPath = findCjkFont();

  addText(doc, `契合度报告：${task?.company?.name ?? ''}`, { size: 20, bold: true });
  doc.moveDown(0.4);
  addText(doc, `候选人：${task?.resume?.name ?? ''}    总分：${report.overall_score}（${report.grade}）`);
  addText(doc, `生成时间：${new Date().toLocaleString('zh-CN')}`);
  doc.moveDown(0.6);
  addText(doc, `> ${report.summary}`, { width: 500 });
  doc.moveDown();

  heading(doc, '各维度得分');
  for (const d of report.dimensions) {
    doc.moveDown(0.2);
    addText(doc, `• ${d.label}：${Math.round(d.score)}/100（权重 ${d.weight}%）`, { bold: true });
    addText(doc, d.reason, { size: 10, width: 500 });
  }

  heading(doc, '匹配要点');
  for (const m of report.matched) addText(doc, `- ${m}`, { size: 10 });

  heading(doc, '差距与弥补');
  for (const g of report.gaps) {
    addText(doc, `- ${g.item}（${g.severity}）：${g.mitigation}`, { size: 10 });
  }

  heading(doc, '优势（面试突出）');
  for (const s of report.strengths) addText(doc, `- ${s}`, { size: 10 });

  heading(doc, '风险与不确定性');
  if (report.risks.length) for (const x of report.risks) addText(doc, `- ${x}`, { size: 10 });
  else addText(doc, '- 无明显风险', { size: 10 });

  heading(doc, '建议向公司确认的问题');
  for (const q of report.questions) {
    addText(doc, `- ${q.question}${q.why ? `（原因：${q.why}）` : ''}`, { size: 10 });
  }

  heading(doc, '可执行建议');
  for (const s of report.suggestions) addText(doc, `- ${s}`, { size: 10 });

  heading(doc, '调研来源');
  if (report.research.length) {
    for (const x of report.research) {
      addText(doc, `- ${x.source}${x.url ? `（${x.url}）` : ''}：${x.finding}`, { size: 10 });
    }
  } else {
    addText(doc, '- 本次未做额外联网调研', { size: 10 });
  }

  doc.end();
  return doc;
}

export function buildComparePdf(rows, dimKeys, title = '跨公司对比') {
  const doc = createPdfDoc();
  addText(doc, title, { size: 20, bold: true });
  doc.moveDown(0.6);

  const header = ['公司', '总分', '等级', ...dimKeys];
  const colWidths = [110, 44, 44, ...dimKeys.map(() => 44)];
  const left = 48;

  doc.font(findCjkFont() ? 'CJK' : 'Helvetica');
  let x = left;
  const top = doc.y;
  header.forEach((h, i) => {
    doc.fontSize(9).text(h, x, top, { width: colWidths[i] - 4, lineBreak: false });
    x += colWidths[i];
  });
  doc.moveDown();

  for (const row of rows) {
    const y = doc.y;
    x = left;
    const cells = [row.company_name, String(row.overall_score ?? ''), row.grade ?? ''];
    for (const k of dimKeys) {
      const s = row.dimensions?.[k]?.score;
      cells.push(s != null ? String(Math.round(s)) : '-');
    }
    cells.forEach((c, i) => {
      doc.fontSize(9).text(c, x, y, { width: colWidths[i] - 4, lineBreak: false });
      x += colWidths[i];
    });
    doc.moveDown(0.4);
    // 防止表格超出页底自动分页
    if (doc.y > doc.page.height - 80) doc.addPage();
  }

  doc.end();
  return doc;
}

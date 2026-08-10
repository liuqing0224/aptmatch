import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import { extractDocx, extractPdf, extractText, parseName } from '../lib/extract.js';

export function buildPdf(text) {
  const doc = new PDFDocument({ margin: 50 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => doc.on('end', r));
  doc.fontSize(12).text(text);
  doc.end();
  return done.then(() => Buffer.concat(chunks));
}

export async function buildDocx(text) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('extractText', () => {
  it('解析 PDF 文本', async () => {
    const text = await extractPdf(await buildPdf('Hello Resume PDF'));
    expect(text).toContain('Hello Resume PDF');
  });

  it('解析 DOCX 文本', async () => {
    const buf = await buildDocx('前端工程师 五年经验');
    const text = await extractDocx(buf);
    expect(text).toContain('前端工程师');
  });

  it('按扩展名路由到对应解析器', async () => {
    const pdf = await extractText({ buffer: await buildPdf('PDF Content'), filename: 'a.pdf' });
    expect(pdf).toContain('PDF Content');
    const docx = await extractText({ buffer: await buildDocx('DOCX Content'), filename: 'b.docx' });
    expect(docx).toContain('DOCX Content');
    const plain = await extractText({ buffer: Buffer.from('纯文本内容'), filename: 'c.txt' });
    expect(plain).toContain('纯文本内容');
  });
});

describe('parseName', () => {
  it('从「姓名：」字段提取', () => {
    expect(parseName('姓名：张三\n男 · 28 岁\n前端工程师')).toBe('张三');
    expect(parseName('个人简历\n姓 名：李四\n电话：13800000000')).toBe('李四');
  });

  it('从首行提取中文名', () => {
    expect(parseName('王五\n男 | 5 年经验\n后端开发')).toBe('王五');
    expect(parseName('赵六 | 前端 | 北京')).toBe('赵六');
  });

  it('跳过「个人简历」等标题行', () => {
    expect(parseName('个人简历\n钱七\n手机：139…')).toBe('钱七');
    expect(parseName('resume\nJohn Smith\nSoftware Engineer')).toBe('John Smith');
  });

  it('文本无名字时回退文件名', () => {
    expect(parseName('前端工程师\n工作经历…', '孙八-前端-5年.pdf')).toBe('孙八');
    expect(parseName('', '周九的简历.docx')).toBe('周九');
    expect(parseName('', '简历-吴十.pdf')).toBe('吴十');
  });

  it('无法识别时返回空串', () => {
    expect(parseName('仅有一段工作描述\n没有姓名信息', '工作描述.txt')).toBe('');
  });
});

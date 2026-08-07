import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import { extractDocx, extractPdf, extractText } from '../lib/extract.js';

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

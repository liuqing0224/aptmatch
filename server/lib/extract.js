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

/** A small PDF for the tests: one array of text lines per page, set in Helvetica. */
export function makePdf(pages) {
  const esc = (t) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const objects = [];
  const add = (body) => objects.push(body);
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = objects.length + 1 + pages.length * 2;
  const kids = [];
  for (const lines of pages) {
    const stream = [
      'BT',
      '/F1 14 Tf',
      '72 720 Td',
      '20 TL',
      ...lines.map((l) => `(${esc(l)}) Tj T*`),
      'ET',
    ].join('\n');
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
      ),
    );
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

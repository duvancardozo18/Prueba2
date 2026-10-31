/* export.js — PDF, Excel y CSV sin dependencias */
(function (root) {
  'use strict';
  const COLS = [
    ['conjunto', 'Conjunto'], ['chip', 'CHIP'], ['direccion', 'Dirección'], ['tipo', 'Tipo'], ['interior', 'Interior'],
    ['unidad', 'Unidad'], ['barrio', 'Barrio'], ['manzana', 'Manzana'], ['predio', 'Predio'], ['clase', 'Clase']
  ];

  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // evita inyección de fórmulas
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  const colsCon = filas => filas.some(r => r.conjunto) ? COLS : COLS.filter(c => c[0] !== 'conjunto');
  function toCsv(filas) {
    const COLS = colsCon(filas);
    const head = COLS.map(c => c[1]).join(',');
    const body = filas.map(r => COLS.map(c => csvCell(r[c[0]])).join(','));
    return '\ufeff' + [head].concat(body).join('\r\n');
  }

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Excel abre tablas HTML como .xls; columnas como texto para conservar ceros
  function toXls(filas) {
    const COLS = colsCon(filas);
    const th = COLS.map(c => `<th>${c[1]}</th>`).join('');
    const tr = filas.map(r => '<tr>' + COLS.map(c =>
      `<td style="mso-number-format:'\\@'">${esc(r[c[0]])}</td>`).join('') + '</tr>').join('');
    return '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1">' +
      `<tr>${th}</tr>${tr}</table></body></html>`;
  }

  /* ---------- PDF (generador mínimo, sin dependencias) ---------- */
  // Texto en WinAnsi (latin-1): tildes y ñ se conservan; otros caracteres se aproximan
  function pdfTxt(v) {
    return String(v == null ? '' : v).replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
      .replace(/[^\x20-\xff]/g, '?').replace(/([\\()])/g, '\\$1');
  }
  function recortar(v, ancho, size) {
    const s = String(v == null ? '' : v), max = Math.floor(ancho / (size * 0.52));
    return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '.' : s;
  }

  // Tabla en A4 horizontal con encabezado repetido, numeración y franjas
  function toPdf(filas, opts) {
    opts = opts || {};
    const W = 842, H = 595, M = 32, FS = 8.5, RH = 15;
    const conConjunto = filas.some(r => r.conjunto);
    const cols = (conConjunto ? [['conjunto', 'Conjunto', 130]] : []).concat([['chip', 'CHIP', 78], ['direccion', 'Dirección', 210], ['tipo', 'Tipo', 70], ['interior', 'Interior', 48],
      ['unidad', 'Unidad', 62], ['barrio', 'Barrio', 160], ['manzana', 'Manzana', 50], ['predio', 'Predio', 50]]);
    const suma = cols.reduce((a, c) => a + c[2], 0);
    cols.forEach(c => { c[2] = c[2] * (W - M * 2) / suma; });
    const anchoTabla = W - M * 2;
    const titulo = opts.titulo || 'Inmuebles - Catastro Bogotá';
    const sub = opts.subtitulo || '';
    const fecha = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
    const porPagina = Math.floor((H - M * 2 - 70) / RH);
    const paginas = [];
    for (let i = 0; i < Math.max(1, filas.length); i += porPagina) paginas.push(filas.slice(i, i + porPagina));
    const t = (x, y, txt, f, size, rgb) => `${rgb || '0.11 0.15 0.19'} rg BT /${f || 'F1'} ${size || FS} Tf ${x} ${y} Td (${pdfTxt(txt)}) Tj ET\n`;
    const streams = paginas.map((rows, pi) => {
      let c = '';
      let y = H - M - 14;
      c += t(M, y, titulo, 'F2', 15, '0.04 0.36 0.68');
      c += t(W - M - fecha.length * 4.6, y, fecha, 'F1', 8.5, '0.35 0.4 0.48');
      y -= 16;
      if (sub) c += t(M, y, sub, 'F1', 9, '0.35 0.4 0.48');
      y -= 22;
      // encabezado de tabla
      c += `0.04 0.36 0.68 rg ${M} ${y - 4} ${anchoTabla} ${RH + 2} re f\n`;
      let x = M;
      cols.forEach(col => { c += t(x + 4, y + 1, col[1], 'F2', FS, '1 1 1'); x += col[2]; });
      y -= RH + 2;
      rows.forEach((r, i) => {
        if (i % 2) c += `0.94 0.96 0.98 rg ${M} ${y - 4} ${anchoTabla} ${RH} re f\n`;
        x = M;
        cols.forEach(col => { c += t(x + 4, y, recortar(r[col[0]], col[2] - 8, FS)); x += col[2]; });
        y -= RH;
      });
      if (!rows.length) c += t(M + 4, y, 'Sin resultados.');
      c += `0.85 0.88 0.91 RG 0.5 w ${M} ${M} m ${W - M} ${M} l S\n`;
      c += t(M, M - 12, `${filas.length} registros`, 'F1', 8, '0.35 0.4 0.48');
      c += t(W - M - 60, M - 12, `Página ${pi + 1} de ${paginas.length}`, 'F1', 8, '0.35 0.4 0.48');
      return c;
    });
    // Ensamblar objetos
    const objs = [];
    const n = paginas.length;
    const pageIds = paginas.map((_, i) => 5 + i * 2);
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[2] = `<< /Type /Pages /Kids [${pageIds.map(id => id + ' 0 R').join(' ')}] /Count ${n} >>`;
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    streams.forEach((st, i) => {
      objs[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
      objs[pageIds[i] + 1] = `<< /Length ${st.length} >>\nstream\n${st}endstream`;
    });
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const off = [];
    for (let i = 1; i < objs.length; i++) { off[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
    const xref = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + off.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }

  function descargar(nombre, contenido, mime) {
    const blob = new Blob([contenido], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  const api = {
    COLS, toCsv, toXls, toPdf,
    descargarCsv: (f, n) => descargar((n || 'inmuebles') + '.csv', toCsv(f), 'text/csv;charset=utf-8'),
    descargarPdf: (f, n, o) => descargar((n || 'inmuebles') + '.pdf', toPdf(f, o), 'application/pdf'),
    descargarXls: (f, n) => descargar((n || 'inmuebles') + '.xls', toXls(f), 'application/vnd.ms-excel')
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ExportUtil = api;
})(typeof window !== 'undefined' ? window : globalThis);

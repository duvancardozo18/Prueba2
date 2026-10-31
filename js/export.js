/* export.js — CSV y Excel sin dependencias */
(function (root) {
  'use strict';
  const COLS = [
    ['chip', 'CHIP'], ['direccion', 'Dirección'], ['tipo', 'Tipo'], ['interior', 'Interior'],
    ['unidad', 'Unidad'], ['barrio', 'Barrio'], ['manzana', 'Manzana'], ['predio', 'Predio'], ['clase', 'Clase']
  ];

  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // evita inyección de fórmulas
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(filas) {
    const head = COLS.map(c => c[1]).join(',');
    const body = filas.map(r => COLS.map(c => csvCell(r[c[0]])).join(','));
    return '\ufeff' + [head].concat(body).join('\r\n');
  }

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Excel abre tablas HTML como .xls; columnas como texto para conservar ceros
  function toXls(filas) {
    const th = COLS.map(c => `<th>${c[1]}</th>`).join('');
    const tr = filas.map(r => '<tr>' + COLS.map(c =>
      `<td style="mso-number-format:'\\@'">${esc(r[c[0]])}</td>`).join('') + '</tr>').join('');
    return '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1">' +
      `<tr>${th}</tr>${tr}</table></body></html>`;
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
    COLS, toCsv, toXls,
    descargarCsv: (f, n) => descargar((n || 'inmuebles') + '.csv', toCsv(f), 'text/csv;charset=utf-8'),
    descargarXls: (f, n) => descargar((n || 'inmuebles') + '.xls', toXls(f), 'application/vnd.ms-excel')
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ExportUtil = api;
})(typeof window !== 'undefined' ? window : globalThis);

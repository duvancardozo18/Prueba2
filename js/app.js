/* app.js — interfaz */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const API = window.CatastroAPI, EXP = window.ExportUtil;
  let filas = [], orden = { k: 'direccion', asc: true };

  function leerForm() {
    return {
      nombre: $('nombre').value.trim(), direccion: $('direccion').value.trim(), barrio: $('barrio').value.trim(),
      clase: $('clase').value.trim(), chip: $('chip').value.trim(), manzana: $('manzana').value.trim(),
      predio: $('predio').value.trim()
    };
  }
  function estado(msg, cls) { const e = $('estado'); e.textContent = msg; e.className = 'estado ' + (cls || ''); }

  function actualizarSql() {
    $('sqlOut').textContent = API.buildWhere(leerForm()) + '\n\n' + API.buildParams(API.buildWhere(leerForm())).toString();
  }

  function natural(a, b) { return String(a).localeCompare(String(b), 'es', { numeric: true }); }

  function visibles() {
    const t = $('filtroTexto').value.trim().toUpperCase(), tipo = $('filtroTipo').value;
    return filas.filter(r => (!tipo || r.tipo === tipo) && (!t || r.direccion.toUpperCase().includes(t) || r.chip.toUpperCase().includes(t)))
      .sort((a, b) => (orden.asc ? 1 : -1) * natural(a[orden.k], b[orden.k]));
  }

  function pintar() {
    const v = visibles(), tb = document.querySelector('#tabla tbody');
    tb.innerHTML = '';
    const frag = document.createDocumentFragment();
    v.forEach(r => {
      const tr = document.createElement('tr');
      ['chip', 'direccion', 'tipo', 'interior', 'unidad', 'barrio', 'manzana', 'predio', 'clase'].forEach(k => {
        const td = document.createElement('td');
        td.textContent = r[k];
        if (k === 'chip') td.className = 'mono';
        tr.appendChild(td);
      });
      frag.appendChild(tr);
    });
    tb.appendChild(frag);
    const cnt = t => filas.filter(r => r.tipo === t).length;
    $('resumen').innerHTML = `<span class="chip">Total: <b>${filas.length}</b></span>` +
      `<span class="chip">Apartamentos: <b>${cnt('Apartamento')}</b></span>` +
      `<span class="chip">Garajes: <b>${cnt('Garaje')}</b></span>` +
      `<span class="chip">Otros: <b>${cnt('Otro')}</b></span>` +
      `<span class="chip">Mostrando: <b>${v.length}</b></span>`;
  }

  function mostrar(norm, alertas) {
    filas = norm.filas;
    $('resultados').hidden = false;
    const al = alertas.slice();
    if (norm.duplicados) al.push(`Se descartaron ${norm.duplicados} registros con CHIP repetido.`);
    if (norm.sinChip) al.push(`${norm.sinChip} registros no traen CHIP.`);
    const gj = filas.filter(r => r.tipo === 'Garaje').map(r => parseInt(r.unidad.replace(/\D/g, ''), 10)).filter(n => !isNaN(n));
    if (gj.length) {
      const set = new Set(gj), faltan = [];
      for (let i = 1; i <= Math.max.apply(null, gj); i++) if (!set.has(i)) faltan.push(i);
      if (faltan.length) al.push(`Garajes con numeración ausente (hasta GJ ${Math.max.apply(null, gj)}): ${faltan.join(', ')}. Puede ser normal; verifique en la fuente.`);
    }
    $('alertas').innerHTML = al.map(a => `<p>⚠ ${a.replace(/</g, '&lt;')}</p>`).join('');
    pintar();
    $('resultados').scrollIntoView({ behavior: 'smooth' });
  }

  async function buscar(ev) {
    ev.preventDefault();
    actualizarSql();
    const f = leerForm(), max = Math.max(1, parseInt($('max').value, 10) || 2000);
    if (!(f.direccion || f.chip || f.manzana || f.predio || f.barrio)) { estado('Ingrese al menos un criterio de búsqueda.', 'err'); return; }
    $('btnBuscar').disabled = true;
    estado('Consultando el servicio…');
    try {
      const r = await API.consultar($('endpoint').value.trim(), f, max, (n, t) => estado(`Descargados ${n} de ${t}…`));
      const alertas = [];
      if (r.total > max) alertas.push(`El servicio reporta ${r.total} registros pero el máximo configurado es ${max}: resultados truncados.`);
      if (r.features.length < Math.min(r.total, max)) alertas.push(`Se recibieron ${r.features.length} de ${r.total} registros: posible truncamiento del servidor.`);
      mostrar(API.normalizar(r.features), alertas);
      estado(`Listo: ${r.features.length} registros recibidos (el servicio reporta ${r.total}).`, alertas.length ? 'warn' : 'ok');
    } catch (e) {
      estado('No se pudo consultar: ' + e.message + '. Si es un bloqueo de red/CORS, abra la consulta generada en el navegador y use «Cargar JSON pegado».', 'err');
    } finally { $('btnBuscar').disabled = false; }
  }

  async function verificar() {
    estado('Verificando servicio…');
    try {
      const v = await API.verificarServicio($('endpoint').value.trim());
      const msg = `Capa: ${v.nombre} · límite por consulta: ${v.maxRecordCount} · paginación: ${v.soportaPaginacion ? 'sí' : 'no informada'}` +
        (v.camposFaltantes.length ? ` · CAMPOS FALTANTES: ${v.camposFaltantes.join(', ')}` : ' · campos requeridos presentes');
      estado(msg, v.camposFaltantes.length ? 'err' : 'ok');
    } catch (e) { estado('El servicio no respondió: ' + e.message, 'err'); }
  }

  function cargarPegado() {
    $('pegarBox').open = true;
    const txt = $('jsonPegado').value.trim();
    if (!txt) { estado('Pegue primero el JSON en el cuadro de texto.', 'warn'); return; }
    try {
      const j = JSON.parse(txt);
      const feats = j.features || (Array.isArray(j) ? j : null);
      if (!feats) throw new Error('No se encontró «features».');
      const alertas = [];
      if (j.exceededTransferLimit) alertas.push('El JSON indica exceededTransferLimit: hay más registros que no se incluyeron.');
      mostrar(API.normalizar(feats), alertas);
      estado(`JSON cargado: ${feats.length} registros.`, alertas.length ? 'warn' : 'ok');
    } catch (e) { estado('JSON no válido: ' + e.message, 'err'); }
  }

  function nombreArchivo() {
    const n = ($('nombre').value || 'inmuebles').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
    return n || 'inmuebles';
  }

  $('form').addEventListener('submit', buscar);
  $('form').addEventListener('input', actualizarSql);
  $('btnVerificar').addEventListener('click', verificar);
  $('btnPegar').addEventListener('click', cargarPegado);
  $('btnCsv').addEventListener('click', () => EXP.descargarCsv(visibles(), nombreArchivo()));
  $('btnXls').addEventListener('click', () => EXP.descargarXls(visibles(), nombreArchivo()));
  $('filtroTexto').addEventListener('input', pintar);
  $('filtroTipo').addEventListener('change', pintar);
  document.querySelectorAll('#tabla th').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.k; orden = { k, asc: orden.k === k ? !orden.asc : true }; pintar();
  }));

  const EJEMPLO = {exceededTransferLimit:false,features:[
    ['AAA0107SFDE','KR 19 164 53 GJ 1'],['AAA0107SFOM','KR 19 164 53 GJ 10'],
    ['AAA0107SEZM','KR 19 164 53 IN 1 AP 101'],['AAA0107SFAW','KR 19 164 53 IN 1 AP 102'],
    ['AAA0107SFBS','KR 19 164 53 IN 1 AP 103']
  ].map(function(x){return {attributes:{PRECHIP:x[0],PREDIRECC:x[1],PRECLASE:'P',PRENBARRIO:'EL TOBERIN',PRECMANZ:'19',PRECPREDIO:'27'}};})};
  function cargarEjemplo() {
    $('jsonPegado').value = JSON.stringify(EJEMPLO);
    cargarPegado();
    estado('Ejemplo con 5 de las unidades del documento (no es el inventario completo).', 'warn');
  }
  const bEj = $('btnEjemplo'); if (bEj) bEj.addEventListener('click', cargarEjemplo);
  actualizarSql();
})();

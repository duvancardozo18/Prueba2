/* app.js — interfaz */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const API = window.CatastroAPI, EXP = window.ExportUtil;
  const COLS = ['direccion', 'tipo', 'interior', 'unidad', 'barrio', 'manzana', 'predio'];
  const TIPOS = ['Apartamento', 'Casa', 'Garaje', 'Otro'];
  let filas = [], orden = { k: 'direccion', asc: true }, filtroTipo = '';

  /* ---------- Selects de dirección ---------- */
  const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  function llenar(id, valores) {
    const s = $(id), frag = document.createDocumentFragment();
    valores.forEach(v => {
      const o = document.createElement('option');
      if (Array.isArray(v)) { o.value = v[0]; o.textContent = v[1] + ' (' + v[0] + ')'; } else { o.value = o.textContent = v; }
      frag.appendChild(o);
    });
    s.appendChild(frag);
  }
  const rango = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
  llenar('dVia', API.TIPOS_VIA);
  llenar('dNum', rango(1, 250));
  llenar('dCruce', rango(1, 250));
  llenar('dPlaca', rango(1, 99));
  ['dLetra', 'dLetraBis', 'dLetraCruce'].forEach(id => llenar(id, LETRAS));
  llenar('dCuadrante', API.CUADRANTES);
  llenar('dInterior', rango(1, 30));
  llenar('dUnidadTipo', API.UNIDADES);
  // Números de unidad: 1–99 (garajes, locales) y pisos 1–40 × 01–12 (AP 201, AP 1502…)
  const nums = new Set(rango(1, 99));
  for (let piso = 1; piso <= 40; piso++) for (let n = 1; n <= 12; n++) nums.add(String(piso * 100 + n));
  llenar('dUnidadNum', Array.from(nums).sort((a, b) => a - b));

  function leerDir() {
    return {
      via: $('dVia').value, num: $('dNum').value, letra: $('dLetra').value, bis: !!$('dBis').value,
      letraBis: $('dBis').value ? $('dLetraBis').value : '', cruce: $('dCruce').value,
      letraCruce: $('dLetraCruce').value, placa: $('dPlaca').value, cuadrante: $('dCuadrante').value,
      interior: $('dInterior').value, unidadTipo: $('dUnidadTipo').value, unidadNum: $('dUnidadNum').value
    };
  }
  const NOMBRE_VIA = Object.fromEntries(API.TIPOS_VIA);
  const ORDEN_REQ = ['dVia', 'dNum', 'dCruce', 'dPlaca'];
  function extras(on) {
    $('dirLinea').classList.toggle('con-extras', on);
    $('btnExtras').setAttribute('aria-expanded', String(on));
    $('btnExtras').textContent = on ? '− Ocultar letra, BIS y cuadrante' : '+ Letra, BIS o cuadrante';
  }
  function unidad(on) {
    $('dirUnidad').hidden = !on;
    $('btnUnidad').setAttribute('aria-expanded', String(on));
    $('btnUnidad').textContent = on ? '− Quitar unidad' : '+ Unidad dentro del predio';
    if (!on) ['dInterior', 'dUnidadTipo', 'dUnidadNum'].forEach(id => { $(id).value = ''; });
  }
  function actualizarDir() {
    const d = leerDir();
    $('dLetraBis').disabled = !d.bis;
    if (!d.bis) $('dLetraBis').value = '';
    const sinPlaca = !d.placa;
    ['dInterior', 'dUnidadTipo', 'dUnidadNum'].forEach(id => { $(id).disabled = sinPlaca; if (sinPlaca) $(id).value = ''; });
    $('dUnidadNum').disabled = sinPlaca || !$('dUnidadTipo').value;
    if (!$('dUnidadTipo').value) $('dUnidadNum').value = '';
    $('btnUnidad').disabled = sinPlaca;
    if (sinPlaca) unidad(false);
    // Resalta el siguiente campo por llenar
    const sig = ORDEN_REQ.find(id => !$(id).value);
    ORDEN_REQ.forEach(id => $(id).closest('.slot').classList.toggle('siguiente', id === sig));
    // Texto legible: "Carrera 16A BIS # 164 – 12 SUR · AP 201"
    const f = leerDir(), cat = API.buildDireccion(f);
    $('dirPreview').textContent = cat ? cat + (f.cuadrante && f.placa ? ' … ' + f.cuadrante : '') : '—';
    if (!f.via) { $('dirLegible').innerHTML = '<span class="vacio-dir">Elija la vía para empezar</span>'; return; }
    const pend = t => `<span class="pend">${t}</span>`;
    let h = NOMBRE_VIA[f.via] + ' ' + (f.num ? f.num + f.letra + (f.bis ? ' BIS' + (f.letraBis ? ' ' + f.letraBis : '') : '') : pend('nº'));
    h += ' # ' + (f.cruce ? f.cruce + f.letraCruce : pend('&nbsp;'));
    h += ' – ' + (f.placa ? f.placa : pend('&nbsp;'));
    if (f.cuadrante) h += ' ' + f.cuadrante;
    const u = [f.interior && 'Interior ' + f.interior, f.unidadTipo && (f.unidadNum ? f.unidadTipo + ' ' + f.unidadNum : 'solo ' + f.unidadTipo)].filter(Boolean);
    if (u.length) h += ' <small>· ' + u.join(' · ') + '</small>';
    $('dirLegible').innerHTML = h;
  }
  function limpiarDir() {
    ['dVia', 'dNum', 'dLetra', 'dBis', 'dLetraBis', 'dCruce', 'dLetraCruce', 'dPlaca', 'dCuadrante', 'dInterior', 'dUnidadTipo', 'dUnidadNum'].forEach(id => { $(id).value = ''; });
    actualizarDir(); actualizarSql();
  }

  /* ---------- Formulario ---------- */
  function leerForm() {
    return {
      nombre: $('nombre').value.trim(), dir: leerDir(), barrio: $('barrio').value.trim(),
      clase: $('clase').value, tipo: $('tipo').value, manzana: $('manzana').value.trim(), predio: $('predio').value.trim()
    };
  }
  function estado(msg, cls, id) { const e = $(id || 'estado'); e.textContent = msg; e.className = 'estado ' + (cls || ''); }
  function actualizarSql() {
    const w = API.buildWhere(leerForm());
    $('sqlOut').textContent = w + '\n\n' + $('endpoint').value.trim() + '?' + API.buildParams(w).toString();
  }

  /* ---------- Vistas ---------- */
  function vista(cual) {
    const info = cual === 'info';
    $('vistaBuscar').hidden = info; $('vistaInfo').hidden = !info;
    $('tabBuscar').setAttribute('aria-selected', String(!info));
    $('tabInfo').setAttribute('aria-selected', String(info));
    if (info) actualizarSql();
  }

  /* ---------- Filtrado ---------- */
  const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  function natural(a, b) { return String(a).localeCompare(String(b), 'es', { numeric: true }); }

  // Todas las palabras escritas deben aparecer (en cualquier orden) en dirección, unidad, interior, barrio o CHIP
  function coincideTexto(r, palabras) {
    if (!palabras.length) return true;
    const hay = ' ' + norm([r.direccion, r.unidad, r.interior && 'IN ' + r.interior, r.barrio, r.chip].join(' ')) + ' ';
    return palabras.every(p => hay.includes(' ' + p) || (p.length > 2 && hay.includes(p)));
  }
  function filtrar(sinTipo) {
    const palabras = norm($('filtroTexto').value).split(' ').filter(Boolean), inte = $('filtroInterior').value;
    return filas.filter(r => (sinTipo || !filtroTipo || r.tipo === filtroTipo) && (!inte || r.interior === inte) && coincideTexto(r, palabras));
  }
  function visibles() {
    return filtrar(false).sort((a, b) => (orden.asc ? 1 : -1) * natural(a[orden.k], b[orden.k]) || natural(a.direccion, b.direccion));
  }

  function pintarSegmentos() {
    const base = filtrar(true), cnt = t => base.filter(r => r.tipo === t).length;
    const opciones = [['', 'Todos', base.length]].concat(TIPOS.map(t => [t, t === 'Otro' ? 'Otros' : t + 's', cnt(t)]).filter(o => o[2] || o[0] === filtroTipo));
    $('segTipo').innerHTML = '';
    opciones.forEach(([v, txt, n]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.v = v; b.setAttribute('aria-pressed', String(v === filtroTipo));
      b.innerHTML = `${txt} <span>${n}</span>`;
      $('segTipo').appendChild(b);
    });
  }

  function pintar() {
    const v = visibles(), tb = document.querySelector('#tabla tbody'), frag = document.createDocumentFragment();
    v.forEach(r => {
      const tr = document.createElement('tr');
      COLS.forEach(k => {
        const td = document.createElement('td');
        td.textContent = r[k];
        if (k === 'direccion') td.className = 'mono';
        tr.appendChild(td);
      });
      frag.appendChild(tr);
    });
    tb.innerHTML = ''; tb.appendChild(frag);
    $('vacio').hidden = v.length > 0;
    $('cuenta').textContent = v.length === filas.length ? `${filas.length}` : `${v.length} de ${filas.length}`;
    document.querySelectorAll('#tabla th').forEach(th => th.setAttribute('aria-sort', th.dataset.k === orden.k ? (orden.asc ? 'ascending' : 'descending') : 'none'));
    pintarSegmentos();
  }

  function limpiarFiltros() { $('filtroTexto').value = ''; $('filtroInterior').value = ''; filtroTipo = ''; pintar(); }

  function mostrar(n, alertas) {
    filas = n.filas;
    vista('buscar');
    $('resultados').hidden = false;
    const interiores = Array.from(new Set(filas.map(r => r.interior).filter(Boolean))).sort(natural);
    $('filtroInterior').innerHTML = '<option value="">Todos</option>' + interiores.map(i => `<option value="${i.replace(/"/g, '')}">IN ${i.replace(/</g, '&lt;')}</option>`).join('');
    $('filtroInterior').closest('label').hidden = interiores.length < 2;
    $('filtroTexto').value = ''; filtroTipo = '';
    const al = alertas.slice();
    if (n.duplicados) al.push(`Se descartaron ${n.duplicados} registros repetidos.`);
    if (n.sinChip) al.push(`${n.sinChip} registros no traen CHIP.`);
    const gj = filas.filter(r => r.tipo === 'Garaje').map(r => parseInt(r.unidad.replace(/\D/g, ''), 10)).filter(x => !isNaN(x));
    if (gj.length) {
      const set = new Set(gj), max = Math.max.apply(null, gj), faltan = [];
      for (let i = 1; i <= max; i++) if (!set.has(i)) faltan.push(i);
      if (faltan.length) al.push(`Garajes con numeración ausente (hasta GJ ${max}): ${faltan.join(', ')}. Puede ser normal; verifique en la fuente.`);
    }
    $('alertas').innerHTML = al.map(a => `<p>⚠ ${a.replace(/</g, '&lt;')}</p>`).join('');
    pintar();
    $('resultados').scrollIntoView({ behavior: 'smooth' });
  }

  /* ---------- Acciones ---------- */
  async function buscar(ev) {
    ev.preventDefault();
    actualizarSql();
    const f = leerForm(), max = Math.max(1, parseInt($('max').value, 10) || 2000);
    if (!(API.buildDireccion(f.dir) || f.manzana || f.predio || f.barrio)) {
      estado('Elija al menos el tipo de vía y el número de la dirección (o un barrio).', 'err'); $('dVia').focus(); return;
    }
    $('btnBuscar').disabled = true;
    estado('Buscando…');
    try {
      const r = await API.consultar($('endpoint').value.trim(), f, max, (n, t) => estado(`Descargando ${n} de ${t}…`));
      const alertas = [];
      if (r.total > max) alertas.push(`Hay ${r.total} registros pero el máximo configurado es ${max}: resultados incompletos.`);
      if (r.features.length < Math.min(r.total, max)) alertas.push(`Se recibieron ${r.features.length} de ${r.total} registros: posible truncamiento del servidor.`);
      mostrar(API.normalizar(r.features), alertas);
      estado(r.features.length ? `Se encontraron ${r.features.length} inmuebles.` : 'No se encontraron inmuebles con esos datos. Pruebe con menos partes de la dirección.', alertas.length || !r.features.length ? 'warn' : 'ok');
    } catch (e) {
      estado('No se pudo consultar el servicio de Catastro (' + e.message + '). En la sección Info puede verificar el servicio o cargar los datos manualmente.', 'err');
    } finally { $('btnBuscar').disabled = false; }
  }

  async function verificar() {
    estado('Verificando servicio…', '', 'estadoInfo');
    try {
      const v = await API.verificarServicio($('endpoint').value.trim());
      const msg = `Capa: ${v.nombre} · límite por consulta: ${v.maxRecordCount} · paginación: ${v.soportaPaginacion ? 'sí' : 'no informada'}` +
        (v.camposFaltantes.length ? ` · CAMPOS FALTANTES: ${v.camposFaltantes.join(', ')}` : ' · campos requeridos presentes');
      estado(msg, v.camposFaltantes.length ? 'err' : 'ok', 'estadoInfo');
    } catch (e) { estado('El servicio no respondió: ' + e.message, 'err', 'estadoInfo'); }
  }

  function cargarPegado(msgExtra) {
    const txt = $('jsonPegado').value.trim();
    if (!txt) { estado('Pegue primero el JSON en el cuadro de texto.', 'warn', 'estadoInfo'); return; }
    try {
      const j = JSON.parse(txt);
      const feats = j.features || (Array.isArray(j) ? j : null);
      if (!feats) throw new Error('No se encontró «features».');
      const alertas = [];
      if (j.exceededTransferLimit) alertas.push('El JSON indica exceededTransferLimit: hay más registros que no se incluyeron.');
      mostrar(API.normalizar(feats), alertas);
      estado(typeof msgExtra === 'string' ? msgExtra : `Datos cargados: ${feats.length} registros.`, alertas.length || typeof msgExtra === 'string' ? 'warn' : 'ok');
      estado('', '', 'estadoInfo');
    } catch (e) { estado('JSON no válido: ' + e.message, 'err', 'estadoInfo'); }
  }

  const EJEMPLO = { exceededTransferLimit: false, features: [
    ['AAA0107SFDE', 'KR 19 164 53 GJ 1'], ['AAA0107SFOM', 'KR 19 164 53 GJ 10'],
    ['AAA0107SEZM', 'KR 19 164 53 IN 1 AP 101'], ['AAA0107SFAW', 'KR 19 164 53 IN 1 AP 102'],
    ['AAA0107SFBS', 'KR 19 164 53 IN 1 AP 103']
  ].map(x => ({ attributes: { PRECHIP: x[0], PREDIRECC: x[1], PRECLASE: 'P', PRENBARRIO: 'EL TOBERIN', PRECMANZ: '19', PRECPREDIO: '27' } })) };
  function cargarEjemplo() {
    $('jsonPegado').value = JSON.stringify(EJEMPLO, null, 1);
    cargarPegado('Ejemplo con 5 unidades de muestra (no es el inventario completo).');
  }

  function nombreArchivo() {
    const n = ($('nombre').value || 'inmuebles').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
    return n || 'inmuebles';
  }

  /* ---------- Eventos ---------- */
  $('tabBuscar').addEventListener('click', () => vista('buscar'));
  $('tabInfo').addEventListener('click', () => vista('info'));
  $('form').addEventListener('submit', buscar);
  $('form').addEventListener('input', () => { actualizarDir(); actualizarSql(); });
  $('form').addEventListener('change', () => { actualizarDir(); actualizarSql(); });
  $('endpoint').addEventListener('input', actualizarSql);
  $('btnLimpiarDir').addEventListener('click', limpiarDir);
  $('btnUnidad').addEventListener('click', () => { unidad($('dirUnidad').hidden); actualizarDir(); actualizarSql(); });
  $('btnExtras').addEventListener('click', () => extras(!$('dirLinea').classList.contains('con-extras')));
  $('btnVerificar').addEventListener('click', verificar);
  $('btnPegar').addEventListener('click', () => cargarPegado());
  $('btnEjemplo').addEventListener('click', cargarEjemplo);
  $('btnCsv').addEventListener('click', () => EXP.descargarCsv(visibles(), nombreArchivo()));
  $('btnXls').addEventListener('click', () => EXP.descargarXls(visibles(), nombreArchivo()));
  $('filtroTexto').addEventListener('input', pintar);
  $('filtroInterior').addEventListener('change', pintar);
  $('btnLimpiarFiltros').addEventListener('click', limpiarFiltros);
  $('segTipo').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    filtroTipo = b.dataset.v; pintar();
  });
  document.querySelectorAll('#tabla th').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.k; orden = { k, asc: orden.k === k ? !orden.asc : true }; pintar();
  }));

  actualizarDir();
  actualizarSql();
})();

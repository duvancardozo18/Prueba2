/* catastro-api.js — consulta ArcGIS REST y clasificación de unidades */
(function (root) {
  'use strict';

  const OUT_FIELDS = ['PRECHIP', 'PREDIRECC', 'PRECLASE', 'PRENBARRIO', 'PRECMANZ', 'PRECPREDIO', 'PREUVIVIEN'];
  // Posibles campos con el nombre del conjunto/edificio (varía según la capa); se usa el primero que traiga valor
  const CAMPOS_CONJUNTO = ['PRENOMPH', 'NOMBRE_PH', 'NOMBREPH', 'PRENOMBRE', 'NOMBRE_CONJUNTO', 'CONJUNTO', 'NOM_PH', 'NOMBRE_EDIFICIO', 'NOMBRE'];
  const PAGE = 1000;
  // Segunda consulta: censo de equipamiento comunal PH (nombre de la copropiedad por código de lote)
  const ENDPOINT_PH = 'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/ordenamientoterritorial/censoequipamientocomunalph/MapServer/0/query';
  const CAMPOS_PH = ['CODIGO_LOTE', 'DIRECCION', 'NOMBRE_COPROPIEDAD', 'CONJUNTO_CERRADO', 'TIPO_PH', 'NOMBRE_BARRIO_CATASTRO']; // tamaño de página solicitado (el servidor puede limitarlo)

  /* Código de lote normalizado a 12 dígitos (barrio 6 + manzana 3 + predio 3).
     El censo PH puede publicar CODIGO_LOTE como número (pierde los ceros a la izquierda:
     8407019027 en lugar de 008407019027) o con decimales ("8407019027.0"). */
  function normLote(v) {
    let t = String(v == null ? '' : v).trim().replace(/\.0+$/, '');
    if (/^\d+$/.test(t) && t.length < 12) t = t.padStart(12, '0');
    return t;
  }

  // Escapa comillas simples para SQL y comodines LIKE no se escapan a propósito
  function sqlStr(v) { return String(v).trim().replace(/'/g, "''").toUpperCase(); }

  // Tipos de vía con la abreviatura que usa Catastro en PREDIRECC
  const TIPOS_VIA = [
    ['CL', 'Calle'], ['KR', 'Carrera'], ['AC', 'Avenida Calle'], ['AK', 'Avenida Carrera'],
    ['DG', 'Diagonal'], ['TV', 'Transversal'], ['AV', 'Avenida']
  ];
  const CUADRANTES = ['SUR', 'ESTE'];

  /* Arma la dirección en el formato de PREDIRECC a partir de las partes
     seleccionadas, p. ej. {via:'KR', num:'19', cruce:'164', placa:'53'} → "KR 19 164 53".
     Devuelve el prefijo más largo que se pueda formar (búsqueda parcial). */
  function buildDireccion(d) {
    if (!d || !d.via || !d.num) return '';
    const p = [d.via, d.num + (d.letra || '')];
    if (d.bis) p.push('BIS' + (d.letraBis ? ' ' + d.letraBis : ''));
    if (d.cruce) {
      p.push(d.cruce + (d.letraCruce || ''));
      if (d.placa) {
        p.push(d.placa);
        if (d.interior) p.push('IN ' + d.interior);
        if (d.unidadTipo && d.unidadNum) p.push(d.unidadTipo + ' ' + d.unidadNum);
      }
    }
    return p.join(' ');
  }
  const UNIDADES = [['AP', 'Apartamento'], ['GJ', 'Garaje'], ['CS', 'Casa'], ['LC', 'Local'], ['OF', 'Oficina'], ['DP', 'Depósito']];

  function buildWhere(f) {
    const w = [];
    if (f.chip) w.push(`PRECHIP = '${sqlStr(f.chip)}'`);
    // Dirección cerrada: coincide exacta o seguida de la unidad (" GJ 1", " IN 1 AP 101"),
    // así "KR 19 164 5" no trae "KR 19 164 53"
    const dir = f.direccion || buildDireccion(f.dir);
    if (dir) {
      const s = sqlStr(dir);
      const d = f.dir || {};
      // Unidad elegida sin interior: aceptar también "… IN x AP 201"
      const conIn = !f.direccion && d.placa && !d.interior && d.unidadTipo && d.unidadNum
        ? ` OR PREDIRECC LIKE '${sqlStr(buildDireccion(Object.assign({}, d, { unidadTipo: '' })))} IN % ${sqlStr(d.unidadTipo + ' ' + d.unidadNum)}'` : '';
      w.push(`(PREDIRECC = '${s}' OR PREDIRECC LIKE '${s} %'${conIn})`);
      if (d.placa && d.unidadTipo && !d.unidadNum) w.push(`PREDIRECC LIKE '% ${sqlStr(d.unidadTipo)} %'`);
      if (f.dir && f.dir.cuadrante) w.push(`PREDIRECC LIKE '% ${sqlStr(f.dir.cuadrante)}%'`);
    }
    if (f.barrio) w.push(`PRENBARRIO LIKE '%${sqlStr(f.barrio)}%'`);
    // Tipo de unidad: GJ y AP salen de la dirección oficial; casa = predio no PH destinado a vivienda
    if (f.tipo === 'Garaje') w.push("PREDIRECC LIKE '% GJ %'");
    else if (f.tipo === 'Apartamento') w.push("PREDIRECC LIKE '% AP %'");
    else if (f.tipo === 'Casa') w.push("PRECLASE = 'N'", "PREUVIVIEN = 'S'");
    if (f.clase && f.tipo !== 'Casa') w.push(`PRECLASE = '${sqlStr(f.clase)}'`);
    // Búsqueda por conjunto: lotes del censo PH (CODIGO_LOTE = BARMANPRE)
    if (f.lotes && f.lotes.length) w.push(`BARMANPRE IN (${f.lotes.map(l => `'${sqlStr(normLote(l))}'`).join(',')})`);
    if (f.whereExtra) w.push('(' + f.whereExtra + ')');
    if (f.manzana) w.push(`PRECMANZ = '${sqlStr(f.manzana)}'`);
    if (f.predio) w.push(`PRECPREDIO = '${sqlStr(f.predio)}'`);
    return w.length ? w.join('\nAND ') : '1=1';
  }

  function layerUrl(endpoint) { return endpoint.replace(/\/query\/?$/, ''); }

  function buildParams(where, extra) {
    const p = new URLSearchParams({
      where: where,
      outFields: '*', // incluye el nombre del conjunto si la capa lo publica
      returnGeometry: 'false',
      orderByFields: 'PREDIRECC',
      f: 'json'
    });
    Object.keys(extra || {}).forEach(k => p.set(k, extra[k]));
    return p;
  }

  async function getJson(url, params) {
    const full = params ? url + '?' + params.toString() : url;
    const r = await fetch(full);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || 'Error del servicio ArcGIS');
    return j;
  }

  // Verifica capa, campos y límite de registros
  async function verificarServicio(endpoint) {
    const j = await getJson(layerUrl(endpoint), new URLSearchParams({ f: 'json' }));
    const campos = (j.fields || []).map(x => x.name);
    const faltan = OUT_FIELDS.filter(c => !campos.includes(c));
    return {
      nombre: j.name,
      maxRecordCount: j.maxRecordCount,
      soportaPaginacion: !!(j.advancedQueryCapabilities && j.advancedQueryCapabilities.supportsPagination),
      camposFaltantes: faltan,
      campoConjunto: CAMPOS_CONJUNTO.find(c => campos.includes(c)) || ''
    };
  }

  // Descarga todos los registros paginando, hasta `max`
  async function consultar(endpoint, f, max, onProgress) {
    const where = buildWhere(f);
    const total = (await getJson(endpoint, buildParams(where, { returnCountOnly: 'true' }))).count;
    if (typeof total !== 'number') throw new Error('el servicio no devolvió el conteo de registros');
    const feats = [];
    let offset = 0;
    while (offset < Math.min(total, max)) {
      const j = await getJson(endpoint, buildParams(where, {
        resultOffset: offset,
        resultRecordCount: Math.min(PAGE, max - offset)
      }));
      const got = j.features || [];
      if (!got.length) break;
      feats.push(...got);
      offset += got.length;
      if (onProgress) onProgress(feats.length, total);
    }
    return { where, total, features: feats };
  }

  // Clasifica una unidad a partir de la dirección oficial
  function clasificar(direccion) {
    const d = ' ' + String(direccion || '').toUpperCase().replace(/\s+/g, ' ') + ' ';
    const interior = (d.match(/ (?:IN|INT) ([A-Z0-9]+)/) || [])[1] || '';
    let tipo = 'Otro', unidad = '';
    let m;
    if ((m = d.match(/ GJ ([A-Z0-9]+)/))) { tipo = 'Garaje'; unidad = 'GJ ' + m[1]; }
    else if ((m = d.match(/ AP ([A-Z0-9]+)/))) { tipo = 'Apartamento'; unidad = 'AP ' + m[1]; }
    else if ((m = d.match(/ (LC|OF|DP|BG|CS|CA|PA|PQ|ZV|TE|LO) ([A-Z0-9]+)/))) { unidad = m[1] + ' ' + m[2]; }
    return { tipo, interior, unidad };
  }

  // Convierte features en filas planas, deduplicando por CHIP
  function nombreConjunto(a) {
    for (const k of CAMPOS_CONJUNTO) { const v = a[k]; if (v != null && String(v).trim()) return String(v).trim(); }
    return '';
  }
  // Código de lote (12 dígitos: barrio 6 + manzana 3 + predio 3) = BARMANPRE
  function codigoLote(a) {
    if (a.BARMANPRE != null && String(a.BARMANPRE).trim()) return normLote(a.BARMANPRE);
    if (a.PRECBARRIO != null && a.PRECMANZ != null && a.PRECPREDIO != null) {
      const p = (v, n) => String(v).trim().padStart(n, '0');
      return p(a.PRECBARRIO, 6) + p(a.PRECMANZ, 3) + p(a.PRECPREDIO, 3);
    }
    return '';
  }

  // Consulta los nombres de copropiedad para varios lotes (lotes de 50 por petición)
  async function consultarConjuntos(lotes, endpoint) {
    const unicos = Array.from(new Set(lotes.filter(Boolean))), mapa = {};
    for (let i = 0; i < unicos.length; i += 50) {
      const grupo = unicos.slice(i, i + 50);
      const where = 'CODIGO_LOTE IN (' + grupo.map(l => `'${sqlStr(normLote(l))}'`).join(',') + ')';
      const j = await getJson(endpoint || ENDPOINT_PH, new URLSearchParams({ where, outFields: CAMPOS_PH.join(','), returnGeometry: 'false', f: 'json' }));
      (j.features || []).forEach(ft => {
        const a = ft.attributes || {}, k = normLote(a.CODIGO_LOTE);
        if (k && a.NOMBRE_COPROPIEDAD && !mapa[k]) mapa[k] = {
          nombre: String(a.NOMBRE_COPROPIEDAD).trim(),
          cerrado: String(a.CONJUNTO_CERRADO || '').trim(), tipoPH: String(a.TIPO_PH || '').trim()
        };
      });
    }
    return mapa;
  }

  // Lista de nombres de copropiedad (valores distintos), paginando de 2000 en 2000
  async function listarConjuntos(endpoint, onProgress) {
    const nombres = [];
    for (let offset = 0; offset < 50000; offset += 2000) {
      const j = await getJson(endpoint || ENDPOINT_PH, new URLSearchParams({
        where: '1=1', outFields: 'NOMBRE_COPROPIEDAD', returnGeometry: 'false', returnDistinctValues: 'true',
        orderByFields: 'NOMBRE_COPROPIEDAD', resultOffset: offset, resultRecordCount: 2000, f: 'json'
      }));
      const got = (j.features || []).map(ft => String((ft.attributes || {}).NOMBRE_COPROPIEDAD || '').trim()).filter(Boolean);
      nombres.push(...got);
      if (onProgress) onProgress(nombres.length);
      if (!j.exceededTransferLimit || !got.length) break;
    }
    return Array.from(new Set(nombres));
  }

  // Dirección del censo PH llevada al formato de PREDIRECC ("CARRERA 19 # 164-53" → "KR 19 164 53")
  const VIAS_LARGAS = [
    [/\bAV(?:ENIDA)? (?:CALLE|CL)\b/g, 'AC'], [/\bAV(?:ENIDA)? (?:CARRERA|KR|CRA|CR)\b/g, 'AK'],
    [/\b(?:CALLE|CLL)\b/g, 'CL'], [/\b(?:CARRERA|CRA|KRA|CR|CRR)\b/g, 'KR'],
    [/\b(?:DIAGONAL|DIAG)\b/g, 'DG'], [/\b(?:TRANSVERSAL|TRANSV)\b/g, 'TV'], [/\bAVENIDA\b/g, 'AV']
  ];
  function normDireccionPH(d) {
    let t = ' ' + String(d || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + ' ';
    t = t.replace(/\bN[O°º]\.? ?(?=\d)/g, ' ').replace(/[#\-–,.]/g, ' ').replace(/\s+/g, ' ');
    VIAS_LARGAS.forEach(([re, ab]) => { t = t.replace(re, ab); });
    t = t.replace(/(\d) ([A-Z])(?= |$)/g, '$1$2'); // "16 A" → "16A"
    return t.replace(/\s+/g, ' ').trim();
  }

  // Lotes (CODIGO_LOTE) y direcciones de un conjunto por su nombre
  async function lotesDeConjunto(nombre, endpoint) {
    const url = endpoint || ENDPOINT_PH, objetivo = String(nombre).trim().toUpperCase();
    const pedir = where => getJson(url, new URLSearchParams({ where, outFields: CAMPOS_PH.join(','), returnGeometry: 'false', f: 'json' }))
      .then(j => (j.features || []).map(ft => ft.attributes || {}));
    let feats = await pedir(`NOMBRE_COPROPIEDAD = '${String(nombre).replace(/'/g, "''")}'`);
    // El valor guardado puede traer espacios o mayúsculas distintas: reintentar con LIKE y filtrar aquí
    if (!feats.length) feats = (await pedir(`UPPER(NOMBRE_COPROPIEDAD) LIKE '%${sqlStr(nombre)}%'`))
      .filter(a => String(a.NOMBRE_COPROPIEDAD || '').trim().toUpperCase() === objetivo);
    const uniq = a => Array.from(new Set(a.filter(Boolean)));
    return {
      lotes: uniq(feats.map(a => normLote(a.CODIGO_LOTE))),
      direcciones: uniq(feats.map(a => normDireccionPH(a.DIRECCION))),
      registros: feats
    };
  }

  // Barrio, manzana y predio de un código de lote de 12 dígitos
  function partesLote(l) {
    const t = normLote(l);
    return /^\d{12}$/.test(t) ? { barrio: t.slice(0, 6), manzana: t.slice(6, 9), predio: t.slice(9, 12) } : null;
  }

  // Campos y tipos de la capa de predios (se piden una vez por endpoint; null si no responde)
  const cacheCampos = {};
  function camposCapa(endpoint) {
    if (!cacheCampos[endpoint]) {
      cacheCampos[endpoint] = getJson(layerUrl(endpoint), new URLSearchParams({ f: 'json' }))
        .then(j => { const m = {}; (j.fields || []).forEach(x => { m[x.name] = x.type; }); return Object.keys(m).length ? m : null; })
        .catch(() => { delete cacheCampos[endpoint]; return null; });
    }
    return cacheCampos[endpoint];
  }
  const NUMERICO = /Integer|Double|Single|OID/;
  // Valores para comparar un campo: numérico sin comillas; texto con y sin ceros a la izquierda
  function valores(v, tipo) {
    if (NUMERICO.test(tipo || '')) return String(parseInt(v, 10));
    return Array.from(new Set([v, String(parseInt(v, 10))])).map(x => `'${sqlStr(x)}'`).join(',');
  }
  // Cláusula para traer los predios de varios lotes
  function whereLotes(lotes, estrategia, campos) {
    const tipo = c => (campos && campos[c]) || '';
    const ls = lotes.map(normLote).filter(Boolean);
    if (estrategia === 'barmanpre') {
      const num = NUMERICO.test(tipo('BARMANPRE'));
      const v = ls.filter(l => !num || /^\d+$/.test(l)).map(l => (num ? String(parseInt(l, 10)) : `'${sqlStr(l)}'`));
      return v.length ? `BARMANPRE IN (${v.join(',')})` : '';
    }
    return ls.map(partesLote).filter(Boolean).map(p =>
      `(PRECBARRIO IN (${valores(p.barrio, tipo('PRECBARRIO'))}) AND PRECMANZ IN (${valores(p.manzana, tipo('PRECMANZ'))}) AND PRECPREDIO IN (${valores(p.predio, tipo('PRECPREDIO'))}))`
    ).join(' OR ');
  }
  const trozos = (a, n) => { const r = []; for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n)); return r; };

  /* Predios de un conjunto. Prueba en orden, y se queda con la primera que traiga predios:
     1) BARMANPRE IN (lotes)  2) PRECBARRIO + PRECMANZ + PRECPREDIO del lote  3) dirección del censo.
     Los lotes van en grupos de 50 para no exceder el largo de la URL.
     Devuelve también `intentos` (cláusula, total y error de cada estrategia) para explicar un resultado vacío. */
  async function consultarConjunto(endpoint, f, max, onProgress, conj) {
    const campos = await camposCapa(endpoint);
    const tiene = c => !campos || c in campos; // sin metadatos se intenta igual
    const base = Object.assign({}, f, { lotes: null, dir: null, direccion: '' });
    const lotes = ((conj && conj.lotes) || []).map(normLote).filter(Boolean);
    const dirs = ((conj && conj.direcciones) || []).filter(Boolean);
    const estrategias = [];
    if (lotes.length && tiene('BARMANPRE')) {
      estrategias.push({ id: 'barmanpre', desc: 'BARMANPRE = código de lote', grupos: trozos(lotes, 50).map(g => whereLotes(g, 'barmanpre', campos)).filter(Boolean) });
    }
    if (lotes.length && ['PRECBARRIO', 'PRECMANZ', 'PRECPREDIO'].every(tiene)) {
      estrategias.push({ id: 'partes', desc: 'barrio + manzana + predio del lote', grupos: trozos(lotes, 50).map(g => whereLotes(g, 'partes', campos)).filter(Boolean) });
    }
    if (dirs.length && tiene('PREDIRECC')) {
      estrategias.push({ id: 'direccion', desc: 'dirección registrada en el censo PH', grupos: trozos(dirs, 20).map(g => g.map(d => {
        const s = sqlStr(d); return `PREDIRECC = '${s}' OR PREDIRECC LIKE '${s} %'`;
      }).join(' OR ')) });
    }
    const intentos = [];
    for (const e of estrategias) {
      if (!e.grupos.length) continue;
      const it = { id: e.id, desc: e.desc, where: '', total: 0, error: '' };
      intentos.push(it);
      try {
        const feats = [];
        for (const g of e.grupos) {
          if (feats.length >= max) break;
          const antes = feats.length, previo = it.total;
          const r = await consultar(endpoint, Object.assign({}, base, { whereExtra: g }), max - antes,
            (n, t) => onProgress && onProgress(antes + n, previo + t));
          if (!it.where) it.where = r.where;
          it.total += r.total; feats.push(...r.features);
        }
        if (feats.length) return { where: it.where, total: it.total, features: feats, estrategia: it, intentos, campos };
      } catch (err) { it.error = err.message; }
    }
    return { where: intentos.length ? intentos[0].where : '', total: 0, features: [], estrategia: null, intentos, campos };
  }

  /* Respaldo cuando el predio no trae código de lote (la capa no publica BARMANPRE ni PRECBARRIO):
     se piden las copropiedades del barrio en el censo PH y se emparejan por
     (a) manzana + predio = últimos 6 dígitos de CODIGO_LOTE, o (b) dirección base igual. */
  const SUFIJO_UNIDAD = / (?:IN|INT|AP|GJ|LC|OF|DP|BG|CS|CA|PA|PQ|ZV|TE|LO|TO|ET|BL|PI|UN|MZ|SO|PS|CN) .*$/;
  function direccionBase(d) { return String(d || '').toUpperCase().replace(/\s+/g, ' ').trim().replace(SUFIJO_UNIDAD, ''); }
  const pad3 = v => { const t = String(v == null ? '' : v).trim(); return /^\d+$/.test(t) ? t.padStart(3, '0').slice(-3) : ''; };

  async function conjuntosPorBarrio(filas, endpoint) {
    const url = endpoint || ENDPOINT_PH;
    const barrios = Array.from(new Set(filas.map(r => String(r.barrio || '').trim().toUpperCase()).filter(Boolean))).slice(0, 10);
    const regs = [];
    for (const b of barrios) {
      const pedir = where => getJson(url, new URLSearchParams({ where, outFields: CAMPOS_PH.join(','), returnGeometry: 'false', resultRecordCount: 2000, f: 'json' }))
        .then(j => (j.features || []).map(ft => ft.attributes || {}));
      let r = await pedir(`NOMBRE_BARRIO_CATASTRO = '${sqlStr(b)}'`);
      if (!r.length) r = await pedir(`UPPER(NOMBRE_BARRIO_CATASTRO) LIKE '%${sqlStr(b)}%'`);
      regs.push(...r.map(a => Object.assign({ _barrio: b }, a)));
    }
    const porMzPr = {}, porDir = {};
    regs.forEach(a => {
      if (!a.NOMBRE_COPROPIEDAD) return;
      const c = { nombre: String(a.NOMBRE_COPROPIEDAD).trim(), cerrado: String(a.CONJUNTO_CERRADO || '').trim(), tipoPH: String(a.TIPO_PH || '').trim(), lote: normLote(a.CODIGO_LOTE) };
      if (/^\d{12}$/.test(c.lote)) porMzPr[a._barrio + '|' + c.lote.slice(6)] = porMzPr[a._barrio + '|' + c.lote.slice(6)] || c;
      const d = normDireccionPH(a.DIRECCION); if (d) porDir[d] = porDir[d] || c;
    });
    let n = 0;
    filas.forEach(r => {
      if (r.conjunto && r.tipoPH) return;
      const k = String(r.barrio || '').trim().toUpperCase() + '|' + pad3(r.manzana) + pad3(r.predio);
      const c = (pad3(r.manzana) && pad3(r.predio) && porMzPr[k]) || porDir[direccionBase(r.direccion)];
      if (c) { r.conjunto = c.nombre; r.tipoPH = c.tipoPH; r.cerrado = c.cerrado; if (!r.lote) r.lote = c.lote; n++; }
    });
    return n;
  }

  // Asigna el nombre del conjunto a cada fila según su lote
  function aplicarConjuntos(filas, mapa) {
    let n = 0;
    filas.forEach(r => { const c = mapa[normLote(r.lote)]; if (c) { r.conjunto = c.nombre; r.tipoPH = c.tipoPH; r.cerrado = c.cerrado; n++; } });
    return n;
  }

  // nombreDefault: nombre escrito por el usuario; se aplica solo a unidades de propiedad horizontal
  function normalizar(features, nombreDefault) {
    const vistos = new Map();
    let duplicados = 0, sinChip = 0;
    (features || []).forEach(ft => {
      const a = ft.attributes || ft;
      const chip = (a.PRECHIP || '').trim();
      if (!chip) { sinChip++; }
      const key = chip || 'SIN-CHIP-' + (a.PREDIRECC || '') + '-' + vistos.size;
      if (vistos.has(key)) { duplicados++; return; }
      const c = clasificar(a.PREDIRECC);
      // Predio no PH (clase N) sin sufijo de unidad: casa, salvo que se sepa que no es de vivienda
      if (c.tipo === 'Otro' && !c.unidad && String(a.PRECLASE || '').trim() === 'N' && String(a.PREUVIVIEN || '').trim() !== 'N') c.tipo = 'Casa';
      const ph = String(a.PRECLASE || '').trim() === 'P' || !!c.unidad;
      vistos.set(key, {
        conjunto: nombreConjunto(a) || (ph && nombreDefault ? String(nombreDefault).trim() : ''),
        lote: codigoLote(a), tipoPH: '', cerrado: '',
        chip, direccion: (a.PREDIRECC || '').trim(), tipo: c.tipo, interior: c.interior,
        unidad: c.unidad, barrio: (a.PRENBARRIO || '').trim(), manzana: a.PRECMANZ == null ? '' : String(a.PRECMANZ).trim(),
        predio: a.PRECPREDIO == null ? '' : String(a.PRECPREDIO).trim(), clase: (a.PRECLASE || '').trim()
      });
    });
    return { filas: Array.from(vistos.values()), duplicados, sinChip };
  }

  const api = { conjuntosPorBarrio, direccionBase, listarConjuntos, lotesDeConjunto, normLote, partesLote, normDireccionPH, whereLotes, camposCapa, consultarConjunto, ENDPOINT_PH, CAMPOS_PH, codigoLote, consultarConjuntos, aplicarConjuntos, OUT_FIELDS, CAMPOS_CONJUNTO, nombreConjunto, TIPOS_VIA, CUADRANTES, UNIDADES, buildDireccion, buildWhere, buildParams, verificarServicio, consultar, clasificar, normalizar, layerUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CatastroAPI = api;
})(typeof window !== 'undefined' ? window : globalThis);

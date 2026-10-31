/* catastro-api.js — consulta ArcGIS REST y clasificación de unidades */
(function (root) {
  'use strict';

  const OUT_FIELDS = ['PRECHIP', 'PREDIRECC', 'PRECLASE', 'PRENBARRIO', 'PRECMANZ', 'PRECPREDIO', 'PREUVIVIEN'];
  const PAGE = 1000; // tamaño de página solicitado (el servidor puede limitarlo)

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
      if (d.placa) p.push(d.placa);
    }
    return p.join(' ');
  }

  function buildWhere(f) {
    const w = [];
    if (f.chip) w.push(`PRECHIP = '${sqlStr(f.chip)}'`);
    // Dirección cerrada: coincide exacta o seguida de la unidad (" GJ 1", " IN 1 AP 101"),
    // así "KR 19 164 5" no trae "KR 19 164 53"
    const dir = f.direccion || buildDireccion(f.dir);
    if (dir) {
      const s = sqlStr(dir);
      w.push(`(PREDIRECC = '${s}' OR PREDIRECC LIKE '${s} %')`);
      if (f.dir && f.dir.cuadrante) w.push(`PREDIRECC LIKE '% ${sqlStr(f.dir.cuadrante)}%'`);
    }
    if (f.barrio) w.push(`PRENBARRIO LIKE '%${sqlStr(f.barrio)}%'`);
    // Tipo de unidad: GJ y AP salen de la dirección oficial; casa = predio no PH destinado a vivienda
    if (f.tipo === 'Garaje') w.push("PREDIRECC LIKE '% GJ %'");
    else if (f.tipo === 'Apartamento') w.push("PREDIRECC LIKE '% AP %'");
    else if (f.tipo === 'Casa') w.push("PRECLASE = 'N'", "PREUVIVIEN = 'S'");
    if (f.clase && f.tipo !== 'Casa') w.push(`PRECLASE = '${sqlStr(f.clase)}'`);
    if (f.manzana) w.push(`PRECMANZ = '${sqlStr(f.manzana)}'`);
    if (f.predio) w.push(`PRECPREDIO = '${sqlStr(f.predio)}'`);
    return w.length ? w.join('\nAND ') : '1=1';
  }

  function layerUrl(endpoint) { return endpoint.replace(/\/query\/?$/, ''); }

  function buildParams(where, extra) {
    const p = new URLSearchParams({
      where: where,
      outFields: OUT_FIELDS.join(','),
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
      camposFaltantes: faltan
    };
  }

  // Descarga todos los registros paginando, hasta `max`
  async function consultar(endpoint, f, max, onProgress) {
    const where = buildWhere(f);
    const total = (await getJson(endpoint, buildParams(where, { returnCountOnly: 'true' }))).count;
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
  function normalizar(features) {
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
      vistos.set(key, {
        chip, direccion: (a.PREDIRECC || '').trim(), tipo: c.tipo, interior: c.interior,
        unidad: c.unidad, barrio: (a.PRENBARRIO || '').trim(), manzana: a.PRECMANZ == null ? '' : String(a.PRECMANZ).trim(),
        predio: a.PRECPREDIO == null ? '' : String(a.PRECPREDIO).trim(), clase: (a.PRECLASE || '').trim()
      });
    });
    return { filas: Array.from(vistos.values()), duplicados, sinChip };
  }

  const api = { OUT_FIELDS, TIPOS_VIA, CUADRANTES, buildDireccion, buildWhere, buildParams, verificarServicio, consultar, clasificar, normalizar, layerUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CatastroAPI = api;
})(typeof window !== 'undefined' ? window : globalThis);

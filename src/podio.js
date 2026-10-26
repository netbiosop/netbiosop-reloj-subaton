// Podio mensual de aportes (Top donadores, Top bits, Top subs regaladas).
// Toma cada aporte REAL que registra el reloj (no las pruebas) y lo guarda en data/podio.json.
// El podio va del día 1 al último día de cada mes (hora de esta PC): al empezar un mes nuevo
// queda vacío solo, y el mes que terminó pasa a ser "los reyes del mes pasado".
// Donaciones: PayPal + Mercado Pago se suman en un solo ranking en USD (MP se convierte con la
// tasa del momento del aporte, automática o la que fijes tú).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'podio.json');
const RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const RATES_EVERY = 6 * 3600 * 1000; // actualizar la cotización cada 6 horas
const KEEP_MONTHS = 24;               // cuántos meses de historial se guardan

const CATS = ['dinero', 'subs', 'bits'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const DEFAULTS = {
  config: {
    manualRates: {},          // { ARS: 1450 } → 1 USD = 1450 ARS (si está vacío se usa la cotización automática)
    modo: 'rotar',            // podio: 'rotar' | 'dinero' | 'subs' | 'bits'
    segundos: 10,             // segundos entre categorías al rotar
    mostrar: { dinero: true, subs: true, bits: true },
    titulos: {
      dinero: 'Top Donadores',
      subs: 'Top Subs Regaladas',
      bits: 'Top Bits',
      general: 'Top General',
      reyes: 'Reyes de {mes}',
    },
    // Metas del mes (overlay /metas): se llenan solas con los aportes del mes
    metas: {
      titulo: 'Metas del mes',
      barras: true,
      subs:   { on: true, meta: 350,   label: 'Subs' },
      bits:   { on: true, meta: 30000, label: 'Bits' },
      dinero: { on: true, meta: 500,   label: 'Donado' },
    },
    // Lo que ya tenías antes de usar el reloj, por mes: { '2026-10': { subs: 47, bits: 0, dinero: 25 } }
    ajustes: {},
    // Reyes puestos a mano, por mes: { '2026-09': { dinero: { name: 'Juan', total: 60 } } } (si no hay, se calculan solos)
    reyesManual: {},
    // Lluvia de patitos: "por cada X USD caen Y patitos" (proporcional), cuánto duran en pantalla y topes
    patitos: { usd: 1, patos: 1, duracionMin: 0, maxPorAporte: 60, maxPantalla: 130, porStream: true, margenMin: 30 },
  },
  rates: { rates: {}, fetchedAt: 0 },
  events: [],     // { id, at, cat, user, amount, currency, usd, count, source, manual, ref }
  backfilled: false,
  // patitos acumulados (amarillos = Mercado Pago, verdes = PayPal) + cuándo empezó/terminó el stream
  patitos: { y: 0, g: 0, ultimo: 0, inicioStream: 0, finStream: 0 },
};

const pad = (n) => String(n).padStart(2, '0');
const monthKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return `${MESES[m - 1]} ${y}`; };
const monthName = (key) => MESES[Number(key.split('-')[1]) - 1];
const prevKey = (key) => { const [y, m] = key.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`; };
const round2 = (n) => Math.round(n * 100) / 100;
const cleanName = (s) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 40);

function merge(def, val) {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return val === undefined ? def : val;
  const out = {};
  const src = val && typeof val === 'object' && !Array.isArray(val) ? val : {};
  for (const k of new Set([...Object.keys(def), ...Object.keys(src)])) out[k] = k in def ? merge(def[k], src[k]) : src[k];
  return out;
}

function createPodio({ store }) {
  let data;
  try { data = merge(DEFAULTS, JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
  catch (err) {
    if (err.code !== 'ENOENT') console.error('[Podio] No se pudo leer', FILE, '-', err.message);
    data = merge(DEFAULTS, {});
  }
  let version = Date.now();
  let saveTimer = null;

  function save() {
    version++;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(data, null, 2));
      fs.renameSync(FILE + '.tmp', FILE);
    } catch (err) { console.error('[Podio] No se pudo guardar:', err.message); }
  }

  // ---------- Conversión a USD ----------
  function rateFor(currency) {
    const c = String(currency || '').toUpperCase();
    if (!c || c === 'USD') return 1;
    const manual = Number(data.config.manualRates[c]);
    if (manual > 0) return manual;
    const auto = Number(data.rates.rates[c]);
    return auto > 0 ? auto : null;
  }
  function toUsd(amount, currency) {
    const r = rateFor(currency);
    return r ? round2(Number(amount) / r) : null;
  }
  async function refreshRates(force = false) {
    if (!force && Date.now() - data.rates.fetchedAt < RATES_EVERY) return { ok: true, cached: true };
    try {
      const res = await fetch(RATES_URL, { signal: AbortSignal.timeout(10000) });
      const j = await res.json();
      if (!j || !j.rates) throw new Error('respuesta sin cotizaciones');
      data.rates = { rates: j.rates, fetchedAt: Date.now() };
      // Aportes que llegaron sin cotización disponible: se convierten ahora
      let fixed = 0;
      for (const e of data.events) if (e.cat === 'dinero' && e.usd == null) { e.usd = toUsd(e.amount, e.currency); if (e.usd != null) fixed++; }
      if (fixed) console.log(`[Podio] ${fixed} donación(es) convertida(s) a USD al obtener la cotización`);
      save();
      return { ok: true };
    } catch (err) {
      console.warn('[Podio] No se pudo actualizar la cotización del dólar:', err.message);
      return { ok: false, error: err.message };
    }
  }

  // ---------- Registrar aportes ----------
  // entry: lo que devuelve engine.contribute()
  function fromEntry(entry) {
    if (!entry || entry.duplicate || entry.test) return null;
    const base = { id: crypto.randomUUID(), at: entry.at || Date.now(), user: cleanName(entry.user) || 'Anónimo', source: entry.source, ref: entry.id || null };
    if (entry.source === 'paypal' || entry.source === 'mercadopago') {
      const amount = Number(entry.amount) || 0;
      if (amount <= 0) return null;
      const currency = String(entry.currency || (entry.source === 'paypal' ? 'USD' : store.data.rates.mercadopago.currency) || 'USD').toUpperCase();
      return { ...base, cat: 'dinero', amount, currency, usd: toUsd(amount, currency), ...(entry.payer ? { pk: entry.payer } : {}) };
    }
    if (entry.source === 'bits') {
      const amount = Number(entry.amount) || 0;
      return amount > 0 ? { ...base, cat: 'bits', amount } : null;
    }
    if (entry.source === 'subs') {
      // Todas las subs cuentan para la meta; para el podio solo las regaladas
      const count = Number(entry.count) || 1;
      return { ...base, cat: 'subs', kind: entry.kind === 'gift' ? 'gift' : entry.kind === 'resub' ? 'resub' : 'new', count };
    }
    return null; // ajustes manuales del reloj no cuentan
  }

  function record(entry) {
    const ev = fromEntry(entry);
    if (!ev) return null;
    if (ev.ref && data.events.some((e) => e.ref === ev.ref)) return null;
    data.events.push(ev);
    prune();
    save();
    return ev;
  }

  // Al instalarlo por primera vez: recupera del historial del reloj los aportes de este mes y del anterior
  function backfill() {
    if (data.backfilled) return;
    data.backfilled = true;
    const keep = new Set([monthKey(Date.now()), prevKey(monthKey(Date.now()))]);
    let n = 0;
    for (const entry of [...(store.data.log || [])].reverse()) {
      if (!keep.has(monthKey(entry.at))) continue;
      if (record(entry)) n++;
    }
    if (n) console.log(`[Podio] Se recuperaron ${n} aporte(s) del historial del reloj`);
    save();
  }

  function prune() {
    const limit = Date.now() - KEEP_MONTHS * 31 * 86400 * 1000;
    if (data.events.length && data.events[0].at < limit) data.events = data.events.filter((e) => e.at >= limit);
  }

  // Agregar a mano (transferencias que no detectó el reloj, correcciones…)
  function addManual({ cat, user, amount, currency, count, at }) {
    if (!CATS.includes(cat)) throw new Error('Categoría inválida');
    const name = cleanName(user);
    if (!name) throw new Error('Falta el nombre');
    const when = Number(at) || Date.now();
    const ev = { id: crypto.randomUUID(), at: when, user: name, cat, manual: true, source: 'manual', ref: null };
    if (cat === 'dinero') {
      const a = Number(amount);
      if (!(a > 0)) throw new Error('Monto inválido');
      ev.amount = a;
      ev.currency = String(currency || 'USD').toUpperCase();
      ev.usd = toUsd(a, ev.currency);
      if (ev.usd == null) throw new Error(`No hay cotización para ${ev.currency}: pon tu tasa en el panel`);
    } else if (cat === 'bits') {
      const a = Math.round(Number(amount));
      if (!(a > 0)) throw new Error('Cantidad inválida');
      ev.amount = a;
    } else {
      const c = Math.round(Number(count ?? amount));
      if (!(c > 0)) throw new Error('Cantidad inválida');
      ev.count = c;
      ev.kind = 'gift';
    }
    data.events.push(ev);
    data.events.sort((a, b) => a.at - b.at);
    save();
    console.log(`[Podio] Agregado a mano: ${describe(ev)}`);
    return ev;
  }
  function removeEvent(id) {
    const i = data.events.findIndex((e) => e.id === id);
    if (i < 0) throw new Error('No existe');
    const [ev] = data.events.splice(i, 1);
    save();
    console.log(`[Podio] Quitado del podio: ${describe(ev)}`);
    return ev;
  }
  // Cambiar el nombre (ej. el pago de Mercado Pago llegó como "Juan" y en Twitch es "juancho99")
  // Si le pones nombre a una donación de Mercado Pago, la próxima de esa misma persona ya llega con ese nombre
  function recordarNombre(pk, name) {
    if (!pk || !name) return;
    (store.data.mpNombres ||= {})[pk] = name;
    store.save();
  }

  // Vincula una donación de Mercado Pago con el usuario de Twitch (comando !mp.add @usuario o el panel).
  // Busca la última de Mercado Pago (las que todavía dicen "Donación Mercado Pago" primero); con monto, la de ese monto.
  function vincularMP(nombre, monto) {
    const name = cleanName(String(nombre || '').replace(/^@/, ''));
    if (!name) throw new Error('Falta el nombre');
    const ahora = Date.now(), m = Number(String(monto || '').replace(/[.$\s]/g, '').replace(',', '.'));
    const mp = data.events.filter((e) => e.source === 'mercadopago' && ahora - e.at < 6 * 3600000).sort((a, b) => b.at - a.at);
    const conMonto = m > 0 ? mp.filter((e) => Math.abs(e.amount - m) < 0.01) : mp;
    const ev = conMonto.find((e) => /^donaci[oó]n mercado pago$/i.test(e.user)) || conMonto[0];
    if (!ev) throw new Error(m > 0 ? `No encuentro una donación de Mercado Pago de ${m} en las últimas 6 horas` : 'No hay donaciones de Mercado Pago en las últimas 6 horas');
    const antes = ev.user;
    ev.user = name;
    recordarNombre(ev.pk, name);
    save();
    console.log(`[Podio] Mercado Pago: "${antes}" (${ev.amount} ${ev.currency}) ahora es de ${name}${ev.pk ? ' (y las próximas de esa persona también)' : ''}`);
    return { ...ev, antes, recordado: !!ev.pk };
  }

  function renameEvent(id, user) {
    const ev = data.events.find((e) => e.id === id);
    if (!ev) throw new Error('No existe');
    const name = cleanName(user);
    if (!name) throw new Error('Falta el nombre');
    console.log(`[Podio] Nombre cambiado: "${ev.user}" → "${name}"`);
    ev.user = name;
    recordarNombre(ev.pk, name);
    save();
    return ev;
  }

  function describe(e) {
    if (e.cat === 'dinero') return `${e.user} · ${e.amount} ${e.currency}${e.currency !== 'USD' ? ` (≈ ${e.usd ?? '?'} USD)` : ''}`;
    if (e.cat === 'bits') return `${e.user} · ${e.amount} bits`;
    return `${e.user} · ${e.count} sub(s)${e.kind && e.kind !== 'gift' ? '' : ' regalada(s)'}`;
  }

  // ---------- Rankings ----------
  function ranking(key, cat, limit = 3) {
    const m = new Map();
    for (const e of data.events) {
      if (e.cat !== cat || monthKey(e.at) !== key) continue;
      if (cat === 'subs' && e.kind && e.kind !== 'gift') continue; // el podio de subs es solo de regaladas
      const v = cat === 'dinero' ? Number(e.usd) || 0 : cat === 'bits' ? Number(e.amount) || 0 : Number(e.count) || 0;
      if (v <= 0) continue;
      const k = e.user.toLowerCase();
      const r = m.get(k) || { name: e.user, total: 0, last: 0, auto: false };
      r.total += v;
      r.last = Math.max(r.last, e.at);
      // Se muestra el nombre tal como vino de Twitch / PayPal / Mercado Pago (el escrito a mano solo si no hay otro)
      if (!e.manual || !r.auto) { r.name = e.user; r.auto = r.auto || !e.manual; }
      m.set(k, r);
    }
    // Empate: gana quien llegó primero a ese total
    return [...m.values()]
      .sort((a, b) => b.total - a.total || a.last - b.last)
      .slice(0, limit)
      .map((r) => ({ name: r.name, total: cat === 'dinero' ? round2(r.total) : Math.round(r.total) }));
  }
  const board = (key, limit) => Object.fromEntries(CATS.map((c) => [c, ranking(key, c, limit)]));

  // Totales del mes para las metas (subs de todo tipo, bits, donado en USD) + lo cargado a mano en "ajustes"
  function totals(key) {
    const t = { subs: 0, bits: 0, dinero: 0 };
    for (const e of data.events) {
      if (monthKey(e.at) !== key) continue;
      if (e.cat === 'subs') t.subs += Number(e.count) || 0;
      else if (e.cat === 'bits') t.bits += Number(e.amount) || 0;
      else if (e.cat === 'dinero') t.dinero += Number(e.usd) || 0;
    }
    const a = data.config.ajustes[key] || {};
    for (const k of Object.keys(t)) t[k] += Number(a[k]) || 0;
    t.dinero = round2(t.dinero);
    return t;
  }
  function metasData(key) {
    const m = data.config.metas, t = totals(key);
    return {
      titulo: m.titulo,
      barras: m.barras,
      items: ['subs', 'bits', 'dinero'].filter((k) => m[k].on).map((k) => ({ cat: k, label: m[k].label, actual: t[k], meta: Number(m[k].meta) || 0 })),
    };
  }

  // Lluvia de patitos: cuántos caen por esta donación y cuántos hay acumulados (las pruebas no se acumulan)
  function patitosAporte(source, usd, test) {
    const c = source === 'paypal' ? 'g' : 'y', p = data.config.patitos;
    const n = Math.max(1, Math.min(p.maxPorAporte, Math.round((Number(usd) || 0) / (p.usd || 1) * (p.patos || 1))));
    if (!test) { data.patitos[c] += n; data.patitos.ultimo = Date.now(); save(); }
    return { source, color: c, nuevos: n, total: { y: data.patitos.y, g: data.patitos.g }, test: !!test, config: p };
  }
  // El stream empezó o terminó. Devuelve true si se vaciaron los patitos por ser un stream NUEVO.
  // Si el stream se cortó y volvió antes del margen (o el programa se cayó en medio del stream), sigue el mismo.
  function patitosStream(enVivo) {
    const p = data.patitos, cfg = data.config.patitos, ahora = Date.now();
    if (!enVivo) { p.finStream = ahora; save(); return false; }
    const mismo = (!p.finStream && p.inicioStream) || (p.finStream && ahora - p.finStream <= (Number(cfg.margenMin) || 0) * 60000);
    if (mismo) {
      if (p.finStream) console.log('[Patitos] El stream volvió: siguen los mismos patitos acumulados');
      p.finStream = 0; save(); return false;
    }
    const habia = p.y + p.g;
    if (cfg.porStream !== false) { p.y = 0; p.g = 0; p.ultimo = 0; }
    p.inicioStream = ahora; p.finStream = 0; save();
    if (cfg.porStream !== false && habia) { console.log(`[Patitos] Stream nuevo: los patitos acumulados (${habia}) empiezan de cero`); return true; }
    return false;
  }
  function vaciarPatitos() {
    data.patitos = { ...data.patitos, y: 0, g: 0, ultimo: 0 };
    save();
    console.log('[Patitos] Montón vaciado');
  }

  // Reyes de un mes: automáticos, salvo los que se pusieron a mano
  function reyesDe(key) {
    const auto = board(key, 1), man = data.config.reyesManual[key] || {};
    const out = {};
    for (const c of CATS) out[c] = man[c] && man[c].name ? [{ name: man[c].name, total: Number(man[c].total) || 0, manual: true }] : auto[c];
    return out;
  }
  function setRey({ mes, cat, name, total }) {
    if (!CATS.includes(cat)) throw new Error('Categoría inválida');
    const key = /^\d{4}-\d{2}$/.test(mes || '') ? mes : prevKey(monthKey(Date.now()));
    const m = (data.config.reyesManual[key] ||= {});
    const nombre = cleanName(name);
    if (!nombre) { delete m[cat]; console.log(`[Podio] Rey de ${cat} de ${monthLabel(key)}: vuelve a ser automático`); }
    else {
      const t = cat === 'dinero' ? round2(Number(total) || 0) : Math.round(Number(total) || 0);
      if (t < 0) throw new Error('Monto inválido');
      m[cat] = { name: nombre, total: t };
      console.log(`[Podio] Rey de ${cat} de ${monthLabel(key)} puesto a mano: ${nombre} (${t})`);
    }
    save();
    return reyesDe(key);
  }
  // Cambiar el nombre de una persona en todos sus aportes del mes (ej. "Donación Mercado Pago" → "Juancho")
  function renamePerson({ mes, de, a }) {
    const key = /^\d{4}-\d{2}$/.test(mes || '') ? mes : monthKey(Date.now());
    const viejo = cleanName(de).toLowerCase();
    let nuevo = cleanName(a);
    if (!viejo || !nuevo) throw new Error('Falta el nombre');
    // Si ese nombre ya existe en el mes, se respeta cómo estaba escrito (y sus aportes se suman juntos)
    const existente = data.events.find((e) => monthKey(e.at) === key && e.user.toLowerCase() === nuevo.toLowerCase() && e.user.toLowerCase() !== viejo);
    if (existente) nuevo = existente.user;
    let n = 0;
    for (const e of data.events) if (monthKey(e.at) === key && e.user.toLowerCase() === viejo) { e.user = nuevo; n++; recordarNombre(e.pk, nuevo); }
    if (!n) throw new Error('No hay aportes con ese nombre en ' + monthLabel(key));
    console.log(`[Podio] "${cleanName(de)}" → "${nuevo}" en ${n} aporte(s) de ${monthLabel(key)}`);
    save();
    return n;
  }

  // Lo que leen los overlays (público: nombres y totales)
  function publicData() {
    const cur = monthKey(Date.now());
    const prev = prevKey(cur);
    const t = data.config.titulos;
    return {
      version,
      mes: { key: cur, label: monthLabel(cur), nombre: monthName(cur) },
      mesAnterior: { key: prev, label: monthLabel(prev), nombre: monthName(prev) },
      actual: board(cur, 3),
      anterior: reyesDe(prev),
      metas: metasData(cur),
      patitos: { config: data.config.patitos, y: data.patitos.y, g: data.patitos.g, ultimo: data.patitos.ultimo },
      config: {
        modo: data.config.modo,
        segundos: data.config.segundos,
        mostrar: data.config.mostrar,
        titulos: { ...t, reyes: String(t.reyes || '').replace('{mes}', monthName(prev)) },
      },
    };
  }

  // Lo que ve el panel del dueño
  function adminData(month) {
    const cur = monthKey(Date.now());
    const key = /^\d{4}-\d{2}$/.test(month || '') ? month : cur;
    const months = [...new Set([cur, prevKey(cur), ...data.events.map((e) => monthKey(e.at))])].sort().reverse();
    const mpCur = String(store.data.rates.mercadopago.currency || 'ARS').toUpperCase();
    const ppCur = String(store.data.rates.paypal.currency || 'USD').toUpperCase();
    const currencies = [...new Set([mpCur, ppCur, ...data.events.filter((e) => e.cat === 'dinero').map((e) => e.currency)])].filter((c) => c && c !== 'USD');
    return {
      ...publicData(),
      month: { key, label: monthLabel(key), current: key === cur },
      months: months.map((k) => ({ key: k, label: monthLabel(k) })),
      top: board(key, 10),
      events: data.events.filter((e) => monthKey(e.at) === key).slice().reverse(),
      currencies: currencies.map((c) => ({ code: c, auto: Number(data.rates.rates[c]) || null, manual: Number(data.config.manualRates[c]) || null })),
      mpCurrency: mpCur,
      ratesAt: data.rates.fetchedAt,
      fullConfig: data.config,
      ajusteMes: data.config.ajustes[key] || { subs: 0, bits: 0, dinero: 0 },
      reyesAuto: board(prevKey(monthKey(Date.now())), 1),
      totales: totals(key),
    };
  }

  function setConfig(b = {}) {
    const c = data.config;
    if (['rotar', 'dinero', 'subs', 'bits'].includes(b.modo)) c.modo = b.modo;
    if (b.segundos != null) c.segundos = Math.min(300, Math.max(3, Math.round(Number(b.segundos)) || 10));
    if (b.mostrar && typeof b.mostrar === 'object') for (const k of CATS) if (k in b.mostrar) c.mostrar[k] = !!b.mostrar[k];
    if (b.titulos && typeof b.titulos === 'object') {
      for (const k of Object.keys(DEFAULTS.config.titulos)) {
        if (k in b.titulos) c.titulos[k] = String(b.titulos[k] || '').trim().slice(0, 50) || DEFAULTS.config.titulos[k];
      }
    }
    if (b.metas && typeof b.metas === 'object') {
      const m = c.metas;
      if ('titulo' in b.metas) m.titulo = String(b.metas.titulo || '').trim().slice(0, 40) || DEFAULTS.config.metas.titulo;
      if ('barras' in b.metas) m.barras = !!b.metas.barras;
      for (const k of ['subs', 'bits', 'dinero']) {
        const v = b.metas[k];
        if (!v || typeof v !== 'object') continue;
        if ('on' in v) m[k].on = !!v.on;
        if ('meta' in v) m[k].meta = Math.max(0, Number(v.meta) || 0);
        if ('label' in v) m[k].label = String(v.label || '').trim().slice(0, 20) || DEFAULTS.config.metas[k].label;
      }
    }
    // Ajuste de un mes: lo que ya llevabas antes de usar el reloj (ej. 47 subs) — se suma a las metas de ese mes
    if (b.ajuste && typeof b.ajuste === 'object') {
      const key = /^\d{4}-\d{2}$/.test(b.ajuste.mes || '') ? b.ajuste.mes : monthKey(Date.now());
      const a = (c.ajustes[key] ||= { subs: 0, bits: 0, dinero: 0 });
      for (const k of ['subs', 'bits', 'dinero']) if (k in b.ajuste) a[k] = Number(b.ajuste[k]) || 0;
    }
    if (b.patitos && typeof b.patitos === 'object') {
      const p = c.patitos, n = b.patitos, pos = (v, d) => (Number(v) > 0 ? Number(v) : d);
      if ('usd' in n) p.usd = pos(n.usd, p.usd);
      if ('patos' in n) p.patos = Math.max(1, Math.round(pos(n.patos, p.patos)));
      if ('duracionMin' in n) p.duracionMin = Math.max(0, Number(n.duracionMin) || 0);
      if ('maxPorAporte' in n) p.maxPorAporte = Math.max(1, Math.round(pos(n.maxPorAporte, p.maxPorAporte)));
      if ('maxPantalla' in n) p.maxPantalla = Math.min(400, Math.max(10, Math.round(pos(n.maxPantalla, p.maxPantalla))));
      if ('porStream' in n) p.porStream = !!n.porStream;
      if ('margenMin' in n) p.margenMin = Math.max(0, Number(n.margenMin) || 0);
    }
    if (b.manualRates && typeof b.manualRates === 'object') {
      for (const [code, val] of Object.entries(b.manualRates)) {
        const k = String(code).toUpperCase().slice(0, 5);
        const n = Number(val);
        if (n > 0) c.manualRates[k] = n; else delete c.manualRates[k];
      }
      // Donaciones que quedaron sin convertir (no había cotización): se convierten con la tasa nueva
      for (const e of data.events) if (e.cat === 'dinero' && e.usd == null) e.usd = toUsd(e.amount, e.currency);
    }
    save();
  }

  // Aviso en el log cuando cambia el mes (los reyes quedan registrados)
  let lastMonth = monthKey(Date.now());
  setInterval(() => {
    const now = monthKey(Date.now());
    if (now === lastMonth) return;
    const b = board(lastMonth, 1);
    const fmt = { dinero: (v) => `$${v.toFixed(2)} USD`, subs: (v) => `${v} subs`, bits: (v) => `${v} bits` };
    const txt = CATS.map((c) => `${c}: ${b[c][0] ? `${b[c][0].name} (${fmt[c](b[c][0].total)})` : '—'}`).join(' · ');
    console.log(`👑 Terminó ${monthLabel(lastMonth)}. Reyes del mes → ${txt}. Empieza el podio de ${monthLabel(now)}.`);
    lastMonth = now;
    version++;
  }, 30000);

  backfill();
  refreshRates();
  setInterval(() => refreshRates(), 30 * 60 * 1000);

  return {
    record, addManual, removeEvent, renameEvent, renamePerson, vincularMP, setRey, setConfig, refreshRates, toUsd, patitosAporte, vaciarPatitos, patitosStream,
    publicData, adminData, saveNow, version: () => version,
  };
}

module.exports = { createPodio };

// Código de creador: tarjeta animada ("Apoya a un creador") y cinta de noticias abajo.
// Todo se configura desde /codigo-panel y se guarda en data/codigo.json.
// El servidor decide cuándo sale cada cosa (cada X minutos) y avisa a los overlays por /events.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'codigo.json');
const AVISO_EPIC = 'Código de creador de Epic · recibo una comisión por tus compras';

const DEFAULTS = {
  plataformas: [
    { id: 'p1', juego: 'Fortnite', tienda: 'Epic Games', codigo: 'BYTEDEMOND', aviso: AVISO_EPIC, on: true },
  ],
  tarjeta: { on: true, cadaMin: 15, duracionSeg: 14, titulo: 'Apoya a un creador', gracias: '¡Gracias por apoyarme!' },
  cinta: {
    on: true, cadaMin: 10, duracionSeg: 60, velocidad: 55, conPlataformas: true, ocultarReyes: true,
    etiqueta: 'Urgente',
    mensajes: ['¡Gracias por apoyarme!', 'Seguime para no perderte los streams'],
  },
  soloEnVivo: true,
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const txt = (v, max = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

let config = clone(DEFAULTS);
try {
  const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  config = { ...clone(DEFAULTS), ...j, tarjeta: { ...DEFAULTS.tarjeta, ...j.tarjeta }, cinta: { ...DEFAULTS.cinta, ...j.cinta } };
  if (!Array.isArray(config.plataformas)) config.plataformas = clone(DEFAULTS.plataformas);
  if (!Array.isArray(config.cinta.mensajes)) config.cinta.mensajes = [];
  // valores viejos de fábrica → estilo noticiero y más lento
  if (config.cinta.etiqueta === 'Código') config.cinta.etiqueta = 'Urgente';
  if (config.cinta.velocidad === 90) config.cinta.velocidad = 55;
} catch (err) {
  if (err.code !== 'ENOENT') console.error('[Código] No se pudo leer', FILE, '-', err.message);
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(config, null, 2));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (err) { console.error('[Código] No se pudo guardar:', err.message); }
}

function setConfig(b = {}) {
  if (Array.isArray(b.plataformas)) {
    config.plataformas = b.plataformas.slice(0, 12).map((p, i) => ({
      id: txt(p.id, 20) || 'p' + Date.now().toString(36) + i,
      juego: txt(p.juego, 30),
      tienda: txt(p.tienda, 30),
      codigo: txt(p.codigo, 30),
      aviso: txt(p.aviso, 110),
      on: p.on !== false,
    })).filter((p) => p.juego || p.codigo);
  }
  if (b.tarjeta) {
    const t = b.tarjeta, c = config.tarjeta;
    if ('on' in t) c.on = !!t.on;
    if ('cadaMin' in t) c.cadaMin = num(t.cadaMin, 0, 240, c.cadaMin);
    if ('duracionSeg' in t) c.duracionSeg = num(t.duracionSeg, 8, 120, c.duracionSeg);
    if ('titulo' in t) c.titulo = txt(t.titulo, 40) || DEFAULTS.tarjeta.titulo;
    if ('gracias' in t) c.gracias = txt(t.gracias, 40) || DEFAULTS.tarjeta.gracias;
  }
  if (b.cinta) {
    const t = b.cinta, c = config.cinta;
    if ('on' in t) c.on = !!t.on;
    if ('cadaMin' in t) c.cadaMin = num(t.cadaMin, 0, 240, c.cadaMin);
    if ('duracionSeg' in t) c.duracionSeg = num(t.duracionSeg, 10, 600, c.duracionSeg);
    if ('velocidad' in t) c.velocidad = num(t.velocidad, 30, 300, c.velocidad);
    if ('conPlataformas' in t) c.conPlataformas = !!t.conPlataformas;
    if ('ocultarReyes' in t) c.ocultarReyes = !!t.ocultarReyes;
    if ('etiqueta' in t) c.etiqueta = txt(t.etiqueta, 16) || DEFAULTS.cinta.etiqueta;
    if (Array.isArray(t.mensajes)) c.mensajes = t.mensajes.map((m) => txt(m, 140)).filter(Boolean).slice(0, 20);
  }
  if ('soloEnVivo' in b) config.soloEnVivo = !!b.soloEnVivo;
  save();
  return publicData();
}

// ---------- Programación: cada cuánto sale cada cosa ----------
const ultimo = { tarjeta: Date.now(), cinta: Date.now() };
let ocupadoHasta = 0; // no se pisan la tarjeta y la cinta

function mostrar(que, broadcast, manual = false) {
  if (!['tarjeta', 'cinta'].includes(que)) throw new Error('Tiene que ser "tarjeta" o "cinta"');
  const dur = config[que].duracionSeg;
  ultimo[que] = Date.now();
  ocupadoHasta = Date.now() + dur * 1000;
  broadcast('codigo', { que, dur, at: Date.now(), manual, config: publicData().config });
  console.log(`[Código] ${que === 'tarjeta' ? 'Tarjeta "Apoya a un creador"' : 'Cinta de noticias'} en pantalla por ${dur} s${manual ? ' (desde el panel)' : ''}`);
  return { que, dur };
}

// Llamar cada pocos segundos. ctx: { live, descanso }
function tick(broadcast, ctx = {}) {
  const ahora = Date.now();
  const activo = !ctx.descanso && (!config.soloEnVivo || ctx.live);
  for (const que of ['tarjeta', 'cinta']) {
    const c = config[que];
    if (!activo || !c.on || !(c.cadaMin > 0)) { ultimo[que] = ahora; continue; } // al activarse, la primera sale después de un intervalo completo
    if (ahora < ocupadoHasta + 4000) continue;
    if (ahora - ultimo[que] >= c.cadaMin * 60000) { mostrar(que, broadcast); break; }
  }
}

function proximas(ctx = {}) {
  const activo = !ctx.descanso && (!config.soloEnVivo || ctx.live);
  const r = {};
  for (const que of ['tarjeta', 'cinta']) {
    const c = config[que];
    r[que] = !c.on || !(c.cadaMin > 0) ? { estado: 'apagada' } : !activo ? { estado: ctx.descanso ? 'en pausa' : 'esperando el stream' }
      : { estado: 'activa', enSeg: Math.max(0, Math.round((ultimo[que] + c.cadaMin * 60000 - Date.now()) / 1000)) };
  }
  return r;
}

function publicData() {
  return { config: clone(config) };
}

module.exports = { setConfig, mostrar, tick, proximas, publicData, save };

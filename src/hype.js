// Tren del hype de Twitch: guarda el estado del tren y la configuración del overlay (/hype).
// Twitch avisa con 3 eventos (versión 2): begin (empieza), progress (suma puntos / sube de nivel) y end (termina).
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'hype.json');

const DEFAULTS = {
  on: true,
  musica: true,          // música de fondo mientras el tren está activo (sube de ritmo con cada nivel)
  efectos: true,         // bocina, fanfarrias y sonidos de cada nivel (interruptor general)
  sInicio: true,         // sonido de inicio (bocina o tu hype-inicio.mp3)
  sNivel: true,          // fanfarria al subir de nivel
  sChicos: true,         // sonidos chicos: puntos que se suman y fuegos artificiales
  sFin: true,            // sonido al terminar
  silenciarConInicio: true, // mientras suena tu hype-inicio.mp3 no suena nada más (la música empieza cuando termina)
  volumen: 70,
  posicion: 'arriba',    // dónde queda la barra del tren: 'arriba' o 'abajo'
  mostrarTop: true,      // los 3 que más aportaron
  titulo: 'Tren del hype',
  // Canción sincronizada: el tren entra, late y festeja al ritmo de tu hype-inicio.mp3.
  // Valores medidos sobre la canción (128 BPM). Si cambias el archivo, se vuelve al modo normal hasta ajustarlos.
  cancion: {
    on: true, archivo: 'hype-inicio.mp3', bytes: 1515791,
    bpm: 128, golpe: 0.125,   // primer golpe (s); los demás caen cada 60/bpm
    entrada: 2.0,             // golpe fuerte: entra el tren
    barra: 9.5,               // golpe fuerte: aparece la barra
    loopDesde: 17.0, loopHasta: 47.0, // parte que se repite mientras dura el tren (64 golpes justos)
    drop: [32.0],             // los momentos más fuertes: OVERDRIVE
    finDesde: 47.0,           // al terminar el tren salta aquí y suena el final de la canción
  },
};

// Canciones ya medidas (se reconocen por el tamaño del archivo): si pones cualquiera como hype-inicio.mp3, se sincroniza sola
const PERFILES = {
  1515791: { bpm: 128, golpe: 0.125, entrada: 2.0, barra: 9.5, loopDesde: 17.0, loopHasta: 47.0, drop: [32.0], finDesde: 47.0 },
  2943958: { bpm: 128, golpe: 0.02, entrada: 1.9, barra: 7.52, loopDesde: 61.88, loopHasta: 90.005, drop: [15.02, 61.88], finDesde: 106.86 },
};
let config = { ...DEFAULTS };
let estado = null;   // tren activo (o el último que terminó, con fase 'fin')
try {
  const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  config = { ...DEFAULTS, ...(j.config || {}), cancion: { ...DEFAULTS.cancion, ...((j.config || {}).cancion || {}) } };
  estado = j.estado || null;
} catch (err) {
  if (err.code !== 'ENOENT') console.error('[Hype] No se pudo leer', FILE, '-', err.message);
}
// Si el programa estuvo cerrado y el tren ya venció, no se retoma
if (estado && estado.fase !== 'fin' && estado.expira && estado.expira < Date.now() - 60000) estado = null;

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify({ config, estado }, null, 2));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (err) { console.error('[Hype] No se pudo guardar:', err.message); }
}

const TIPOS = { regular: 'normal', golden_kappa: 'Golden Kappa', treasure: 'Tesoro' };
const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
// las horas de Twitch se pasan a la hora de esta PC (por si el reloj de Windows está corrido)
let desfaseTwitch = 0;
const fecha = (v) => (v && Date.parse(v) ? Date.parse(v) - desfaseTwitch : 0);

function top(lista) {
  return (lista || []).slice(0, 3).map((c) => ({
    nombre: c.user_name || c.user_login || 'Alguien',
    tipo: c.type === 'bits' ? 'bits' : c.type === 'subscription' ? 'subs' : 'otro',
    total: n(c.total),
  }));
}

// fase: 'begin' | 'progress' | 'end'. e: el evento de Twitch tal cual.
function procesar(fase, e = {}, desfase = 0) {
  desfaseTwitch = Number(desfase) || 0;
  const antes = estado && estado.fase !== 'fin' && estado.id === e.id ? estado : null;
  const nivelAntes = antes ? antes.nivel : 0;
  const nivel = Math.max(1, n(e.level, 1));
  const nuevo = {
    id: e.id || (antes && antes.id) || 'tren',
    fase: fase === 'begin' ? 'inicio' : fase === 'end' ? 'fin' : 'progreso',
    tipo: e.type || 'regular',
    tipoNombre: TIPOS[e.type] || 'normal',
    nivel,
    total: n(e.total),
    progreso: n(e.progress, antes ? antes.progreso : 0),
    meta: n(e.goal, antes ? antes.meta : 0),
    record: n(e.all_time_high_level, antes ? antes.record : 0),
    compartido: !!e.is_shared_train,
    top: e.top_contributions ? top(e.top_contributions) : antes ? antes.top : [],
    inicio: fecha(e.started_at) || (antes && antes.inicio) || Date.now(),
    expira: fase === 'end' ? 0 : fecha(e.expires_at) || (antes && antes.expira) || Date.now() + 5 * 60000,
    fin: fase === 'end' ? fecha(e.ended_at) || Date.now() : 0,
  };
  const subio = fase === 'begin' ? 0 : Math.max(0, nivel - (nivelAntes || nivel));
  estado = nuevo;
  save();
  return { ...publicEstado(), subio, nivelAntes, nuevoRecord: nuevo.record > 0 && nivel > nuevo.record };
}

function publicEstado() {
  return { estado, ahora: Date.now() };
}

function setConfig(b = {}) {
  for (const k of ['on', 'musica', 'efectos', 'mostrarTop', 'sInicio', 'sNivel', 'sChicos', 'sFin', 'silenciarConInicio']) if (k in b) config[k] = !!b[k];
  if ('volumen' in b) config.volumen = Math.max(0, Math.min(100, Math.round(n(b.volumen, config.volumen))));
  if (b.posicion === 'arriba' || b.posicion === 'abajo') config.posicion = b.posicion;
  if (b.cancion && typeof b.cancion === 'object') {
    const c = config.cancion;
    if ('on' in b.cancion) c.on = !!b.cancion.on;
    if ('archivo' in b.cancion) { const a = path.basename(String(b.cancion.archivo || '')); if (a && a !== c.archivo) { c.archivo = a; c.bytes = 0; c.remedir = false; } }
    if (b.cancion.remedir) { c.bytes = 0; c.remedir = true; }
    for (const k of ['bpm', 'golpe', 'entrada', 'barra', 'loopDesde', 'loopHasta', 'finDesde']) if (k in b.cancion && Number.isFinite(Number(b.cancion[k]))) c[k] = Math.max(0, Number(b.cancion[k]));
    if ('drop' in b.cancion) { const d = (Array.isArray(b.cancion.drop) ? b.cancion.drop : String(b.cancion.drop).split(/[;\s]+|,(?=\s)/)).map((v) => Number(String(v).replace(',', '.'))).filter((v) => Number.isFinite(v) && v >= 0); if (d.length) c.drop = d.slice(0, 8); }
    if (c.loopHasta <= c.loopDesde) c.loopHasta = c.loopDesde + 8;
  }
  if ('titulo' in b) config.titulo = String(b.titulo || '').trim().slice(0, 30) || DEFAULTS.titulo;
  save();
  return config;
}

// ---------- Pruebas desde el panel: arma eventos como los de Twitch ----------
const NOMBRES = ['nephallems', 'Nepha', 'MagicMattXD', 'Fevuer', 'Cuervo_88', 'Tussi'];
function probar(accion) {
  const a = estado && estado.fase !== 'fin' ? estado : null;
  const ahora = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const tops = (k) => NOMBRES.slice(k % 3, k % 3 + 3).map((u, i) => ({ user_name: u, type: i === 1 ? 'subscription' : 'bits', total: 1500 - i * 400 + k * 100 }));
  if (accion === 'inicio' || !a) {
    if (accion === 'fin') throw new Error('No hay un tren activo para terminar');
    return procesar('begin', { id: 'prueba-' + ahora, level: 1, total: 600, progress: 600, goal: 1600, type: 'regular', all_time_high_level: 4,
      top_contributions: tops(0), started_at: iso(ahora), expires_at: iso(ahora + 5 * 60000) });
  }
  const base = { id: a.id, type: a.tipo, all_time_high_level: a.record, started_at: iso(a.inicio) };
  if (accion === 'progreso') {
    const suma = 300;
    if (a.progreso + suma >= a.meta) accion = 'nivel';
    else return procesar('progress', { ...base, level: a.nivel, total: a.total + suma, progress: a.progreso + suma, goal: a.meta, top_contributions: tops(a.nivel), expires_at: iso(ahora + 5 * 60000) });
  }
  if (accion === 'nivel') {
    const nivel = a.nivel + 1, meta = Math.round(1600 + nivel * 600);
    return procesar('progress', { ...base, level: nivel, total: a.total + (a.meta - a.progreso) + 200, progress: 200, goal: meta, top_contributions: tops(nivel), expires_at: iso(ahora + 5 * 60000) });
  }
  if (accion === 'fin') {
    return procesar('end', { ...base, level: a.nivel, total: a.total, top_contributions: tops(a.nivel), ended_at: iso(ahora), cooldown_ends_at: iso(ahora + 3600000) });
  }
  throw new Error('Acción de prueba desconocida');
}

// Si el archivo es una canción ya medida y no coincide con la guardada, aplica sus tiempos
function perfilPorTamano(bytes) {
  const p = PERFILES[bytes];
  if (!p || config.cancion.bytes === bytes || config.cancion.remedir) return false;
  config.cancion = { ...config.cancion, ...p, bytes };
  save();
  console.log(`[Hype] Canción reconocida (${p.bpm} BPM): tiempos de sincronización actualizados`);
  return true;
}

// Tiempos medidos automáticamente (los mide el panel o el overlay al elegir una canción nueva)
function setPerfil(b = {}) {
  const c = config.cancion, p = b.perfil || {};
  if (path.basename(String(b.archivo || '')) !== c.archivo) throw new Error('La canción cambió mientras se medía');
  for (const k of ['bpm', 'golpe', 'entrada', 'barra', 'loopDesde', 'loopHasta', 'finDesde', 'duracion']) if (Number.isFinite(Number(p[k]))) c[k] = Math.max(0, Number(p[k]));
  if (Array.isArray(p.drop)) c.drop = p.drop.map(Number).filter((v) => Number.isFinite(v) && v >= 0).slice(0, 8);
  if (c.loopHasta <= c.loopDesde) c.loopHasta = c.loopDesde + 8;
  c.bytes = Number(b.bytes) || 0; c.auto = true; c.remedir = false;
  save();
  console.log(`[Hype] Canción medida: ${c.archivo} · ${c.bpm} BPM · entra ${c.entrada}s · se repite ${c.loopDesde}–${c.loopHasta}s · final ${c.finDesde}s`);
  return config;
}

module.exports = { perfilPorTamano, setPerfil, procesar, probar, setConfig, getConfig: () => config, publicEstado, save };

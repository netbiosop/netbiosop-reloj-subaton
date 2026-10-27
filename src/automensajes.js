// Mensajes automáticos en el chat de Twitch: cada mensaje sale solo cada X minutos.
// Se configura desde /automensajes-panel y se guarda en data/automensajes.json.
//  • Interruptor general para prender o apagar todo, y uno por cada mensaje.
//  • Solo con el stream en vivo (opcional) y nunca durante el descanso.
//  • Anti-spam: espera a que escriban algunos mensajes en el chat y deja un margen entre automensajes.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'automensajes.json');
const MAX_TEXTO = 450; // límite de Twitch por mensaje (500) con margen

const DEFAULTS = {
  on: false,          // apagado hasta que lo prendas desde el panel
  soloEnVivo: true,
  minChat: 3,         // mensajes de otras personas en el chat desde el último automensaje
  separacionSeg: 90,  // tiempo mínimo entre dos automensajes
  mensajes: [
    { id: 'm1', texto: '¡Bienvenidos al stream! Si te gusta el contenido, deja tu follow 💜 HeyGuys', cadaMin: 20, on: true },
    { id: 'm2', texto: '⏱ El subatón sigue: quedan {tiempo} en el reloj. ¡Cada sub, bits o donación suma tiempo! PogChamp', cadaMin: 30, on: true },
  ],
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def; };
const limpiar = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, MAX_TEXTO);

let config = clone(DEFAULTS);
try {
  const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  config = { ...clone(DEFAULTS), ...j };
  if (!Array.isArray(config.mensajes)) config.mensajes = [];
} catch (err) {
  if (err.code !== 'ENOENT') console.error('[Automensajes] No se pudo leer', FILE, '-', err.message);
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(config, null, 2));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (err) { console.error('[Automensajes] No se pudo guardar:', err.message); }
}

// ---------- Programación ----------
const ultimo = {};        // id → última vez que salió (o que empezó a contar)
let ultimoEnvio = 0;      // el último automensaje de cualquier tipo
let lineasChat = 0;       // mensajes de otras personas desde el último automensaje
let enviando = false;
const ahora = () => Date.now();

function setConfig(b = {}) {
  for (const k of ['on', 'soloEnVivo']) if (k in b) config[k] = !!b[k];
  if ('minChat' in b) config.minChat = num(b.minChat, 0, 100, config.minChat);
  if ('separacionSeg' in b) config.separacionSeg = num(b.separacionSeg, 30, 3600, config.separacionSeg);
  if (Array.isArray(b.mensajes)) {
    config.mensajes = b.mensajes.slice(0, 30).map((m, i) => ({
      id: String(m.id || '').replace(/[^\w-]/g, '').slice(0, 20) || 'm' + Date.now().toString(36) + i,
      texto: limpiar(m.texto),
      cadaMin: num(m.cadaMin, 1, 600, 20),
      on: m.on !== false,
    })).filter((m) => m.texto);
  }
  save();
  return config;
}

// Reemplaza {tiempo}, {canal}, etc.
function armar(texto, ctx) {
  const vars = { tiempo: ctx.tiempo?.() ?? '', canal: ctx.canal?.() ?? '' };
  return texto.replace(/\{(\w+)\}/g, (todo, k) => (k.toLowerCase() in vars ? vars[k.toLowerCase()] : todo));
}

async function enviar(m, ctx, manual = false) {
  if (!ctx.puedeChat?.()) throw new Error('Twitch no tiene permiso para escribir en el chat: en Configuración pulsa Desconectar y vuelve a Conectar con Twitch');
  enviando = true;
  try {
    const ok = await ctx.enviar(armar(m.texto, ctx));
    if (!ok) throw new Error('Twitch no aceptó el mensaje (mira la ventana del reloj para ver el motivo)');
    ultimo[m.id] = ultimoEnvio = ahora();
    lineasChat = 0;
    console.log(`[Automensajes] 💬 ${manual ? '(desde el panel) ' : ''}${m.texto.slice(0, 70)}${m.texto.length > 70 ? '…' : ''}`);
    return { enviado: m.id };
  } finally { enviando = false; }
}

function activo(ctx) { return config.on && !ctx.descanso && (!config.soloEnVivo || ctx.live); }

// Se llama cada pocos segundos. ctx: { live, descanso, puedeChat(), enviar(texto) → bool, tiempo(), canal() }
async function tick(ctx) {
  const t = ahora();
  const lista = config.mensajes.filter((m) => m.on && m.texto);
  if (!activo(ctx)) { for (const m of config.mensajes) ultimo[m.id] = t; lineasChat = 0; return; } // al activarse, cada uno sale después de su intervalo completo
  for (const m of lista) if (!ultimo[m.id]) ultimo[m.id] = t;
  if (enviando || !ctx.puedeChat?.()) return;
  if (t - ultimoEnvio < config.separacionSeg * 1000) return;
  if (lineasChat < config.minChat) return;
  // el que más tiempo lleva esperando
  const vencidos = lista.filter((m) => t - ultimo[m.id] >= m.cadaMin * 60000)
    .sort((a, b) => (t - ultimo[b.id] - b.cadaMin * 60000) - (t - ultimo[a.id] - a.cadaMin * 60000));
  if (vencidos[0]) {
    try { await enviar(vencidos[0], ctx); }
    catch (e) { ultimo[vencidos[0].id] = t; console.error('[Automensajes]', e.message); } // reintenta en el próximo intervalo
  }
}

// Cada mensaje del chat (menos los del propio canal) cuenta para el anti-spam
function alChat(e) {
  if (!e || e.chatter_user_id === e.broadcaster_user_id) return;
  lineasChat++;
}

function enviarAhora(id, ctx) {
  const m = config.mensajes.find((x) => x.id === id);
  if (!m) throw new Error('No encuentro ese mensaje (¿lo guardaste?)');
  return enviar(m, ctx, true);
}

function estado(ctx) {
  const t = ahora();
  const motivo = !config.on ? 'apagado' : ctx.descanso ? 'en pausa (descanso)' : config.soloEnVivo && !ctx.live ? 'esperando que empiece el stream' : !ctx.puedeChat?.() ? 'sin permiso de chat' : 'activo';
  return {
    config, motivo, activo: motivo === 'activo', lineasChat,
    faltanLineas: Math.max(0, config.minChat - lineasChat),
    proximos: Object.fromEntries(config.mensajes.map((m) => [m.id, m.on && motivo === 'activo' && ultimo[m.id] ? Math.max(0, Math.round((ultimo[m.id] + m.cadaMin * 60000 - t) / 1000)) : null])),
  };
}

module.exports = { setConfig, tick, alChat, enviarAhora, estado, save, getConfig: () => config };

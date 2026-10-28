// Mensajes automáticos en el chat de Twitch: sale un mensaje cada X minutos (10 por defecto), uno detrás de otro.
// No aparece en el menú: se prende y se apaga desde el chat.
//  • "activar bot" / "desactivar bot" → solo Nephallems (y el dueño del canal).
//  • Los mensajes se editan en /automensajes-panel y se guardan en data/automensajes.json.
//  • Solo con el stream en vivo (opcional) y nunca durante el descanso.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'automensajes.json');
const MAX_TEXTO = 450; // límite de Twitch por mensaje (500) con margen
const ACTIVAR = /^!?\s*activar\s*bot\b/i;
const DESACTIVAR = /^!?\s*desactivar\s*bot\b/i;

const DEFAULTS = {
  on: false,              // se prende cuando escriben "activar bot" en el chat
  quienes: ['nephallems'], // quiénes pueden activarlo además del dueño del canal
  cadaMin: 10,            // sale un mensaje cada 10 minutos, rotando
  soloEnVivo: true,
  minChat: 0,             // opcional: esperar N mensajes del chat antes de cada automensaje (0 = no esperar)
  mensajes: [
    { id: 'm1', texto: '¡Bienvenidos al stream! Si te gusta el contenido, deja tu follow 💜 HeyGuys', on: true },
    { id: 'm2', texto: '⏱ El subatón sigue: quedan {tiempo} en el reloj. ¡Cada sub, bits o donación suma tiempo! PogChamp', on: true },
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
  if (!Array.isArray(config.quienes) || !config.quienes.length) config.quienes = clone(DEFAULTS.quienes);
  if (j.version !== 2) { config.on = false; config.cadaMin = 10; config.minChat = 0; config.mensajes = config.mensajes.map(({ cadaMin, ...m }) => m); } // la 2.10.0 tenía un tiempo por mensaje
} catch (err) {
  if (err.code !== 'ENOENT') console.error('[Automensajes] No se pudo leer', FILE, '-', err.message);
}
config.version = 2;

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(config, null, 2));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (err) { console.error('[Automensajes] No se pudo guardar:', err.message); }
}

// ---------- Programación ----------
let ultimoEnvio = 0;  // último automensaje (o desde cuándo se cuenta)
let siguiente = 0;    // índice del próximo mensaje en la rotación
let lineasChat = 0;   // mensajes de otras personas desde el último automensaje
let enviando = false;

function setConfig(b = {}) {
  if ('on' in b) { if (!!b.on && !config.on) ultimoEnvio = Date.now(); config.on = !!b.on; }
  if ('soloEnVivo' in b) config.soloEnVivo = !!b.soloEnVivo;
  if ('cadaMin' in b) config.cadaMin = num(b.cadaMin, 1, 240, config.cadaMin);
  if ('minChat' in b) config.minChat = num(b.minChat, 0, 100, config.minChat);
  if ('quienes' in b) {
    const l = (Array.isArray(b.quienes) ? b.quienes : String(b.quienes).split(/[\s,]+/)).map((u) => String(u).replace(/^@/, '').trim().toLowerCase()).filter(Boolean).slice(0, 10);
    if (l.length) config.quienes = l;
  }
  if (Array.isArray(b.mensajes)) {
    config.mensajes = b.mensajes.slice(0, 30).map((m, i) => ({
      id: String(m.id || '').replace(/[^\w-]/g, '').slice(0, 20) || 'm' + Date.now().toString(36) + i,
      texto: limpiar(m.texto),
      on: m.on !== false,
    })).filter((m) => m.texto);
  }
  save();
  return config;
}

// Reemplaza {tiempo} y {canal}
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
    if (!manual) { ultimoEnvio = Date.now(); lineasChat = 0; }
    console.log(`[Automensajes] 💬 ${manual ? '(desde el panel) ' : ''}${m.texto.slice(0, 70)}${m.texto.length > 70 ? '…' : ''}`);
    return { enviado: m.id };
  } finally { enviando = false; }
}

const activos = () => config.mensajes.filter((m) => m.on && m.texto);
const motivo = (ctx) => (!config.on ? 'apagado' : ctx.descanso ? 'en pausa (descanso)' : config.soloEnVivo && !ctx.live ? 'esperando que empiece el stream'
  : !ctx.puedeChat?.() ? 'sin permiso de chat' : !activos().length ? 'sin mensajes' : 'activo');

// Se llama cada pocos segundos. ctx: { live, descanso, puedeChat(), enviar(texto) → bool, tiempo(), canal() }
async function tick(ctx) {
  const t = Date.now();
  if (motivo(ctx) !== 'activo') { ultimoEnvio = t; lineasChat = 0; return; } // al volver, el primero sale después de un intervalo completo
  if (enviando || t - ultimoEnvio < config.cadaMin * 60000 || lineasChat < config.minChat) return;
  const lista = activos();
  const m = lista[siguiente % lista.length];
  siguiente = (siguiente + 1) % lista.length;
  try { await enviar(m, ctx); } catch (e) { ultimoEnvio = t; console.error('[Automensajes]', e.message); } // reintenta en el próximo intervalo
}

// Cada mensaje del chat: "activar bot" / "desactivar bot", y cuenta para el anti-spam opcional
function alChat(e, ctx) {
  if (!e) return;
  const texto = String(e.message?.text || '').trim();
  const login = String(e.chatter_user_login || '').toLowerCase();
  const puede = e.chatter_user_id === e.broadcaster_user_id || config.quienes.includes(login);
  if (puede && (ACTIVAR.test(texto) || DESACTIVAR.test(texto))) {
    const prender = ACTIVAR.test(texto);
    const yaEstaba = config.on === prender;
    setConfig({ on: prender });
    siguiente = 0;
    const quien = e.chatter_user_name || login;
    console.log(`[Automensajes] ${prender ? '🤖 Bot activado' : '💤 Bot desactivado'} por ${quien} desde el chat`);
    const aviso = prender
      ? (yaEstaba ? '🤖 El bot ya estaba activado' : '🤖 Bot activado') + `: un mensaje cada ${config.cadaMin} minutos${config.soloEnVivo && !ctx?.live ? ' (cuando empiece el stream)' : ''}.`
      : yaEstaba ? '💤 El bot ya estaba desactivado.' : '💤 Bot desactivado.';
    if (ctx?.puedeChat?.()) ctx.enviar(aviso, e.message_id).catch(() => {});
    return;
  }
  if (e.chatter_user_id !== e.broadcaster_user_id) lineasChat++;
}

function enviarAhora(id, ctx) {
  const m = config.mensajes.find((x) => x.id === id);
  if (!m) throw new Error('No encuentro ese mensaje (¿lo guardaste?)');
  return enviar(m, ctx, true);
}

function estado(ctx) {
  const mot = motivo(ctx), lista = activos();
  return {
    config, motivo: mot, activo: mot === 'activo',
    faltanLineas: Math.max(0, config.minChat - lineasChat),
    proximoEnSeg: mot === 'activo' ? Math.max(0, Math.round((ultimoEnvio + config.cadaMin * 60000 - Date.now()) / 1000)) : null,
    proximoId: lista.length ? lista[siguiente % lista.length].id : null,
  };
}

module.exports = { setConfig, tick, alChat, enviarAhora, estado, save, getConfig: () => config };

// Mensajes automáticos en el chat de Twitch: sale un mensaje cada X minutos (10 por defecto), uno detrás de otro.
//  • Cada persona de la lista (ej. Nephallems) prende y apaga SU bot desde el chat: "activar bot" / "desactivar bot".
//    El dueño del canal también, o con el botón del panel ("tu bot").
//  • Cada una elige sus propios mensajes desde el chat, sin entrar al panel:
//      bot mensaje <texto> · bot mis mensajes · bot cambiar <n> <texto> · bot borrar <n> · bot borrar todo · bot ayuda
//  • Mientras alguien tenga su bot activo, rotan los mensajes generales del panel + los de cada persona activa.
//    Los de cada persona salen con su cuenta si la vinculó (src/twitch-cuentas.js); si no, con la del canal.
//  • Se guarda en data/automensajes.json. Solo con el stream en vivo (opcional) y nunca durante el descanso.
const fs = require('fs');
const path = require('path');
const apartarDanado = require('./danado');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'automensajes.json');
const MAX_TEXTO = 450;   // límite de Twitch por mensaje (500) con margen
const MAX_PROPIOS = 3;   // mensajes que cada persona puede elegir desde el chat
const MAX_MENSAJES = 60; // en total, desde el panel
const MAX_ECOS = 10;     // envíos recientes con cuenta vinculada cuyo eco no cuenta como chat
const LARGO_REGISTRO = 70;
const DUENO = '_dueno';  // el dueño del canal en la lista de bots activos
const ACTIVAR = /^!?\s*activar\s*bot\b/i;
const DESACTIVAR = /^!?\s*desactivar\s*bot\b/i;
const COMANDO = /^!?\s*bot\s+(.+)$/i;

const DEFAULTS = {
  activos: {},             // login → { nombre, desde }: quién tiene su bot prendido (DUENO = el dueño del canal)
  quienes: ['nephallems'], // quiénes pueden usarlo además del dueño del canal
  cadaMin: 10,             // sale un mensaje cada 10 minutos, rotando
  soloEnVivo: true,
  minChat: 0,              // opcional: esperar N mensajes del chat antes de cada automensaje (0 = no esperar)
  mensajes: [              // autor: '' = general (del panel) · o el usuario que lo eligió desde el chat
    { id: 'm1', texto: '¡Bienvenidos al stream! Si te gusta el contenido, deja tu follow 💜 HeyGuys', on: true, como: '', autor: '' },
    { id: 'm2', texto: '⏱ El subatón sigue: quedan {tiempo} en el reloj. ¡Cada sub, bits o donación suma tiempo! PogChamp', on: true, como: '', autor: '' },
  ],
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const normalizar = (u) => String(u || '').replace(/^@/, '').trim().toLowerCase();
const esLogin = (u) => /^[a-z0-9_]{3,25}$/.test(u); // así son los nombres de usuario de Twitch
const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def; };
const limpiar = (v) => String(v ?? '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, MAX_TEXTO);
const nuevoId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

let config = clone(DEFAULTS);
try {
  const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  config = { ...clone(DEFAULTS), ...j };
  config.mensajes = Array.isArray(config.mensajes) ? config.mensajes.filter((m) => m && typeof m.texto === 'string') : [];
  if (!Array.isArray(config.quienes)) config.quienes = clone(DEFAULTS.quienes);
  if (!config.nombres || typeof config.nombres !== 'object') config.nombres = {};
  if (!config.activos || typeof config.activos !== 'object') config.activos = {};
  if (j.version !== 2 && j.version !== 3) { config.cadaMin = 10; config.minChat = 0; config.mensajes = config.mensajes.map(({ cadaMin, ...m }) => m); j.on = false; }
  if (j.version !== 3 && j.on) { // hasta la 2.15 había un solo bot; si lo activó el dueño desde el chat, activadoPor tiene su login
    const login = j.activadoPor?.login;
    config.activos[config.quienes.includes(login) ? login : DUENO] = { nombre: j.activadoPor?.nombre || '', desde: Date.now() };
  }
  config.mensajes = config.mensajes.map((m) => ({ como: '', autor: '', ...m }));
} catch (err) {
  if (err.code !== 'ENOENT') console.error('[Automensajes] No se pudo leer', FILE, '-', err.message);
  apartarDanado(FILE, err);
}
delete config.on; delete config.activadoPor;
config.version = 3;

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(config, null, 2));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (err) { console.error('[Automensajes] No se pudo guardar:', err.message); }
}

// ---------- Quién está activo y qué mensajes rotan ----------
let ultimoEnvio = 0;  // último automensaje (o desde cuándo se cuenta)
let ultimoId = '';    // el último que salió (la rotación sigue desde ahí)
let lineasChat = 0;   // mensajes de otras personas desde el último automensaje
let enviando = false;
// Lo que el bot escribió con una cuenta vinculada vuelve por el chat como si fuera de esa persona: no cuenta para minChat
const ecos = [];
function anotarEco(login, texto) {
  ecos.push({ login, texto: String(texto).slice(0, MAX_TEXTO).trim() }); // se envía recortado: {canal} y {tiempo} alargan la plantilla
  if (ecos.length > MAX_ECOS) ecos.shift();
}

const hayActivos = () => Object.keys(config.activos).length > 0;
const nombreDe = (login) => (login === DUENO ? 'tú' : config.activos[login]?.nombre || config.nombres?.[login] || login);
// Rotan: los generales (si alguien tiene su bot activo) + los propios de cada persona activa
const enRotacion = () => (hayActivos() ? config.mensajes.filter((m) => m.on && m.texto && (!m.autor || config.activos[m.autor])) : []);

function activar(login, nombre) {
  if (!hayActivos()) ultimoEnvio = Date.now(); // el primero sale después de un intervalo completo
  config.activos[login] = { nombre: nombre || config.activos[login]?.nombre || '', desde: Date.now() };
  save();
}
function desactivar(login) {
  if (login === '*') config.activos = {}; else delete config.activos[login];
  save();
}

const comoValido = (c) => { c = normalizar(c); return c === 'canal' || config.quienes.includes(c) ? c : ''; };

function setConfig(b = {}) {
  if ('on' in b) (b.on ? activar(DUENO, '') : desactivar(DUENO)); // el botón del panel = tu bot
  if (b.apagarTodos) desactivar('*');
  if (b.apagar) desactivar(normalizar(b.apagar));
  if ('soloEnVivo' in b) config.soloEnVivo = !!b.soloEnVivo;
  if ('cadaMin' in b) config.cadaMin = num(b.cadaMin, 1, 240, config.cadaMin);
  if ('minChat' in b) config.minChat = num(b.minChat, 0, 100, config.minChat);
  if (Array.isArray(b.mensajes)) {
    const delChat = new Set(config.mensajes.filter((m) => m.autor).map((m) => m.id));
    config.mensajes = b.mensajes.filter((m) => m && typeof m === 'object').slice(0, MAX_MENSAJES).map((m) => {
      const autor = normalizar(m.autor);
      return {
        pedido: autor, // el autor que manda el panel, antes de compararlo con la lista
        id: String(m.id || '').replace(/[^\w-]/g, '').slice(0, 20) || nuevoId(),
        texto: limpiar(m.texto),
        on: m.on !== false,
        autor: config.quienes.includes(autor) ? autor : '',
        como: config.quienes.includes(autor) ? autor : comoValido(m.como), // los de una persona salen siempre con su cuenta
      };
    }).filter((m) => m.texto && (!m.pedido || delChat.has(m.id))) // un panel desactualizado no revive lo que la persona borró (o a quien se quitó de la lista)
      .map(({ pedido, ...m }) => m);
  }
  save();
  return publicConfig();
}

// Reemplaza {tiempo} y {canal}
function armar(texto, ctx) {
  const vars = { tiempo: ctx.tiempo?.() ?? '', canal: ctx.canal?.() ?? '' };
  return texto.replace(/\{(\w+)\}/g, (todo, k) => (k.toLowerCase() in vars ? vars[k.toLowerCase()] : todo));
}

// Con qué cuenta sale un mensaje: la de su autor o la elegida; los generales "de quien activó",
// con la de la última persona que activó su bot y la tenga vinculada. Si no, la del canal.
function cuentaDelMensaje(m, ctx) {
  const ligada = (login) => (login && login !== 'canal' && ctx.tieneCuenta?.(login) ? { login, nombre: nombreDe(login) } : null);
  if (m.como === 'canal') return null;
  if (m.autor || m.como) return ligada(m.autor || m.como);
  const ultimo = Object.entries(config.activos).filter(([l]) => l !== DUENO && ctx.tieneCuenta?.(l)).sort((a, b) => b[1].desde - a[1].desde)[0];
  return ultimo ? ligada(ultimo[0]) : null;
}

async function enviar(m, ctx, manual = false) {
  const como = cuentaDelMensaje(m, ctx);
  if (!como && !ctx.puedeChat?.()) throw new Error('Twitch no tiene permiso para escribir en el chat: en Configuración pulsa Desconectar y vuelve a Conectar con Twitch');
  const texto = armar(m.texto, ctx);
  // también al enviar: mensajes guardados antes de este filtro, o el prefijo cambió después
  if (m.autor && esOrden(texto, ctx)) throw new Error(`No se envía el mensaje de ${nombreDe(m.autor)}: empieza con un comando (si su cuenta falla, sale con la del canal)`);
  const ok = await ctx.enviar(texto, null, como?.login);
  if (!ok) throw new Error('Twitch no aceptó el mensaje (mira la ventana del reloj para ver el motivo)');
  if (como) anotarEco(como.login, texto);
  if (!manual) { ultimoEnvio = Date.now(); lineasChat = 0; ultimoId = m.id; }
  console.log(`[Automensajes] 💬 ${manual ? '(desde el panel) ' : ''}${como ? `(como ${como.nombre}) ` : ''}${corto(m.texto, LARGO_REGISTRO)}`);
  return { enviado: m.id };
}

const motivo = (ctx) => (!hayActivos() ? 'apagado' : ctx.descanso ? 'en pausa (descanso)' : config.soloEnVivo && !ctx.live ? 'esperando que empiece el stream'
  : !enRotacion().length ? 'sin mensajes' : 'activo');
const siguienteMensaje = () => { const l = enRotacion(); if (!l.length) return null; const i = l.findIndex((m) => m.id === ultimoId); return l[(i + 1) % l.length]; };

// Se llama cada pocos segundos. ctx: { live, descanso, puedeChat(), tieneCuenta(login), enviar(texto, responderA, como) → bool, tiempo(), canal() }
async function tick(ctx) {
  const t = Date.now();
  if (motivo(ctx) !== 'activo') { ultimoEnvio = t; lineasChat = 0; return; } // al volver, el primero sale después de un intervalo completo
  if (enviando || t - ultimoEnvio < config.cadaMin * 60000 || lineasChat < config.minChat) return;
  const m = siguienteMensaje();
  enviando = true; // solo el envío automático: "Enviar ahora" desde el panel no debe soltar este seguro
  try { await enviar(m, ctx); } catch (e) { ultimoEnvio = t; ultimoId = m.id; console.error('[Automensajes]', e.message); } // sigue con el próximo en el siguiente intervalo
  finally { enviando = false; }
}

// ---------- Desde el chat ----------
const AYUDA = `Comandos del bot: "activar bot" / "desactivar bot" · "bot mensaje <texto>" agrega uno tuyo (hasta ${MAX_PROPIOS}) · "bot mis mensajes" · "bot cambiar <n> <texto>" · "bot borrar <n>" o "bot borrar todo"`;
const propios = (login) => config.mensajes.filter((m) => m.autor === login);
const corto = (t, n = 60) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

const SINONIMOS = { agregar: 'mensaje', mensajes: 'mis', lista: 'mis', editar: 'cambiar', quitar: 'borrar', help: 'ayuda', comandos: 'ayuda' };
// Un mensaje que sale con la cuenta del canal vuelve por el chat como si lo hubiera escrito el dueño:
// no puede ser un comando (del reloj, de otro bot, de Twitch) ni una orden de este bot.
const esOrden = (t, ctx) => /^[!/]/.test(t) || t.startsWith(ctx.prefijo()) || ACTIVAR.test(t) || DESACTIVAR.test(t) || COMANDO.test(t);
const NO_ORDEN = 'El mensaje no puede empezar con un comando (! o /) ni ser una orden del bot.';

// Lo que pide una persona con "bot …" → texto de respuesta
function comando(login, nombre, resto, ctx) {
  const [palabra, ...partes] = resto.trim().split(/\s+/);
  const p = SINONIMOS[palabra.toLowerCase()] || palabra.toLowerCase(), texto = limpiar(partes.join(' '));
  if (login === DUENO && ['mensaje', 'mis', 'cambiar', 'borrar'].includes(p)) return 'Tus mensajes (los del canal) se editan en el panel del reloj. Estos comandos son para las personas de la lista.';
  if (p === 'mensaje') {
    if (!texto) return 'Escribe el mensaje después: bot mensaje ¡Sigan a este canal! 💜';
    if (esOrden(texto, ctx)) return NO_ORDEN;
    const mios = propios(login);
    if (mios.length >= MAX_PROPIOS) return `Ya tienes ${MAX_PROPIOS} mensajes. Cambia uno con "bot cambiar 1 <texto>" o borra uno con "bot borrar 1".`;
    config.mensajes.push({ id: nuevoId(), texto, on: true, autor: login, como: login });
    save();
    console.log(`[Automensajes] ${nombre} agregó un mensaje desde el chat: ${corto(texto, LARGO_REGISTRO)}`);
    return `✅ Guardado como tu mensaje #${mios.length + 1}${config.activos[login] ? '' : '. Sale cuando actives tu bot con "activar bot"'}.`;
  }
  if (p === 'mis') {
    const mios = propios(login);
    if (!mios.length) return 'No tienes mensajes propios. Agrega uno con: bot mensaje <texto>';
    return ('Tus mensajes: ' + mios.map((m, i) => `${i + 1}) ${corto(m.texto)}`).join(' · ')).slice(0, MAX_TEXTO);
  }
  if (p === 'cambiar') {
    const n = parseInt(partes[0], 10), nuevo = limpiar(partes.slice(1).join(' '));
    const m = propios(login)[n - 1];
    if (!m || !nuevo) return 'Así: bot cambiar 1 <nuevo texto> (mira el número con "bot mis mensajes")';
    if (esOrden(nuevo, ctx)) return NO_ORDEN;
    m.texto = nuevo; save();
    return `✅ Cambiado tu mensaje #${n}.`;
  }
  if (p === 'borrar') {
    if (/^todo/i.test(partes[0] || '')) {
      const n = propios(login).length;
      config.mensajes = config.mensajes.filter((m) => m.autor !== login); save();
      return n ? `🗑 Borrados tus ${n} mensajes.` : 'No tenías mensajes propios.';
    }
    const n = parseInt(partes[0], 10), m = propios(login)[n - 1];
    if (!m) return 'Así: bot borrar 1 (mira el número con "bot mis mensajes") o bot borrar todo';
    config.mensajes = config.mensajes.filter((x) => x !== m); save();
    return `🗑 Borrado tu mensaje #${n}.`;
  }
  if (p === 'ayuda') return AYUDA;
  return null; // "bot …" cualquiera (ej. "bot que buen stream"): no es un comando
}

function alChat(e, ctx) {
  if (!e) return;
  const texto = String(e.message?.text || '').trim();
  const login = String(e.chatter_user_login || '').toLowerCase();
  const esDueno = e.chatter_user_id === e.broadcaster_user_id;
  const puede = esDueno || config.quienes.includes(login);
  const clave = esDueno ? DUENO : login;
  const quien = e.chatter_user_name || login;
  const conSuCuenta = !esDueno && !!ctx?.tieneCuenta?.(login);
  // las respuestas salen con la cuenta de esa persona si la vinculó; si no, con la del canal diciendo su nombre
  const responder = (txt, conNombre = true) => {
    if (!conSuCuenta && !ctx?.puedeChat?.()) return;
    if (conSuCuenta) anotarEco(login, txt);
    ctx.enviar(conSuCuenta || esDueno || !conNombre ? txt : `@${quien} ${txt}`, e.message_id, conSuCuenta ? login : null); // sendChat y cuentasTwitch.enviar no rechazan: si fallan, lo anotan en el registro
  };

  if (puede && (ACTIVAR.test(texto) || DESACTIVAR.test(texto))) {
    const prender = ACTIVAR.test(texto);
    const todos = esDueno && !prender && /\btodos?\b/i.test(texto);
    const yaEstaba = !!config.activos[clave] === prender && !todos;
    if (prender) activar(clave, esDueno ? '' : quien); else desactivar(todos ? '*' : clave);
    const mios = esDueno ? 0 : propios(login).length;
    console.log(`[Automensajes] ${prender ? '🤖 Bot activado' : '💤 Bot desactivado'} por ${quien}${todos ? ' (para todos)' : ''} desde el chat${prender && !esDueno ? (conSuCuenta ? ' · salen con su cuenta' : ' · no vinculó su cuenta: salen con la del canal') : ''}`);
    const sufijo = config.soloEnVivo && !ctx?.live ? ' (cuando empiece el stream)' : '';
    const aviso = todos ? '💤 Bot desactivado para todos.'
      : prender ? `${yaEstaba ? '🤖 Tu bot ya estaba activado' : '🤖 Bot activado'}: un mensaje cada ${config.cadaMin} minutos${sufijo}.${!esDueno && !mios ? ' Elige el tuyo con: bot mensaje <texto>' : ''}`
      : yaEstaba ? '💤 Tu bot ya estaba desactivado.' : '💤 Bot desactivado.';
    responder(aviso);
    return;
  }
  const c = puede && texto.match(COMANDO);
  const r = c ? comando(clave, quien, c[1], ctx) : null;
  if (r) { responder(r); return; }
  if (esDueno) return;
  const eco = ecos.findIndex((x) => x.login === login && x.texto === texto);
  if (eco >= 0) ecos.splice(eco, 1); else lineasChat++;
}

function enviarAhora(id, ctx) {
  const m = config.mensajes.find((x) => x.id === id);
  if (!m) throw new Error('No encuentro ese mensaje (¿lo guardaste?)');
  return enviar(m, ctx, true);
}

// Para el panel: la config sin cambios + "on" (tu bot) y la lista de activos
function publicConfig() {
  return { ...config, on: !!config.activos[DUENO] };
}
function estado(ctx) {
  const mot = motivo(ctx), sig = siguienteMensaje();
  return {
    config: publicConfig(), motivo: mot, activo: mot === 'activo',
    activos: Object.entries(config.activos).map(([login, a]) => ({ login, nombre: login === DUENO ? 'Tú' : a.nombre || login, cuentaPropia: login !== DUENO && !!ctx.tieneCuenta?.(login), propios: propios(login).length })),
    faltanLineas: Math.max(0, config.minChat - lineasChat),
    proximoEnSeg: mot === 'activo' ? Math.max(0, Math.round((ultimoEnvio + config.cadaMin * 60000 - Date.now()) / 1000)) : null,
    proximoId: sig ? sig.id : null,
    enRotacion: enRotacion().map((m) => m.id),
  };
}

// Personas que pueden usar el bot (el nombre ya viene verificado con Twitch desde el servidor)
function agregarQuien(login, nombre) {
  login = normalizar(login);
  if (!esLogin(login)) throw new Error('Ese no es un nombre de Twitch válido (solo letras, números y _, de 3 a 25)');
  if (!config.quienes.includes(login)) config.quienes.push(login);
  config.nombres = { ...(config.nombres || {}), [login]: String(nombre || login).slice(0, 25) };
  save();
  return publicConfig();
}
function quitarQuien(login) {
  login = normalizar(login);
  config.quienes = config.quienes.filter((u) => u !== login);
  if (config.nombres) delete config.nombres[login];
  delete config.activos[login];
  config.mensajes = config.mensajes.filter((m) => m.autor !== login); // sus mensajes se van con esa persona
  for (const m of config.mensajes) if (m.como === login) m.como = '';
  save();
  return publicConfig();
}

module.exports = { agregarQuien, quitarQuien, normalizar, esLogin, setConfig, tick, alChat, enviarAhora, estado, save, getConfig: publicConfig };

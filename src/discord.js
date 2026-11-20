// Rangos en Discord: el reloj le da roles de tu servidor de Discord a quienes donan, regalan subs, dan bits,
// se suscriben y a los Top del mes. Son mensuales: al cambiar el mes se recalculan solos.
//  • Usa un bot de Discord tuyo (token en data/subaton.json → secrets.discord, nunca se sube a GitHub).
//  • Cada viewer se vincula escribiendo en el chat de Twitch: !discord su_usuario_de_discord
//    (o lo vinculas tú desde el panel). Se guarda en data/discord.json.
//  • Solo quita roles que puso el propio reloj: nunca toca los que diste a mano.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'discord.json');
const API = process.env.DISCORD_API || 'https://discord.com/api/v10';
const MANAGE_ROLES = 268435456; // permiso "Gestionar roles"

// Los rangos que puede dar el reloj (cada uno se asocia a un rol de tu servidor desde el panel)
const RANGOS = {
  donador: { nombre: 'Donador', desc: 'donó por Mercado Pago o PayPal este mes' },
  regalador: { nombre: 'Sub regalador', desc: 'regaló subs este mes' },
  bits: { nombre: 'Bits', desc: 'dio bits este mes' },
  suscriptor: { nombre: 'Suscriptor', desc: 'se suscribió o renovó este mes (con !discord)' },
  topDinero: { nombre: 'Top donador', desc: 'rey del mes: #1 donador del mes pasado' },
  topSubs: { nombre: 'Top subs regaladas', desc: 'rey del mes: #1 en subs regaladas del mes pasado' },
  topBits: { nombre: 'Top bits', desc: 'rey del mes: #1 en bits del mes pasado' },
};

const DEFAULTS = {
  on: false,
  guildId: '',
  roles: Object.fromEntries(Object.keys(RANGOS).map((k) => [k, ''])), // rango → id del rol de Discord ('' = no se da)
  minDonacionUsd: 0,   // monto mínimo del mes (en USD) para "Donador"
  comando: 'discord',  // !discord usuario
  invitacion: '',      // link de invitación a tu servidor (se lo dice a quien no está)
  vinculos: {},        // 'n:<nombre>' o 'mp:<clave>' → { id, usuario, via, at }
  otorgados: {},       // id del rol → { id del usuario: mes en que se dio } (lo que puso el reloj)
};

const clone = (o) => JSON.parse(JSON.stringify(o));
let config = clone(DEFAULTS);
try {
  const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  config = { ...clone(DEFAULTS), ...j, roles: { ...DEFAULTS.roles, ...(j.roles || {}) } };
} catch (err) {
  if (err.code !== 'ENOENT') console.error('[Discord] No se pudo leer', FILE, '-', err.message);
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(config, null, 2));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (err) { console.error('[Discord] No se pudo guardar:', err.message); }
}

function crearDiscord({ store, podio }) {
  const secreto = () => (store.data.secrets.discord ||= { token: '' });
  const token = () => String(secreto().token || '').trim();
  const estado = { conectado: false, bot: null, servidor: null, error: '', ultimaSync: 0, cambios: [], rolesServidor: [], posicionBot: 0 };
  const anotar = (t) => { estado.cambios.unshift({ at: Date.now(), t }); estado.cambios.length = Math.min(estado.cambios.length, 40); console.log('[Discord] ' + t); };

  async function api(metodo, ruta, body, motivo) {
    for (let intento = 0; intento < 3; intento++) {
      const r = await fetch(API + ruta, {
        method: metodo, signal: AbortSignal.timeout(15000),
        headers: { Authorization: 'Bot ' + token(), 'User-Agent': 'RelojSubaton (local, 1.0)', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(motivo ? { 'X-Audit-Log-Reason': encodeURIComponent(motivo) } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status === 429) { const j = await r.json().catch(() => ({})); await new Promise((ok) => setTimeout(ok, Math.min(10, Number(j.retry_after) || 1) * 1000 + 100)); continue; }
      if (r.status === 204) return null;
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(traducir(r.status, j)); e.status = r.status; e.code = j.code; throw e; }
      return j;
    }
    throw new Error('Discord está limitando los pedidos: se reintenta en un rato');
  }
  function traducir(status, j) {
    if (status === 401) return 'El token del bot no es válido (cópialo de nuevo desde el portal de Discord)';
    if (j.code === 10004) return 'No encuentro ese servidor: revisa el ID y que el bot esté invitado';
    if (j.code === 50013) return 'Al bot le falta permiso: necesita "Gestionar roles" y que su rol esté MÁS ARRIBA que los rangos que da';
    if (j.code === 50001) return 'El bot no tiene acceso a ese servidor (¿lo invitaste?)';
    if (j.code === 10007) return 'Esa persona ya no está en el servidor';
    return `Discord respondió ${status}${j.message ? ': ' + j.message : ''}`;
  }

  // ---------- Conexión ----------
  async function probar() {
    if (!token()) { Object.assign(estado, { conectado: false, error: 'Falta el token del bot' }); return publico(); }
    try {
      estado.bot = await api('GET', '/users/@me');
      if (config.guildId) {
        const g = await api('GET', `/guilds/${config.guildId}`);
        estado.servidor = { id: g.id, nombre: g.name };
        const roles = await api('GET', `/guilds/${config.guildId}/roles`);
        const yo = await api('GET', `/guilds/${config.guildId}/members/${estado.bot.id}`);
        estado.posicionBot = Math.max(0, ...roles.filter((r) => yo.roles.includes(r.id)).map((r) => r.position));
        estado.rolesServidor = roles.filter((r) => r.id !== g.id && !r.managed).sort((a, b) => b.position - a.position)
          .map((r) => ({ id: r.id, nombre: r.name, color: r.color, puede: r.position < estado.posicionBot }));
      }
      Object.assign(estado, { conectado: !!(estado.bot && estado.servidor), error: config.guildId ? '' : 'Falta el ID de tu servidor' });
    } catch (e) { Object.assign(estado, { conectado: false, error: e.message }); }
    return publico();
  }

  // ---------- Vincular personas ----------
  const claveNombre = (n) => 'n:' + String(n || '').trim().toLowerCase();
  async function buscarMiembro(texto) {
    const q = String(texto || '').trim().replace(/^@/, '').replace(/#\d{4}$/, '');
    if (!q) throw new Error('Escribe el usuario de Discord');
    if (/^\d{17,20}$/.test(q)) { const m = await api('GET', `/guilds/${config.guildId}/members/${q}`); return [m]; }
    const lista = await api('GET', `/guilds/${config.guildId}/members/search?query=${encodeURIComponent(q)}&limit=10`);
    const exactos = lista.filter((m) => [m.user.username, m.user.global_name, m.nick].some((n) => n && n.toLowerCase() === q.toLowerCase()));
    return exactos.length ? exactos : lista;
  }
  const nombreMiembro = (m) => m.nick || m.user.global_name || m.user.username;
  function vincular(nombre, miembro, via) {
    const usado = Object.entries(config.vinculos).find(([k, v]) => v.id === miembro.user.id && k !== claveNombre(nombre));
    if (usado && via === 'chat') throw new Error(`esa cuenta de Discord ya está vinculada a ${usado[1].de || 'otra persona'}`);
    config.vinculos[claveNombre(nombre)] = { id: miembro.user.id, usuario: miembro.user.username, mostrar: nombreMiembro(miembro), de: nombre, via, at: Date.now() };
    save();
    anotar(`🔗 ${nombre} vinculado con ${miembro.user.username}${via === 'chat' ? ' (desde el chat)' : ''}`);
    pedirSync();
  }
  function desvincular(clave) {
    const v = config.vinculos[clave];
    if (!v) return;
    delete config.vinculos[clave];
    save();
    anotar(`Se quitó el vínculo de ${v.de || clave}`);
    pedirSync();
  }

  // !discord usuario  (en el chat de Twitch). Sin usuario no hace nada (por si ya tienes un !discord con la invitación)
  async function alChat(e, responder) {
    if (!config.on || !token() || !config.guildId) return;
    const texto = String(e.message?.text || '').trim();
    const m = texto.match(new RegExp(`^!${config.comando.replace(/[^\w.-]/g, '')}\\s+(\\S.*)$`, 'i'));
    if (!m) return;
    const quien = e.chatter_user_name || e.chatter_user_login;
    try {
      const encontrados = await buscarMiembro(m[1]);
      if (!encontrados.length) return responder(`@${quien} no te encuentro en el servidor de Discord${config.invitacion ? `. Entra primero: ${config.invitacion}` : ''} y vuelve a escribir !${config.comando} tu_usuario`);
      if (encontrados.length > 1) return responder(`@${quien} hay varias personas que coinciden en Discord (${encontrados.slice(0, 3).map((x) => x.user.username).join(', ')}…). Escribe tu usuario exacto.`);
      vincular(quien, encontrados[0], 'chat');
      responder(`@${quien} ✅ Vinculado con Discord (${encontrados[0].user.username}). Tus rangos se actualizan solos.`);
    } catch (err) { responder(`@${quien} no pude vincularte: ${err.message}`); }
  }

  // ---------- Quién debe tener cada rango este mes ----------
  function deseados() {
    const quiere = new Map(); // id del rol → Map(id del usuario → motivo)
    const dar = (rango, idUsuario, motivo) => { const rol = config.roles[rango]; if (!rol || !idUsuario) return; if (!quiere.has(rol)) quiere.set(rol, new Map()); quiere.get(rol).set(idUsuario, motivo); };
    const vinculoDe = (nombre, pks = []) => config.vinculos[claveNombre(nombre)] || pks.map((p) => config.vinculos['mp:' + p]).find(Boolean);
    for (const p of podio.personasDelMes()) {
      const v = vinculoDe(p.nombre, p.pks); if (!v) continue;
      if (p.dinero > 0 && p.dinero >= (Number(config.minDonacionUsd) || 0)) dar('donador', v.id, `donó $${p.dinero} USD`);
      if (p.regaladas > 0) dar('regalador', v.id, `regaló ${p.regaladas} subs`);
      if (p.bits > 0) dar('bits', v.id, `dio ${p.bits} bits`);
      if (p.subs > 0) dar('suscriptor', v.id, 'se suscribió');
    }
    const reyes = podio.reyesActuales();
    for (const [cat, rango] of [['dinero', 'topDinero'], ['subs', 'topSubs'], ['bits', 'topBits']]) {
      const rey = reyes[cat]?.[0]; const v = rey && vinculoDe(rey.name); if (v) dar(rango, v.id, 'rey del mes');
    }
    return quiere;
  }

  // Da los que faltan y quita los que puso el reloj y ya no corresponden (por ejemplo, al cambiar el mes)
  let sincronizando = false, timerSync = null;
  async function sincronizar() {
    if (!config.on || !token() || !config.guildId || sincronizando) return publico();
    sincronizando = true;
    try {
      const quiere = deseados(), mes = podio.mesActual();
      const roles = new Set([...quiere.keys(), ...Object.keys(config.otorgados)]);
      for (const rol of roles) {
        const tienen = config.otorgados[rol] ||= {}, deben = quiere.get(rol) || new Map();
        const nombreRol = estado.rolesServidor.find((r) => r.id === rol)?.nombre || 'rol';
        for (const [id, motivo] of deben) {
          if (tienen[id]) { tienen[id] = mes; continue; }
          try { await api('PUT', `/guilds/${config.guildId}/members/${id}/roles/${rol}`, null, `Reloj Subatón: ${motivo}`); tienen[id] = mes; anotar(`➕ ${nombreDe(id)} recibió "${nombreRol}" (${motivo})`); }
          catch (e) { if (e.code === 10007) continue; anotar(`⚠️ No se pudo dar "${nombreRol}" a ${nombreDe(id)}: ${e.message}`); }
        }
        for (const id of Object.keys(tienen)) {
          if (deben.has(id)) continue;
          try { await api('DELETE', `/guilds/${config.guildId}/members/${id}/roles/${rol}`, null, 'Reloj Subatón: el rango es mensual'); anotar(`➖ ${nombreDe(id)} ya no tiene "${nombreRol}" (es mensual)`); delete tienen[id]; }
          catch (e) { if (e.code === 10007 || e.status === 404) delete tienen[id]; else anotar(`⚠️ No se pudo quitar "${nombreRol}" a ${nombreDe(id)}: ${e.message}`); }
        }
        if (!Object.keys(tienen).length) delete config.otorgados[rol];
      }
      estado.ultimaSync = Date.now(); estado.error = '';
      save();
    } catch (e) { estado.error = e.message; }
    finally { sincronizando = false; }
    return publico();
  }
  const nombreDe = (id) => Object.values(config.vinculos).find((v) => v.id === id)?.mostrar || id;
  function pedirSync(ms = 8000) { clearTimeout(timerSync); timerSync = setTimeout(() => sincronizar().catch(() => {}), ms); }

  function iniciar() {
    if (config.on && token()) probar().then(() => pedirSync(3000));
    setInterval(() => { if (config.on && token()) probar().then(() => sincronizar()).catch(() => {}); }, 10 * 60000); // y cada 10 min (cambio de mes incluido)
  }

  async function setConfig(b = {}) {
    if (b.token) secreto().token = String(b.token).trim(), store.save();
    if (b.quitarToken) { secreto().token = ''; store.save(); }
    if ('guildId' in b) config.guildId = String(b.guildId || '').replace(/\D/g, '').slice(0, 20);
    if ('on' in b) config.on = !!b.on;
    if (b.roles && typeof b.roles === 'object') for (const k of Object.keys(RANGOS)) if (k in b.roles) config.roles[k] = String(b.roles[k] || '').replace(/\D/g, '');
    if ('minDonacionUsd' in b) config.minDonacionUsd = Math.max(0, Number(b.minDonacionUsd) || 0);
    if ('comando' in b) config.comando = String(b.comando || 'discord').replace(/^!/, '').replace(/[^\w.-]/g, '').slice(0, 20) || 'discord';
    if ('invitacion' in b) config.invitacion = String(b.invitacion || '').trim().slice(0, 100);
    save();
    if (b.token || 'guildId' in b || b.probar) await probar();
    pedirSync(1500);
    return publico();
  }

  function publico() {
    return {
      config: { ...config, otorgados: undefined }, rangos: RANGOS, tieneToken: !!token(),
      estado: { ...estado, cambios: estado.cambios.slice(0, 20) },
      invitarBot: estado.bot ? `https://discord.com/oauth2/authorize?client_id=${estado.bot.id}&scope=bot&permissions=${MANAGE_ROLES}` : '',
      otorgados: Object.fromEntries(Object.entries(config.otorgados).map(([rol, u]) => [rol, Object.keys(u).map(nombreDe)])),
      deseados: Object.fromEntries([...deseados()].map(([rol, m]) => [rol, [...m.keys()].map(nombreDe)])),
      personas: podio.personasDelMes().map((p) => ({ nombre: p.nombre, vinculo: config.vinculos[claveNombre(p.nombre)] || p.pks.map((k) => config.vinculos['mp:' + k]).find(Boolean) || null })),
    };
  }

  async function vincularDesdePanel(nombre, usuario) {
    if (!nombre) throw new Error('Falta el nombre (como aparece en el podio o su usuario de Twitch)');
    const encontrados = await buscarMiembro(usuario);
    if (!encontrados.length) throw new Error(`No encuentro a "${usuario}" en el servidor`);
    if (encontrados.length > 1) throw new Error(`Hay varias coincidencias: ${encontrados.slice(0, 5).map((x) => x.user.username).join(', ')}. Escribe el usuario exacto.`);
    vincular(nombre, encontrados[0], 'panel');
    return publico();
  }

  return { iniciar, probar, sincronizar, setConfig, publico, alChat, vincularDesdePanel, desvincular, pedirSync, save, comando: () => config.comando };
}

module.exports = { crearDiscord, RANGOS };

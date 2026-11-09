// Multichat: junta en un solo lugar el chat de Twitch, Kick, YouTube y TikTok.
// Es para el streamer (no sale en el stream): cada mensaje llega con su plataforma a la página /multichat
// en vivo por /events (tipo "multichat"). Se configura en /multichat-panel → data/multichat.json.
//   • Twitch: usa la conexión que el reloj ya tiene.
//   • Kick: chat público por WebSocket (Pusher), solo con el nombre del canal.
//   • YouTube: el chat del directo, sin clave de API (lo mismo que usa la página de YouTube).
//   • TikTok: TikTok no tiene una forma oficial; se usa Euler Stream (pide una clave gratis en eulerstream.com).
const fs = require('fs');
const path = require('path');
const apartarDanado = require('./danado');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'multichat.json');
const KICK_WS = process.env.KICK_WS || 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false';
const KICK_API = process.env.KICK_API || 'https://kick.com';
const YT = process.env.YT_BASE || 'https://www.youtube.com';
const TIKTOK_WS = process.env.TIKTOK_WS || 'wss://ws.eulerstream.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const PLATAFORMAS = ['twitch', 'kick', 'youtube', 'tiktok'];

const DEFAULTS = {
  twitch: { on: true },
  kick: { on: false, canal: '', chatroomId: '' },
  youtube: { on: false, canal: '' },
  tiktok: { on: false, usuario: '', apiKey: '', regalos: true },
  ocultarComandos: true,                      // no mostrar mensajes que empiezan con !
  ocultar: ['nightbot', 'streamelements', 'moobot', 'fossabot', 'botrix', 'kickbot'], // bots que no se muestran
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const txt = (v, max = 120) => String(v ?? '').trim().slice(0, max);
let config = clone(DEFAULTS);
try {
  const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  config = { ...clone(DEFAULTS), ...j };
  delete config.overlay;
  for (const p of PLATAFORMAS) config[p] = { ...DEFAULTS[p], ...(j[p] || {}) };
} catch (err) {
  if (err.code !== 'ENOENT') console.error('[Multichat] No se pudo leer', FILE, '-', err.message);
  apartarDanado(FILE, err);
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(config, null, 2));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (err) { console.error('[Multichat] No se pudo guardar:', err.message); }
}

// ---------- Mensajes ----------
let emitir = () => {};
const ultimos = [];             // los últimos 150, para cuando se abre una página
const vistos = new Set();
const estado = Object.fromEntries(PLATAFORMAS.map((p) => [p, { estado: 'apagado', detalle: '' }]));
function setEstado(p, e, detalle = '') {
  if (estado[p].estado === e && estado[p].detalle === detalle) return;
  estado[p] = { estado: e, detalle, at: Date.now() };
  emitir('multichat', { estado: publicEstado() });
}
// color fijo por nombre para quien no tiene uno (YouTube, TikTok)
const PALETA = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#da77f2', '#f783ac', '#a9e34b'];
const colorDe = (n) => { let h = 0; for (const c of String(n)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETA[h % PALETA.length]; };

// m: { id, plataforma, autor, color, partes:[{t:'texto',v}|{t:'emote',v,url}], tipo, extra, rol }
function publicar(m) {
  if (!m || !m.id || vistos.has(m.plataforma + m.id)) return;
  vistos.add(m.plataforma + m.id); if (vistos.size > 3000) vistos.delete(vistos.values().next().value);
  const plano = m.partes.map((p) => p.v).join('').trim();
  if (m.tipo === 'mensaje' && !plano) return;
  if (config.ocultarComandos && m.tipo === 'mensaje' && plano.startsWith('!')) return;
  if (config.ocultar.includes(String(m.autor).toLowerCase().replace(/^@/, ''))) return;
  const msg = { ...m, color: m.color || colorDe(m.autor), at: m.at || Date.now() };
  ultimos.push(msg); if (ultimos.length > 150) ultimos.shift();
  emitir('multichat', { mensaje: msg });
}

// ---------- Twitch (llega desde la conexión del reloj) ----------
function deTwitch(e) {
  if (!config.twitch.on || !e) return;
  const partes = (e.message?.fragments || [{ type: 'text', text: e.message?.text || '' }]).map((f) =>
    f.type === 'emote' && f.emote?.id ? { t: 'emote', v: f.text, url: `https://static-cdn.jtvnw.net/emoticons/v2/${f.emote.id}/default/dark/2.0` } : { t: 'texto', v: f.text || '' });
  const insignias = new Set((e.badges || []).map((b) => b.set_id));
  publicar({ id: e.message_id, plataforma: 'twitch', autor: e.chatter_user_name || e.chatter_user_login, color: e.color || '', partes, tipo: 'mensaje',
    rol: insignias.has('broadcaster') ? 'dueño' : insignias.has('moderator') || insignias.has('lead_moderator') ? 'mod' : insignias.has('vip') ? 'vip' : insignias.has('subscriber') ? 'sub' : '' });
}

// ---------- Kick (Pusher) ----------
const kick = { ws: null, timer: null, ping: null, intento: 0, gen: 0 };
const canalKick = (v) => String(v || '').trim().replace(/^(https?:\/\/)?([\w-]+\.)?kick\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0].toLowerCase();
async function chatroomKick(slug) {
  const r = await fetch(`${KICK_API}/api/v2/channels/${encodeURIComponent(slug)}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (r.status === 404) throw new Error(`No existe el canal "${slug}" en Kick`);
  if (!r.ok) throw new Error(`Kick no dejó leer el canal (${r.status})`);
  const j = await r.json();
  if (!j?.chatroom?.id) throw new Error('Kick no devolvió el número del chat');
  return String(j.chatroom.id);
}
function pararKick() { kick.gen++; clearTimeout(kick.timer); clearInterval(kick.ping); try { kick.ws?.close(); } catch {} kick.ws = null; }
async function conectarKick() {
  pararKick();
  const gen = kick.gen, c = config.kick, slug = canalKick(c.canal);
  if (!c.on || !slug) return setEstado('kick', 'apagado', c.on ? 'Falta el nombre del canal' : '');
  setEstado('kick', 'conectando', slug);
  let id = String(c.chatroomId || '').trim();
  if (!id || c.chatroomDe !== slug) {
    try { id = await chatroomKick(slug); } catch (e) {
      if (gen !== kick.gen) return; // mientras buscaba se apagó o cambió el canal
      setEstado('kick', 'error', `${e.message}. Abre kick.com/api/v2/channels/${slug} en el navegador, busca "chatroom":{"id": y pega ese número en el panel.`);
      return reintentarKick();
    }
    if (gen !== kick.gen) return;
    c.chatroomId = id; c.chatroomDe = slug; save();
  }
  const ws = new WebSocket(KICK_WS);
  kick.ws = ws;
  ws.onmessage = (ev) => {
    let j; try { j = JSON.parse(ev.data); } catch { return; }
    if (j.event === 'pusher:connection_established') {
      ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${id}.v2` } }));
      clearInterval(kick.ping); kick.ping = setInterval(() => { try { ws.send(JSON.stringify({ event: 'pusher:ping', data: {} })); } catch {} }, 60000);
    } else if (j.event === 'pusher:ping') ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
    else if (j.event === 'pusher_internal:subscription_succeeded') { kick.intento = 0; setEstado('kick', 'conectado', slug); }
    else if (j.event === 'App\\Events\\ChatMessageEvent') {
      let d; try { d = typeof j.data === 'string' ? JSON.parse(j.data) : j.data; } catch { return; }
      const s = d.sender || {}, badges = (s.identity?.badges || []).map((b) => b.type);
      publicar({ id: d.id, plataforma: 'kick', autor: s.username || 'alguien', color: s.identity?.color || '', partes: partesKick(d.content), tipo: 'mensaje',
        rol: badges.includes('broadcaster') ? 'dueño' : badges.includes('moderator') ? 'mod' : badges.includes('vip') ? 'vip' : badges.includes('subscriber') ? 'sub' : '' });
    }
  };
  ws.onclose = () => { if (kick.ws === ws) { setEstado('kick', 'conectando', 'Se cortó, reconectando…'); reintentarKick(); } };
  ws.onerror = () => {};
}
// "[emote:37226:KEKW]" → imagen
function partesKick(texto) {
  const out = []; let i = 0; const re = /\[emote:(\d+):([^\]]*)\]/g; let m;
  texto = String(texto || '');
  while ((m = re.exec(texto))) { if (m.index > i) out.push({ t: 'texto', v: texto.slice(i, m.index) }); out.push({ t: 'emote', v: m[2], url: `https://files.kick.com/emotes/${m[1]}/fullsize` }); i = re.lastIndex; }
  if (i < texto.length) out.push({ t: 'texto', v: texto.slice(i) });
  return out;
}
function reintentarKick() { clearTimeout(kick.timer); const s = Math.min(60, 5 * 2 ** kick.intento++); kick.timer = setTimeout(conectarKick, s * 1000); }

// ---------- YouTube (chat del directo, sin clave) ----------
const yt = { timer: null, gen: 0, cont: '', key: '', version: '' };
const HDR_YT = { 'User-Agent': UA, 'Accept-Language': 'es-419,es;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' };
function urlYouTube(v) {
  v = String(v || '').trim();
  const vid = v.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/)([\w-]{11})/);
  if (vid) return { video: vid[1] };
  const h = v.replace(/^(https?:\/\/)?([\w-]+\.)?youtube\.com\//i, '').replace(/\/(live|streams|featured)?\/?$/, '');
  if (!h) return null;
  return { canal: h.startsWith('@') || h.startsWith('channel/') || h.startsWith('c/') ? h : '@' + h };
}
const sacar = (html, re) => (html.match(re) || [])[1] || '';
async function buscarDirectoYT(c) {
  if (c.video) return c.video;
  const r = await fetch(`${YT}/${c.canal}/live`, { headers: HDR_YT, signal: AbortSignal.timeout(15000) });
  if (r.status === 404) throw new Error('No encuentro ese canal de YouTube');
  const html = await r.text();
  const id = sacar(html, /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/) || sacar(html, /"videoDetails":\{"videoId":"([\w-]{11})"/);
  if (!id || !/"isLive(?:Now|Content)?":true/.test(html)) return null; // no está en vivo
  return id;
}
async function empezarChatYT(video) {
  const r = await fetch(`${YT}/live_chat?is_popout=1&v=${video}`, { headers: HDR_YT, signal: AbortSignal.timeout(15000) });
  const html = await r.text();
  yt.key = sacar(html, /"INNERTUBE_API_KEY":"([^"]+)"/);
  yt.version = sacar(html, /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || '2.20261001.00.00';
  yt.cont = sacar(html, /"continuation":"([^"]+)"/);
  if (!yt.cont) throw new Error('Ese directo no tiene el chat abierto');
}
function pararYT() { clearTimeout(yt.timer); yt.gen++; }
async function conectarYT() {
  pararYT();
  const gen = yt.gen, c = config.youtube, dir = urlYouTube(c.canal);
  if (!c.on || !dir) return setEstado('youtube', 'apagado', c.on ? 'Falta el canal o el enlace del directo' : '');
  setEstado('youtube', 'conectando', 'Buscando el directo…');
  try {
    const video = await buscarDirectoYT(dir);
    if (gen !== yt.gen) return;
    if (!video) { setEstado('youtube', 'esperando', 'El canal no está en vivo: se revisa cada minuto'); yt.timer = setTimeout(conectarYT, 60000); return; }
    await empezarChatYT(video);
    if (gen !== yt.gen) return;
    setEstado('youtube', 'conectado', dir.canal || video);
    leerYT(gen, true);
  } catch (e) {
    if (gen !== yt.gen) return;
    setEstado('youtube', 'error', e.message);
    yt.timer = setTimeout(conectarYT, 60000);
  }
}
async function leerYT(gen, primera = false) {
  try {
    const r = await fetch(`${YT}/youtubei/v1/live_chat/get_live_chat?prettyPrint=false${yt.key ? '&key=' + yt.key : ''}`, {
      method: 'POST', headers: { ...HDR_YT, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: yt.version, hl: 'es' } }, continuation: yt.cont }),
    });
    if (gen !== yt.gen) return;
    if (!r.ok) throw new Error('YouTube respondió ' + r.status);
    const j = await r.json();
    if (gen !== yt.gen) return;
    const lc = j.continuationContents?.liveChatContinuation;
    if (!lc) { setEstado('youtube', 'esperando', 'Terminó el directo: se revisa cada minuto'); yt.timer = setTimeout(conectarYT, 60000); return; }
    const sig = lc.continuations?.[0] || {};
    const datos = sig.invalidationContinuationData || sig.timedContinuationData || sig.reloadContinuationData || {};
    if (datos.continuation) yt.cont = datos.continuation;
    if (!primera) for (const a of lc.actions || []) mensajeYT(a.addChatItemAction?.item);
    yt.timer = setTimeout(() => leerYT(gen), Math.min(Math.max(Number(datos.timeoutMs) || 3000, 1500), 8000));
  } catch (e) {
    if (gen !== yt.gen) return;
    setEstado('youtube', 'error', e.message);
    yt.timer = setTimeout(conectarYT, 20000);
  }
}
const textoYT = (t) => t?.simpleText || (t?.runs || []).map((r) => r.text).join('') || '';
function partesYT(runs = []) {
  return runs.map((r) => {
    if (r.text != null) return { t: 'texto', v: r.text };
    const e = r.emoji || {};
    if (!e.isCustomEmoji && e.emojiId && !/^UC/.test(e.emojiId)) return { t: 'texto', v: e.emojiId };
    const img = e.image?.thumbnails?.slice(-1)[0]?.url;
    return img ? { t: 'emote', v: e.shortcuts?.[0] || '', url: img } : { t: 'texto', v: e.shortcuts?.[0] || '' };
  });
}
function mensajeYT(item) {
  if (!item) return;
  const m = item.liveChatTextMessageRenderer || item.liveChatPaidMessageRenderer || item.liveChatMembershipItemRenderer || item.liveChatPaidStickerRenderer;
  if (!m) return;
  const insignias = (m.authorBadges || []).map((b) => b.liveChatAuthorBadgeRenderer?.icon?.iconType || (b.liveChatAuthorBadgeRenderer?.customThumbnail ? 'MEMBER' : ''));
  const base = { id: m.id, plataforma: 'youtube', autor: textoYT(m.authorName).replace(/^@/, '') || 'alguien', color: '', at: Number(m.timestampUsec) / 1000 || Date.now(),
    rol: insignias.includes('OWNER') ? 'dueño' : insignias.includes('MODERATOR') ? 'mod' : insignias.includes('MEMBER') ? 'sub' : '' };
  if (item.liveChatTextMessageRenderer) return publicar({ ...base, partes: partesYT(m.message?.runs), tipo: 'mensaje' });
  if (item.liveChatPaidMessageRenderer || item.liveChatPaidStickerRenderer) return publicar({ ...base, partes: partesYT(m.message?.runs), tipo: 'superchat', extra: textoYT(m.purchaseAmountText) });
  publicar({ ...base, partes: m.message ? partesYT(m.message.runs) : [], tipo: 'miembro', extra: textoYT(m.headerSubtext) || 'Nuevo miembro' });
}

// ---------- TikTok (Euler Stream) ----------
const tt = { ws: null, timer: null, intento: 0 };
const usuarioTT = (v) => String(v || '').trim().replace(/^(https?:\/\/)?([\w-]+\.)?tiktok\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
function pararTT() { clearTimeout(tt.timer); try { tt.ws?.close(); } catch {} tt.ws = null; }
function conectarTT() {
  pararTT();
  const c = config.tiktok, u = usuarioTT(c.usuario);
  if (!c.on || !u) return setEstado('tiktok', 'apagado', c.on ? 'Falta tu usuario de TikTok' : '');
  if (!c.apiKey) return setEstado('tiktok', 'error', 'Falta la clave de Euler Stream (es gratis en eulerstream.com)');
  setEstado('tiktok', 'conectando', '@' + u);
  const ws = new WebSocket(`${TIKTOK_WS}?uniqueId=${encodeURIComponent(u)}&apiKey=${encodeURIComponent(c.apiKey)}`);
  tt.ws = ws;
  ws.onopen = () => { tt.intento = 0; setEstado('tiktok', 'conectado', '@' + u); };
  ws.onmessage = (ev) => {
    let j; try { j = JSON.parse(ev.data); } catch { return; }
    for (const m of j.messages || [j]) mensajeTT(m);
  };
  ws.onclose = (ev) => {
    if (tt.ws !== ws) return;
    const motivo = String(ev.reason || '');
    const offline = /offline|not.?live|no.*live|4404/i.test(motivo) || ev.code === 4404;
    const malaClave = /key|auth|unauthori|4401|4403/i.test(motivo) || ev.code === 4401 || ev.code === 4403;
    setEstado('tiktok', malaClave ? 'error' : 'esperando', malaClave ? 'Euler Stream rechazó la clave: revísala en el panel' : offline ? 'No estás en vivo en TikTok: se revisa cada minuto' : `Se cortó${motivo ? ' (' + motivo + ')' : ''}: reconectando…`);
    tt.timer = setTimeout(conectarTT, malaClave ? 10 * 60000 : offline ? 60000 : Math.min(60, 5 * 2 ** tt.intento++) * 1000);
  };
  ws.onerror = () => {};
}
function mensajeTT(m) {
  const tipo = m.type || m.event, d = m.data || m;
  const u = d.user || {};
  const autor = u.nickname || u.uniqueId || 'alguien';
  const id = d.msgId || d.common?.msgId || d.id || `${u.uniqueId}-${Date.now()}-${Math.random()}`;
  if (tipo === 'chat' && d.comment) publicar({ id: String(id), plataforma: 'tiktok', autor, color: '', partes: [{ t: 'texto', v: d.comment }], tipo: 'mensaje',
    rol: u.isModerator ? 'mod' : u.isSubscriber ? 'sub' : '' });
  else if (tipo === 'gift' && config.tiktok.regalos) {
    const g = d.gift || {}, rep = Number(d.repeatCount || g.repeatCount || 1);
    if ((g.giftType === 1 || d.giftType === 1) && d.repeatEnd === false) return; // racha en curso: se muestra al terminar
    publicar({ id: String(id), plataforma: 'tiktok', autor, color: '', partes: [], tipo: 'regalo', extra: `🎁 ${d.giftName || g.name || 'regalo'}${rep > 1 ? ' x' + rep : ''}` });
  }
}

// ---------- Arranque y configuración ----------
function iniciar(fnEmitir) {
  emitir = fnEmitir;
  setEstado('twitch', config.twitch.on ? 'conectado' : 'apagado');
  conectarKick(); conectarYT(); conectarTT();
}
function estadoTwitch(chatOk) { setEstado('twitch', !config.twitch.on ? 'apagado' : chatOk ? 'conectado' : 'error', !config.twitch.on ? '' : chatOk ? '' : 'Conecta Twitch en Configuración (con permiso de chat)'); }

function setConfig(b = {}) {
  const antes = clone(config);
  for (const p of PLATAFORMAS) if (b[p] && 'on' in b[p]) config[p].on = !!b[p].on;
  if (b.kick) {
    if ('canal' in b.kick) config.kick.canal = canalKick(b.kick.canal);
    if ('chatroomId' in b.kick) { config.kick.chatroomId = String(b.kick.chatroomId || '').replace(/\D/g, '').slice(0, 15); config.kick.chatroomDe = config.kick.chatroomId ? config.kick.canal : ''; }
  }
  if (b.youtube && 'canal' in b.youtube) config.youtube.canal = txt(b.youtube.canal, 200);
  if (b.tiktok) {
    if ('usuario' in b.tiktok) config.tiktok.usuario = usuarioTT(b.tiktok.usuario);
    if (b.tiktok.apiKey) config.tiktok.apiKey = txt(b.tiktok.apiKey, 200);
    if ('regalos' in b.tiktok) config.tiktok.regalos = !!b.tiktok.regalos;
  }
  if ('ocultarComandos' in b) config.ocultarComandos = !!b.ocultarComandos;
  if ('ocultar' in b) config.ocultar = (Array.isArray(b.ocultar) ? b.ocultar : String(b.ocultar).split(/[\s,]+/)).map((u) => String(u).replace(/^@/, '').trim().toLowerCase()).filter(Boolean).slice(0, 50);
  save();
  const cambio = (p, ...k) => k.some((x) => JSON.stringify(antes[p][x]) !== JSON.stringify(config[p][x]));
  if (cambio('kick', 'on', 'canal', 'chatroomId')) { kick.intento = 0; conectarKick(); }
  if (cambio('youtube', 'on', 'canal')) conectarYT();
  if (cambio('tiktok', 'on', 'usuario', 'apiKey')) { tt.intento = 0; conectarTT(); }
  if (cambio('twitch', 'on')) setEstado('twitch', config.twitch.on ? 'conectado' : 'apagado');
  emitir('multichat', { config: publicConfig() });
  return publicData();
}
function reconectar(p) {
  if (p === 'kick') { kick.intento = 0; conectarKick(); }
  else if (p === 'youtube') conectarYT();
  else if (p === 'tiktok') { tt.intento = 0; conectarTT(); }
  return publicData();
}
// Mensaje de prueba (para ver cómo se ve sin estar en vivo)
const PRUEBAS = { twitch: ['nephallems', '¡Vamos con todo! PogChamp'], kick: ['Fevuer', 'saludos desde kick 💚'], youtube: ['Cuervo_88', 'llegué tarde, ¿qué me perdí?'], tiktok: ['tussi.oficial', 'holaaa 🔥🔥'] };
function probar(p) {
  const [autor, texto] = PRUEBAS[p] || PRUEBAS.twitch;
  publicar({ id: 'prueba-' + Date.now() + Math.random(), plataforma: PRUEBAS[p] ? p : 'twitch', autor, color: '', partes: [{ t: 'texto', v: texto }], tipo: 'mensaje', rol: '' });
  return { ok: true };
}

const publicEstado = () => clone(estado);
// sin la clave de TikTok
function publicConfig() { const c = clone(config); c.tiktok.tieneClave = !!c.tiktok.apiKey; delete c.tiktok.apiKey; return c; }
const publicData = () => ({ config: publicConfig(), estado: publicEstado(), mensajes: ultimos.slice(-100) });
function parar() { pararKick(); pararYT(); pararTT(); }

module.exports = { iniciar, deTwitch, estadoTwitch, setConfig, reconectar, probar, publicData, parar, save, _test: { partesKick, urlYouTube, mensajeYT, mensajeTT } };

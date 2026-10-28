// Reloj de Subatón — servidor principal
//   Panel:    http://localhost:3000/panel
//   Overlay:  http://localhost:3000/overlay   (fuente de navegador en OBS)
//   Webhooks: puerto 3001 (solo esto se expone a internet con el túnel)
const logger = require('./src/logger');
logger.install();
// Antes de cargar los datos: si falta un archivo o está dañado, se recupera de la última copia de seguridad
const respaldo = require('./src/respaldo');
const RECUPERADOS = respaldo.alInicio();
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { exec, spawn } = require('child_process');

const store = require('./src/store');
const { Timer } = require('./src/timer');
const { createEngine, SOURCES } = require('./src/engine');
const { TwitchClient } = require('./src/twitch');
const { MercadoPagoClient } = require('./src/mercadopago');
const { StreamElementsClient } = require('./src/streamelements');
const paypal = require('./src/paypal');
const { createCommands } = require('./src/commands');
const automensajes = require('./src/automensajes');
const { createApp, createLive } = require('./src/http');
const { createAuth } = require('./src/auth');
const { createPodio } = require('./src/podio');
const { fmtDuration, LABELS } = require('./src/engine');

if (typeof WebSocket === 'undefined') {
  console.error('\n  ❌ Necesitas Node.js 22 o más nuevo. Descárgalo en https://nodejs.org (versión LTS)\n');
  process.exit(1);
}

const PORT = Number(process.env.PORT || 3000);
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT || 3001);
const d = store.data;
const auth = createAuth(store);
// Acceso remoto: solo se abre a la red si está activado Y hay contraseña
const REMOTE = !!(d.settings.remoteAccess && auth.hasAnyLogin());
const HOST = process.env.HOST || (REMOTE ? '0.0.0.0' : '127.0.0.1');
const HOOKS_HOST = process.env.HOST || '127.0.0.1';

// ---------- Tiempo real ----------
const live = createLive();
const broadcast = (type, payload) => {
  if (type === 'log') {
    trackSession(payload);
    clearImmediate(broadcast.stateSoon);
    broadcast.stateSoon = setImmediate(() => live.broadcast('state', stateMsg())); // actualiza "últimos aportes" y total del overlay
  }
  live.broadcast(type, payload);
};

// Resumen de lo que entró durante el stream actual (se escribe en el log al terminar)
let session = null;
function newSession() {
  session = { start: Date.now(), bySource: {}, manual: 0 };
}
function trackSession(e) {
  if (!session) newSession();
  if (e.test) return;
  if (e.source === 'manual') session.manual += e.seconds || 0;
  else {
    const s = (session.bySource[e.source] ||= { count: 0, amount: 0, seconds: 0 });
    s.count += e.source === 'subs' ? e.count || 1 : 1;
    if (e.source !== 'subs') s.amount = Math.round((s.amount + (Number(e.amount) || 0)) * 100) / 100;
    s.seconds += e.seconds || 0;
  }
}
function sessionSummary() {
  if (!session) newSession();
  const lines = [`Duración: ${fmtDuration((Date.now() - session.start) / 1000)}`];
  for (const [src, s] of Object.entries(session.bySource)) {
    const what = src === 'subs' ? `${s.count} subs` : src === 'bits' ? `${s.amount} bits` : `${s.count} donaciones · ${s.amount} ${d.rates[src]?.currency || ''}`;
    lines.push(`${LABELS[src]}: ${what} → +${fmtDuration(s.seconds)}`);
  }
  if (session.manual) lines.push(`Ajustes manuales/mods: ${session.manual >= 0 ? '+' : '-'}${fmtDuration(session.manual)}`);
  lines.push(`Tiempo restante guardado: ${fmtDuration(timer.remainingMs / 1000)}`);
  return lines;
}

// ---------- Reloj ----------
const wasRunning = d.timer.running;
const timer = new Timer(d.timer.remainingMs);
const engine = createEngine({ store, timer, broadcast });

function persistTimer() {
  d.timer = { remainingMs: timer.remainingMs, running: timer.running };
  store.save();
}
const stream = { live: null, since: null }; // null = todavía no se sabe (Twitch sin conectar)
// Lo que necesita el overlay (sin montos de dinero: el overlay es público)
function recentForOverlay() {
  return d.log.filter((e) => e.source !== 'manual' && e.seconds > 0).slice(0, 3).map((e) => ({ user: e.user || 'Alguien', seconds: e.seconds, source: e.source }));
}
const addedThisStream = () => Object.values(session?.bySource || {}).reduce((a, s) => a + (s.seconds || 0), 0);
// ---------- Sonidos ----------
const SOUNDS_DIR = path.join(__dirname, 'sonidos');
const SOUND_EXT = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
const SOUND_EVENTS = ['sub', 'bits', 'paypal', 'mercadopago', 'grande', 'multiplicador', 'final', 'fin', 'manual'];
let customSounds = {};
function scanSounds() {
  const fs = require('fs');
  try {
    fs.mkdirSync(SOUNDS_DIR, { recursive: true });
    const readme = path.join(SOUNDS_DIR, 'LEEME.txt');
    if (!fs.existsSync(readme)) fs.writeFileSync(readme, 'Pon aqui tus propios sonidos (mp3, wav, ogg o m4a) con estos nombres para reemplazar los que trae el reloj:\r\n\r\n' + SOUND_EVENTS.map((e) => `  ${e}.mp3`).join('\r\n') + '\r\n\r\nSi no hay archivo, se usa el sonido incluido.\r\n');
    const found = {};
    for (const f of fs.readdirSync(SOUNDS_DIR)) {
      const ext = path.extname(f).toLowerCase();
      const name = path.basename(f, path.extname(f)).toLowerCase();
      if (SOUND_EXT[ext] && SOUND_EVENTS.includes(name)) found[name] = f;
    }
    customSounds = found;
  } catch (err) {
    console.error('[Sonidos]', err.message);
  }
}
scanSounds();
setInterval(scanSounds, 30000);
const soundsMsg = () => ({ ...d.settings.sounds, custom: customSounds });

const stateMsg = () => ({
  ...timer.snapshot(),
  sounds: soundsMsg(),
  multiplier: engine.multiplierStatus(),
  stream,
  maxSeconds: Number(d.settings.maxSeconds) || 0,
  addedThisStream: addedThisStream(),
  recent: recentForOverlay(),
  descanso: !!d.settings.descanso,
});
timer.on('change', () => {
  // Si alguien inicia el reloj (panel, mods o !iniciar en el chat) se sale del descanso
  if (timer.running && d.settings.descanso) {
    d.settings.descanso = false;
    store.save();
    console.log('▶ Fin del descanso: se inició el reloj');
  }
  persistTimer();
  broadcast('state', stateMsg());
});
timer.on('ended', () => console.log('⏰ ¡El subatón terminó!'));
setInterval(() => timer.running && persistTimer(), 5000);

// Avisar cuando un multiplicador empieza o termina (programados / con duración)
let lastMult = '';
setInterval(() => {
  const m = JSON.stringify(engine.multiplierStatus());
  if (m !== lastMult) {
    lastMult = m;
    broadcast('state', stateMsg());
  }
}, 1000);
setInterval(() => broadcast('state', stateMsg()), 10000);

// ---------- Integraciones ----------
const podio = createPodio({ store });
// Cada aporte real (no las pruebas) también entra al podio del mes
const onContribution = (ev) => {
  const entry = engine.contribute(ev);
  try { podio.record(entry); } catch (err) { console.error('[Podio]', err.message); }
  // copia de seguridad apenas entra una donación, sub o bits (las pruebas no cuentan)
  if (entry && !entry.duplicate && !entry.test) respaldo.alAporte();
  // Aviso para el overlay de patitos (PayPal → verdes, Mercado Pago → amarillos), también en las pruebas
  if (entry && !entry.duplicate && (entry.source === 'paypal' || entry.source === 'mercadopago')) {
    let usd = null;
    try { usd = podio.toUsd(entry.amount, entry.currency); } catch {}
    broadcast('aporte', { id: entry.id, user: entry.user, usd: usd ?? 1, ...podio.patitosAporte(entry.source, usd ?? 1, entry.test) });
  }
  return entry;
};
const sendConnections = () => broadcast('connections', connectionsInfo());
const twitch = new TwitchClient({
  store,
  onContribution,
  onChat: (e) => { automensajes.alChat(e, autoCtx()); commands.handle(e).catch((err) => console.error('[Chat]', err.message)); },
  onStream: (isLive, initial) => onStream(isLive, initial),
  onStatus: sendConnections,
  onHype: (fase, e, desfase) => onHype(fase, e, desfase),
  redirectUri: `http://localhost:${PORT}/auth/twitch/callback`,
});
const mp = new MercadoPagoClient({ store, onContribution, onStatus: sendConnections });
const se = new StreamElementsClient({ store, onContribution, onStatus: sendConnections });
const ppStatus = { last: null, detail: '' };

// ---------- Stream en vivo / apagado ----------
function onStream(isLive, initial) {
  const was = stream.live;
  if (was === isLive) return;
  stream.live = isLive;
  stream.since = Date.now();
  const left = () => fmtDuration(timer.remainingMs / 1000);

  if (isLive) {
    if (!initial) {
      logger.close();
      logger.open('Stream en vivo');
    }
    newSession();
    console.log(initial ? '🔴 El stream ya estaba en vivo al abrir el reloj' : '🔴 ¡Stream en vivo!');
    try { if (podio.patitosStream(true)) broadcast('aporte', { vaciar: true }); } catch (err) { console.error('[Patitos]', err.message); }
    if (d.settings.descanso) {
      d.settings.descanso = false;
      store.save();
      console.log('▶ Fin del descanso: empezó el stream');
    }
    if (d.settings.autoResumeOnline && !timer.running && timer.remainingMs > 0) {
      timer.start();
      console.log(`▶ Reloj reanudado automáticamente (quedan ${left()})`);
    } else {
      console.log(`Reloj: ${timer.running ? 'corriendo' : 'en pausa'} · quedan ${left()}`);
    }
  } else if (initial) {
    console.log(`⚫ Stream apagado · el reloj espera al próximo stream con ${left()}`);
  } else {
    if (d.settings.autoPauseOffline && timer.running) {
      timer.pause();
      console.log(`⏸ Stream terminado: reloj pausado, quedan ${left()} guardados para el próximo stream`);
    } else {
      console.log(`⚫ Stream terminado · quedan ${left()}`);
    }
    sumarHorasDiarias('al terminar el stream');
    try { podio.patitosStream(false); } catch (err) { console.error('[Patitos]', err.message); }
    setTimeout(() => { try { podio.saveNow(); respaldo.respaldar('fin del stream', true); } catch (err) { console.error('[Respaldo]', err.message); } }, 2000);
    logger.close(['Resumen del stream:', ...sessionSummary()]);
    newSession();
    // Si el panel se cerró durante el stream, ahora sí se apaga
    if (panelSeen && d.settings.shutdownOnPanelClose && live.ownerCount() === 0) {
      clearTimeout(panelCloseTimer);
      panelCloseTimer = null;
      checkPanels();
    }
  }
  broadcast('state', stateMsg());
}

// Horas diarias automáticas: al cortar el stream se suman X horas al tiempo que quedó (aunque esté en 0)
const hoyLocal = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
function sumarHorasDiarias(motivo, forzar = false) {
  const h = d.settings.horasDiarias;
  if (!h || (!h.on && !forzar)) return null;
  const secs = Math.round(Number(h.seconds) || 0);
  if (secs <= 0) return null;
  if (!forzar && h.unaVezPorDia && h.ultimoDia === hoyLocal()) {
    console.log(`ℹ  Horas diarias: ya se sumaron hoy (${fmtDuration(secs)}), no se vuelven a sumar.`);
    return null;
  }
  const entry = engine.manualAdjust(secs, `Horas diarias automáticas (+${fmtDuration(secs)}) ${motivo}`);
  h.ultimoDia = hoyLocal();
  store.save();
  broadcast('config', { settings: d.settings, rates: d.rates });
  return entry;
}

function connectionsInfo() {
  const pp = d.secrets.paypal;
  return {
    twitch: twitch.info(),
    mercadopago: mp.info(),
    streamelements: se.info(),
    paypal: {
      webhookReady: !!(pp.clientId && pp.clientSecret && pp.webhookId),
      ipnReady: true,
      last: ppStatus.last,
      detail: ppStatus.detail,
    },
  };
}

function publicSecrets() {
  const s = d.secrets;
  return {
    twitch: { clientId: s.twitch.clientId, hasSecret: !!s.twitch.clientSecret },
    paypal: { mode: s.paypal.mode, clientId: s.paypal.clientId, hasSecret: !!s.paypal.clientSecret, webhookId: s.paypal.webhookId, receiverEmail: s.paypal.receiverEmail },
    mercadopago: { mode: s.mercadopago.mode, pollSeconds: s.mercadopago.pollSeconds, nombre: s.mercadopago.nombre || 'inicial', hasToken: !!s.mercadopago.accessToken, hasWebhookSecret: !!s.mercadopago.webhookSecret },
    streamelements: { hasJwt: !!s.streamelements.jwt },
  };
}

// ---------- Servidor del panel y overlay (solo esta PC) ----------
const app = createApp({ staticDir: path.join(__dirname, 'public'), guard: auth.guard });
app.get('/', (req, res) => res.redirect('/menu'));
// Configuración: es el mismo panel en su vista de ajustes (stream, acceso remoto, conexiones y chat)
app.get('/configuracion', (req, res) => {
  require('fs').readFile(path.join(__dirname, 'public', 'panel.html'), (err, buf) => res.send(err ? 'Error' : buf));
});
app.get('/api/version', (req, res) => res.json({ app: 'reloj-subaton', version: require('./package.json').version }));
app.get('/events', (req, res) => {
  const mode = req.query.overlay === '1' ? 'overlay' : req.role === 'mod' ? 'mod' : 'full';
  const perms = req.perms || {};
  // Un mod sin permiso de "montos" nunca recibe cuánto dinero donó alguien
  const transform = mode === 'mod' && !perms.money ? (type, p) => (type === 'log' ? redactLog(p) : type === 'added' ? redactAdded(p) : p) : null;
  live.attach(req, res, [['state', stateMsg()]], mode, transform);
});
const MONEY = new Set(['paypal', 'mercadopago']);
const redactLog = (e) => (MONEY.has(e.source) ? { ...e, amount: null, currency: null, note: '', text: `${e.user || 'Alguien'} donó${e.via ? ` (vía ${e.via})` : ''}` } : e);
const redactAdded = (a) => (MONEY.has(a.source) ? { ...a, text: `${a.user || 'Alguien'} donó` } : a);
// Quién hizo un cambio (para el historial y el log), cuando no es el dueño en esta PC
const actor = (req) => (req.role === 'mod' ? `${req.user} (mod)` : req.user && req.user !== 'dueño (esta PC)' ? `${req.user} (remoto)` : null);

// ---------- Acceso remoto (otra PC / celular) ----------
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const tailscale = a.address.startsWith('100.') || /tailscale/i.test(name);
      out.push({ ip: a.address, kind: tailscale ? 'tailscale' : 'red', name });
    }
  }
  return out;
}
function remoteInfo(req) {
  return {
    enabled: !!d.settings.remoteAccess,
    active: REMOTE,
    hasPassword: auth.hasPassword(),
    hasAnyLogin: auth.hasAnyLogin(),
    needsRestart: !!(d.settings.remoteAccess && auth.hasAnyLogin()) !== REMOTE,
    users: auth.listUsers(),
    modMaxSeconds: d.settings.modMaxSeconds || 0,
    isLocal: auth.isLocal(req),
    port: PORT,
    addresses: lanAddresses(),
  };
}
app.get('/login', (req, res) => {
  if (!REMOTE) return res.send('<meta charset="utf-8"><body style="font-family:sans-serif;background:#0e0d12;color:#ecebf2;padding:40px"><h2>Acceso remoto desactivado</h2><p>Actívalo desde el panel en la PC del reloj (sección Acceso remoto).</p></body>', 403);
  require('fs').readFile(path.join(__dirname, 'public', 'login.html'), (err, buf) => res.send(err ? 'Error' : buf));
});
app.post('/api/login', (req, res) => {
  if (!REMOTE) return res.json({ error: 'El acceso remoto está desactivado' }, 403);
  if (auth.tooManyFails(req)) return res.json({ error: 'Demasiados intentos. Espera un minuto.' }, 429);
  const who = auth.check(req.body.user || '', req.body.password || '');
  if (!who) {
    auth.registerFail(req);
    console.warn(`[Acceso remoto] Usuario o contraseña incorrectos ("${String(req.body.user || '').slice(0, 30)}") desde ${auth.ipOf(req)}`);
    return res.json({ error: 'Usuario o contraseña incorrectos' }, 401);
  }
  const token = auth.newSession(who.user);
  console.log(`[Acceso remoto] ${who.role === 'owner' ? 'Dueño (admin)' : `Moderador ${who.user}`} inició sesión desde ${auth.ipOf(req)}`);
  res.setHeader('Set-Cookie', auth.cookieHeader(token, req.headers['x-forwarded-proto'] === 'https'));
  ok(res, { role: who.role });
});
app.post('/api/logout', (req, res) => {
  auth.logout(req);
  res.setHeader('Set-Cookie', auth.cookieHeader('', false));
  ok(res);
});
app.get('/api/remote', (req, res) => res.json(remoteInfo(req)));
app.post('/api/remote', (req, res) => {
  const b = req.body;
  if (typeof b.password === 'string' && b.password) {
    if (b.password.length < 6) return res.json({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400);
    auth.setPassword(b.password);
    live.kick(auth.OWNER_USER);
    console.log('[Acceso remoto] Contraseña del panel cambiada (se cerraron las sesiones abiertas)');
  }
  if ('modMaxSeconds' in b) d.settings.modMaxSeconds = Math.max(0, Math.round(num(b.modMaxSeconds)));
  if ('enabled' in b) {
    if (b.enabled && !auth.hasAnyLogin()) return res.json({ error: 'Primero crea un usuario o pon la contraseña del dueño' }, 400);
    d.settings.remoteAccess = !!b.enabled;
    console.log(`[Acceso remoto] ${b.enabled ? 'Activado' : 'Desactivado'} (se aplica al reiniciar el reloj)`);
  }
  if (b.removePassword) {
    auth.clearPassword();
    live.kick(auth.OWNER_USER);
    console.log('[Acceso remoto] Contraseña del dueño quitada');
  }
  store.save();
  ok(res, { remote: remoteInfo(req) });
});
// Sonidos (solo el dueño, salvo los archivos que necesita el overlay)
app.get('/sonidos/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const type = SOUND_EXT[path.extname(file).toLowerCase()];
  if (!type) return res.send('No encontrado', 404, 'text/plain');
  require('fs').readFile(path.join(SOUNDS_DIR, file), (err, buf) => {
    if (err) return res.send('No encontrado', 404, 'text/plain');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});
app.post('/api/sounds', (req, res) => {
  const b = req.body;
  const s = d.settings.sounds;
  if ('enabled' in b) s.enabled = !!b.enabled;
  if ('volume' in b) s.volume = Math.max(0, Math.min(100, Math.round(num(b.volume, s.volume))));
  if (b.events) for (const e of SOUND_EVENTS) if (e in b.events) s.events[e] = !!b.events[e];
  store.save();
  scanSounds();
  broadcast('state', stateMsg());
  ok(res, { sounds: soundsMsg() });
});
app.post('/api/sounds/test', (req, res) => {
  if (!SOUND_EVENTS.includes(req.body.event)) return res.json({ error: 'Sonido inválido' }, 400);
  scanSounds();
  broadcast('sound', { event: req.body.event, test: true, sounds: soundsMsg() });
  ok(res);
});
app.post('/api/sounds/open-folder', (req, res) => {
  scanSounds();
  const cmd = process.platform === 'win32' ? `explorer "${SOUNDS_DIR}"` : process.platform === 'darwin' ? `open "${SOUNDS_DIR}"` : `xdg-open "${SOUNDS_DIR}"`;
  exec(cmd, () => {});
  ok(res, { sounds: soundsMsg() });
});

// Usuarios moderadores (solo el dueño)
const userRoute = (fn, msg) => (req, res) => {
  try {
    fn(req);
    if (req.params.name && (req.method === 'DELETE' || 'password' in req.body || 'perms' in req.body || req.body.enabled === false)) live.kick(String(req.params.name).toLowerCase());
    console.log(`[Acceso remoto] ${msg(req)}`);
    ok(res, { remote: remoteInfo(req) });
  } catch (err) {
    res.json({ error: err.message }, 400);
  }
};
app.post('/api/users', userRoute((req) => auth.addUser(req.body.name, req.body.password || '', req.body.perms), (req) => `Usuario moderador creado: ${String(req.body.name).toLowerCase().trim()}`));
app.post('/api/users/:name', userRoute((req) => auth.updateUser(req.params.name, req.body), (req) => `Usuario ${req.params.name} modificado${'password' in req.body ? ' (contraseña nueva)' : ''}${'enabled' in req.body ? (req.body.enabled ? ' (activado)' : ' (desactivado)') : ''}`));
app.delete('/api/users/:name', userRoute((req) => auth.deleteUser(req.params.name), (req) => `Usuario ${req.params.name} eliminado`));

// Datos para el panel de mods: solo lo indispensable, nada de conexiones, tokens, tarifas ni montos
app.get('/api/mod/data', (req, res) => {
  const time = Object.values(d.stats || {}).reduce((a, s) => a + (s.seconds || 0), 0);
  const perms = req.role === 'mod' ? req.perms : Object.fromEntries(auth.PERMS.map((k) => [k, true]));
  res.json({
    me: { name: req.user, role: req.role, perms },
    state: stateMsg(),
    multiplier: d.multiplier,
    log: d.log.slice(0, 100).map((e) => (perms.money ? e : redactLog(e))),
    totalAdded: time,
    maxPerAction: req.role === 'mod' ? d.settings.modMaxSeconds || 0 : 0,
    rates: perms.rates ? d.rates : undefined,
    stats: perms.money ? d.stats : undefined,
    currencies: perms.money ? { paypal: d.rates.paypal.currency, mercadopago: d.rates.mercadopago.currency } : undefined,
    chat: perms.chat ? d.chat : undefined,
  });
});

app.post('/api/restart', (req, res) => {
  ok(res);
  setTimeout(restart, 300);
});

const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
const ok = (res, extra = {}) => res.json({ ok: true, ...extra });

app.get('/api/data', (req, res) => {
  res.json({
    state: stateMsg(),
    settings: d.settings,
    rates: d.rates,
    chat: d.chat,
    multiplier: d.multiplier,
    stats: d.stats,
    log: d.log.slice(0, 200),
    secrets: publicSecrets(),
    connections: connectionsInfo(),
    ports: { panel: PORT, webhooks: WEBHOOK_PORT },
  });
});

// Reloj
const tag = (req) => (actor(req) ? `[Panel · ${actor(req)}]` : '[Panel]');
const noteIfRemote = (req, text) => actor(req) && engine.logNote(`${actor(req)}: ${text}`);
app.post('/api/timer/start', (req, res) => {
  const started = timer.start();
  if (started) {
    console.log(`${tag(req)} ▶ Reloj iniciado (quedan ${fmtDuration(timer.remainingMs / 1000)})`);
    noteIfRemote(req, 'inició el reloj');
  }
  ok(res, { started });
});
app.post('/api/timer/pause', (req, res) => {
  const paused = timer.pause();
  if (paused) {
    console.log(`${tag(req)} ⏸ Reloj pausado (quedan ${fmtDuration(timer.remainingMs / 1000)})`);
    noteIfRemote(req, 'pausó el reloj');
  }
  ok(res, { paused });
});
app.post('/api/timer/add', (req, res) => {
  let s = Math.round(num(req.body.seconds));
  const max = req.role === 'mod' ? Number(d.settings.modMaxSeconds) || 0 : 0;
  if (max > 0) s = Math.max(-max, Math.min(max, s));
  const text = actor(req) ? `${actor(req)} ${s >= 0 ? 'sumó' : 'quitó'} tiempo` : undefined;
  ok(res, { entry: engine.manualAdjust(s, text), capped: max > 0 && Math.abs(s) === max });
});
app.post('/api/timer/set', (req, res) => {
  timer.set(Math.max(0, num(req.body.seconds)) * 1000);
  console.log(`${tag(req)} 🕒 Reloj fijado en ${fmtDuration(timer.remainingMs / 1000)}`);
  noteIfRemote(req, `fijó el reloj en ${fmtDuration(timer.remainingMs / 1000)}`);
  ok(res);
});

// Stream: pausa/reanudación automática
app.post('/api/stream-settings', (req, res) => {
  if ('autoPauseOffline' in req.body) d.settings.autoPauseOffline = !!req.body.autoPauseOffline;
  if ('autoResumeOnline' in req.body) d.settings.autoResumeOnline = !!req.body.autoResumeOnline;
  if ('shutdownOnPanelClose' in req.body) d.settings.shutdownOnPanelClose = !!req.body.shutdownOnPanelClose;
  if ('keepAliveWhenLive' in req.body) d.settings.keepAliveWhenLive = !!req.body.keepAliveWhenLive;
  store.save();
  ok(res, { settings: d.settings });
});

// Registros (logs)
app.get('/api/logs/current', (req, res) => {
  const file = logger.latestFile();
  if (!file) return res.send('Todavía no hay registros.', 200, 'text/plain; charset=utf-8');
  require('fs').readFile(file, 'utf8', (err, text) => res.send(err ? 'No se pudo leer el registro.' : `${path.basename(file)}\n\n${text}`, 200, 'text/plain; charset=utf-8'));
});
app.post('/api/logs/open-folder', (req, res) => {
  const dir = logger.dir;
  const cmd = process.platform === 'win32' ? `explorer "${dir}"` : process.platform === 'darwin' ? `open "${dir}"` : `xdg-open "${dir}"`;
  exec(cmd, () => {});
  ok(res, { dir });
});

// Apagar el programa (como corre oculto, se apaga desde el panel o con detener.bat)
app.post('/api/shutdown', (req, res) => {
  ok(res);
  setTimeout(() => shutdown('Reloj apagado desde el panel'), 300);
});

// Configuración general y tarifas
app.post('/api/config', (req, res) => {
  const { rates } = req.body;
  const settings = req.role === 'mod' ? null : req.body.settings; // los mods solo pueden tocar tarifas
  if (req.role === 'mod' && rates) noteIfRemote(req, 'cambió las tarifas');
  if (settings) {
    d.settings.initialSeconds = Math.max(0, Math.round(num(settings.initialSeconds, d.settings.initialSeconds)));
    d.settings.maxSeconds = Math.max(0, Math.round(num(settings.maxSeconds, d.settings.maxSeconds)));
    d.settings.addAfterEnd = !!settings.addAfterEnd;
    if (settings.horasDiarias && typeof settings.horasDiarias === 'object') {
      const h = d.settings.horasDiarias, n = settings.horasDiarias;
      if ('on' in n) h.on = !!n.on;
      if ('seconds' in n) h.seconds = Math.max(0, Math.round(num(n.seconds, h.seconds)));
      if ('unaVezPorDia' in n) h.unaVezPorDia = !!n.unaVezPorDia;
    }
    if (typeof settings.publicUrl === 'string') d.settings.publicUrl = settings.publicUrl.trim().replace(/\/+$/, '');
  }
  if (rates) {
    for (const src of ['paypal', 'mercadopago', 'bits']) {
      const r = rates[src];
      if (!r) continue;
      Object.assign(d.rates[src], {
        enabled: !!r.enabled,
        amount: Math.max(0, num(r.amount, d.rates[src].amount)),
        seconds: Math.max(0, num(r.seconds, d.rates[src].seconds)),
        proportional: !!r.proportional,
        minAmount: Math.max(0, num(r.minAmount, 0)),
      });
      if (src !== 'bits' && typeof r.currency === 'string') d.rates[src].currency = r.currency.trim().toUpperCase();
    }
    if (rates.subs) {
      const r = rates.subs;
      Object.assign(d.rates.subs, {
        enabled: !!r.enabled,
        tier1: Math.max(0, num(r.tier1, d.rates.subs.tier1)),
        tier2: Math.max(0, num(r.tier2, d.rates.subs.tier2)),
        tier3: Math.max(0, num(r.tier3, d.rates.subs.tier3)),
        countResubs: !!r.countResubs,
        countGifts: !!r.countGifts,
      });
    }
  }
  store.save();
  broadcast('config', { settings: d.settings, rates: d.rates });
  ok(res);
});

// Multiplicadores
const cleanApplies = (a = {}) => Object.fromEntries(SOURCES.map((s) => [s, !!a[s]]));
const multiplierChanged = () => {
  store.save();
  broadcast('multiplier', d.multiplier);
  broadcast('state', stateMsg());
};
function setManualMultiplier({ active, value, minutes, appliesTo }) {
  const m = d.multiplier.manual;
  if (active) {
    if (!m.active || m.value !== Math.max(1, num(value, 2))) m.since = Date.now();
    m.active = true;
    m.value = Math.max(1, num(value, 2));
    m.until = num(minutes) > 0 ? Date.now() + num(minutes) * 60000 : null;
    m.appliesTo = cleanApplies(appliesTo);
  } else {
    m.active = false;
    m.until = null;
  }
  multiplierChanged();
}
const MOD_MAX_MULT = 5;
app.post('/api/multiplier/manual', (req, res) => {
  const b = { ...req.body };
  if (req.role === 'mod' && b.active) b.value = Math.min(MOD_MAX_MULT, num(b.value, 2));
  setManualMultiplier(b);
  noteIfRemote(req, b.active ? `activó x${Math.max(1, num(b.value, 2))}${num(b.minutes) > 0 ? ` por ${b.minutes} min` : ''}` : 'apagó el multiplicador');
  ok(res);
});

// Comandos del chat
const commands = createCommands({ store, timer, engine, twitch, setManualMultiplier, podio });
app.post('/api/chat', (req, res) => {
  const b = req.body;
  const c = d.chat;
  for (const k of ['enabled', 'allowMods', 'allowLeadMods', 'allowVips', 'reply', 'publicTime']) if (k in b) c[k] = !!b[k];
  if (typeof b.prefix === 'string' && b.prefix.trim()) c.prefix = b.prefix.trim().slice(0, 3);
  if ('maxPerCommand' in b) c.maxPerCommand = Math.max(0, Math.round(num(b.maxPerCommand)));
  if (Array.isArray(b.users)) c.users = [...new Set(b.users.map((u) => String(u).trim().replace(/^@/, '').toLowerCase()).filter(Boolean))].slice(0, 100);
  store.save();
  if (req.role === 'mod') console.log(`[Panel · ${actor(req)}] cambió la configuración de comandos del chat`);
  ok(res, { chat: c });
});
app.post('/api/multiplier/schedule', (req, res) => {
  const { start, end, value, appliesTo } = req.body;
  if (!(num(end) > num(start))) return res.json({ error: 'La hora de fin debe ser posterior al inicio' }, 400);
  const v = Math.max(1, req.role === 'mod' ? Math.min(MOD_MAX_MULT, num(value, 2)) : num(value, 2));
  d.multiplier.schedules.push({ id: crypto.randomUUID(), start: num(start), end: num(end), value: v, appliesTo: cleanApplies(appliesTo), by: actor(req) || undefined });
  d.multiplier.schedules.sort((a, b) => a.start - b.start);
  multiplierChanged();
  noteIfRemote(req, `programó x${v}`);
  ok(res);
});
app.delete('/api/multiplier/schedule/:id', (req, res) => {
  d.multiplier.schedules = d.multiplier.schedules.filter((s) => s.id !== req.params.id);
  multiplierChanged();
  noteIfRemote(req, 'quitó un multiplicador programado');
  ok(res);
});

// Credenciales (se guardan solo en tu PC, en data/subaton.json)
const SECRET_FIELDS = { twitch: ['clientSecret'], paypal: ['clientSecret'], mercadopago: ['accessToken', 'webhookSecret'], streamelements: ['jwt'] };
const PLAIN_FIELDS = { twitch: ['clientId'], paypal: ['mode', 'clientId', 'webhookId', 'receiverEmail'], mercadopago: ['mode', 'pollSeconds', 'nombre'], streamelements: [] };
app.post('/api/secrets', (req, res) => {
  for (const svc of Object.keys(SECRET_FIELDS)) {
    const incoming = req.body[svc];
    if (!incoming) continue;
    for (const f of PLAIN_FIELDS[svc]) if (f in incoming) d.secrets[svc][f] = typeof incoming[f] === 'string' ? incoming[f].trim() : incoming[f];
    for (const f of SECRET_FIELDS[svc]) {
      if (incoming[f] === null) d.secrets[svc][f] = '';
      else if (typeof incoming[f] === 'string' && incoming[f].trim()) d.secrets[svc][f] = incoming[f].trim();
    }
  }
  store.save();
  if (req.body.mercadopago) mp.start();
  if (req.body.streamelements) se.start();
  sendConnections();
  ok(res, { secrets: publicSecrets() });
});

// Twitch OAuth
let oauthState = '';
app.get('/auth/twitch', (req, res) => {
  if (!d.secrets.twitch.clientId || !d.secrets.twitch.clientSecret) return res.send('<meta charset="utf-8">Primero guarda el Client ID y el Client Secret de Twitch en el panel.', 400);
  oauthState = crypto.randomBytes(16).toString('hex');
  res.redirect(twitch.authUrl(oauthState));
});
app.get('/auth/twitch/callback', async (req, res) => {
  const back = (msg) => res.send(`<meta charset="utf-8"><body style="font-family:sans-serif;background:#111;color:#eee;padding:40px"><h2>${msg}</h2><p>Puedes cerrar esta pestaña y volver al <a style="color:#b18cff" href="/panel">panel</a>.</p></body>`);
  if (req.query.error) return back('Twitch canceló la conexión: ' + req.query.error_description);
  if (!req.query.state || req.query.state !== oauthState) return back('La conexión expiró, inténtalo de nuevo desde el panel.');
  try {
    await twitch.exchangeCode(req.query.code);
    back(`✅ Twitch conectado como ${d.secrets.twitch.login}`);
  } catch (err) {
    back('❌ Error conectando Twitch: ' + err.message);
  }
});
app.post('/api/twitch/disconnect', (req, res) => {
  twitch.disconnect();
  ok(res);
});
app.post('/api/twitch/reconnect', (req, res) => {
  twitch.start();
  ok(res);
});

// Simulador de eventos (suma tiempo de verdad, pero no cuenta en las estadísticas)
app.post('/api/simulate', (req, res) => {
  const b = req.body;
  if (!SOURCES.includes(b.source)) return res.json({ error: 'Fuente inválida' }, 400);
  const ev = { source: b.source, user: b.user || 'Prueba', test: true };
  if (b.source === 'subs') Object.assign(ev, { kind: b.kind || 'new', tier: num(b.tier, 1), count: Math.max(1, num(b.count, 1)) });
  else Object.assign(ev, { amount: num(b.amount), currency: b.source === 'bits' ? null : b.currency || d.rates[b.source].currency });
  ok(res, { entry: onContribution(ev) });
});

// Probar la lluvia de patitos sin sumar tiempo al reloj
app.post('/api/patitos/probar', (req, res) => {
  const source = req.body.source === 'paypal' ? 'paypal' : 'mercadopago';
  const usd = Math.max(0.5, Math.min(100, num(req.body.usd, 5)));
  broadcast('aporte', { user: 'Prueba', usd, ...podio.patitosAporte(source, usd, true) });
  ok(res);
});

// Vaciar el montón de patitos del overlay /patitos
app.post('/api/patitos/vaciar', (req, res) => {
  podio.vaciarPatitos();
  broadcast('aporte', { vaciar: true });
  ok(res);
});

// Sumar las horas diarias a mano (botón "Sumar ahora")
app.post('/api/horas-diarias', (req, res) => {
  const entry = sumarHorasDiarias('(a mano)', true);
  if (!entry) return res.json({ error: 'Configura cuántas horas sumar' }, 400);
  ok(res, { entry });
});

// Simular inicio / fin del stream (para probar la pausa y reanudación automáticas)
app.post('/api/simulate-stream', (req, res) => {
  console.log(`[Prueba] Simulando ${req.body.live ? 'inicio' : 'fin'} del stream`);
  onStream(!!req.body.live, false);
  ok(res);
});

// Reiniciar todo el subatón
app.post('/api/reset', (req, res) => {
  timer.pause();
  timer.set(d.settings.initialSeconds * 1000);
  timer.ended = false;
  d.log = [];
  d.stats = {};
  d.multiplier.manual.active = false;
  d.mpSince = Date.now();
  store.save();
  broadcast('reset', {});
  broadcast('state', stateMsg());
  ok(res);
});
app.post('/api/log/clear', (req, res) => {
  d.log = [];
  store.save();
  broadcast('reset', {});
  ok(res);
});

// ---------- Menú principal ----------
const MODULOS = require('./src/modulos');
const okStatus = (s) => (s === 'conectado' ? 'ok' : s === 'error' ? 'err' : ['conectando', 'reconectando'].includes(s) ? 'wait' : '');
app.get('/api/menu', (req, res) => {
  const c = connectionsInfo();
  const pp = c.streamelements.status === 'conectado' ? 'ok' : c.paypal.last ? 'ok' : okStatus(c.streamelements.status);
  const p = podio.publicData();
  res.json({
    version: require('./package.json').version,
    descanso: !!d.settings.descanso,
    descansoSumaTiempo: d.settings.descansoSumaTiempo !== false,
    timer: timer.snapshot(),
    live: !!stream.live,
    conexiones: [
      { nombre: 'Twitch', estado: okStatus(c.twitch.status), detalle: c.twitch.status },
      { nombre: 'PayPal', estado: pp, detalle: c.streamelements.status === 'conectado' ? 'vía StreamElements' : c.paypal.last ? 'avisos directos' : 'sin conectar' },
      { nombre: 'Mercado Pago', estado: okStatus(c.mercadopago.status), detalle: c.mercadopago.status },
    ],
    modulos: MODULOS.filter((m) => !m.oculto),
    metas: p.metas,
    mes: p.mes,
    ultimos: d.log.filter((e) => e.source !== 'manual').slice(0, 8).map((e) => ({ at: e.at, source: e.source, text: e.text, seconds: e.seconds, test: !!e.test, note: e.note })),
  });
});
// "Pausar todo": el reloj se detiene pero sigue escuchando (para el podio, las metas y, si quieres, el tiempo guardado)
app.post('/api/descanso', (req, res) => {
  const b = req.body || {};
  if ('sumaTiempo' in b) d.settings.descansoSumaTiempo = !!b.sumaTiempo;
  if ('on' in b) {
    const on = !!b.on;
    if (on && !d.settings.descanso) {
      d.settings.descansoPrevRunning = timer.running;
      timer.pause();
      d.settings.descanso = true;
      console.log(`⏸ Todo en pausa (descanso) · quedan ${fmtDuration(timer.remainingMs / 1000)} · sigue escuchando subs, bits y donaciones${d.settings.descansoSumaTiempo ? ' (suman tiempo para el próximo stream)' : ' (no suman tiempo)'}`);
    } else if (!on && d.settings.descanso) {
      d.settings.descanso = false;
      if (d.settings.descansoPrevRunning || stream.live) timer.start();
      console.log(`▶ Fin del descanso · reloj ${timer.running ? 'corriendo' : 'en pausa'} · quedan ${fmtDuration(timer.remainingMs / 1000)}`);
    }
  }
  store.save();
  broadcast('state', stateMsg());
  ok(res, { descanso: d.settings.descanso, descansoSumaTiempo: d.settings.descansoSumaTiempo });
});

// ---------- Podio mensual (Top donadores · Top subs regaladas · Top bits) ----------
// Público (lo leen los overlays de OBS): solo nombres y totales
app.get('/api/podio', (req, res) => res.json(podio.publicData()));
// Panel del podio (solo el dueño)
app.get('/api/podio/admin', (req, res) => res.json(podio.adminData(req.query.mes)));
const podioRoute = (fn) => (req, res) => {
  try { ok(res, { result: fn(req) }); } catch (err) { res.json({ error: err.message }, 400); }
};
app.post('/api/podio/config', podioRoute((req) => podio.setConfig(req.body)));
app.post('/api/podio/event', podioRoute((req) => { const r = podio.addManual(req.body); respaldo.alAporte(); return r; }));
app.post('/api/podio/event/:id', podioRoute((req) => podio.renameEvent(req.params.id, req.body.user)));
app.post('/api/podio/renombrar', podioRoute((req) => podio.renamePerson(req.body)));
app.post('/api/podio/rey', podioRoute((req) => podio.setRey(req.body)));
app.post('/api/podio/vincular-mp', podioRoute((req) => podio.vincularMP(req.body.nombre, req.body.monto)));
app.delete('/api/podio/event/:id', podioRoute((req) => podio.removeEvent(req.params.id)));
app.post('/api/podio/rates', async (req, res) => {
  const r = await podio.refreshRates(true);
  r.ok ? ok(res) : res.json({ error: 'No se pudo obtener la cotización: ' + r.error }, 502);
});

// ---------- Código de creador (tarjeta "Apoya a un creador" + cinta de noticias) ----------
const codigo = require('./src/codigo');
const codigoCtx = () => ({ live: !!stream.live, descanso: !!d.settings.descanso });
app.get('/api/codigo', (req, res) => res.json(codigo.publicData()));
app.get('/api/codigo/estado', (req, res) => res.json({ ...codigo.publicData(), proximas: codigo.proximas(codigoCtx()), live: !!stream.live, descanso: !!d.settings.descanso }));
app.post('/api/codigo/config', podioRoute((req) => codigo.setConfig(req.body)));
app.post('/api/codigo/mostrar', podioRoute((req) => codigo.mostrar(req.body.que, broadcast, true)));
setInterval(() => { try { codigo.tick(broadcast, codigoCtx()); } catch (e) { console.error('[Código]', e.message); } }, 5000);

// ---------- Mensajes automáticos en el chat ----------
const autoCtx = () => ({
  live: !!stream.live, descanso: !!d.settings.descanso,
  puedeChat: () => !!twitch.chatOk,
  enviar: (texto, responderA) => twitch.sendChat(texto, responderA),
  tiempo: () => fmtDuration(timer.remainingMs / 1000),
  canal: () => d.secrets?.twitch?.login || '',
});
app.get('/api/automensajes', (req, res) => res.json(automensajes.estado(autoCtx())));
app.post('/api/automensajes/config', podioRoute((req) => automensajes.setConfig(req.body)));
// Agregar a alguien que puede escribir "activar bot": se verifica que exista en Twitch con ese nombre exacto
app.post('/api/automensajes/quien', async (req, res) => {
  try {
    const login = automensajes.normalizar(req.body.login);
    if (!automensajes.esLogin(login)) throw new Error('Ese no es un nombre de Twitch válido (solo letras, números y _, de 3 a 25)');
    let nombre = login, verificado = false;
    if (twitch.s?.accessToken) {
      const j = await twitch.helix('GET', '/users?login=' + encodeURIComponent(login));
      const u = j.data?.[0];
      if (!u) throw new Error(`No existe nadie en Twitch con el nombre "${login}". Revisa que esté escrito igual que en Twitch.`);
      nombre = u.display_name || u.login; verificado = true;
    }
    console.log(`[Automensajes] ${nombre} ahora puede escribir "activar bot"${verificado ? '' : ' (sin verificar: Twitch no está conectado)'}`);
    ok(res, { result: automensajes.agregarQuien(login, nombre), nombre, verificado });
  } catch (err) { res.json({ error: err.message }, 400); }
});
app.post('/api/automensajes/quitar', podioRoute((req) => automensajes.quitarQuien(req.body.login)));
app.post('/api/automensajes/enviar', async (req, res) => {
  try { ok(res, { result: await automensajes.enviarAhora(String(req.body.id || ''), autoCtx()) }); } catch (err) { res.json({ error: err.message }, 400); }
});
setInterval(() => { automensajes.tick(autoCtx()).catch((e) => console.error('[Automensajes]', e.message)); }, 10000);

// ---------- Tren del hype ----------
const hype = require('./src/hype');
// ¿La canción sincronizada es el mismo archivo que se midió? (si cambias el mp3, vuelve al modo normal)
function hypeCancion() {
  const c = hype.getConfig().cancion;
  try { const st = require('fs').statSync(path.join(SOUNDS_DIR, c.archivo)); hype.perfilPorTamano(st.size); const ok = st.size === hype.getConfig().cancion.bytes; return { ok: !!c.on && ok, medida: ok, existe: true, bytes: st.size, archivo: c.archivo }; }
  catch { return { ok: false, medida: false, existe: false, archivo: c.archivo }; }
}
// todas las canciones de la carpeta "sonidos" (para elegir en el panel)
function hypeCanciones() {
  try { return require('fs').readdirSync(SOUNDS_DIR).filter((f) => SOUND_EXT[path.extname(f).toLowerCase()]).map((f) => ({ nombre: f, bytes: require('fs').statSync(path.join(SOUNDS_DIR, f)).size })); } catch { return []; }
}
function hypeArchivos() {
  try { return require('fs').readdirSync(SOUNDS_DIR).filter((f) => /^hype-/i.test(f) && SOUND_EXT[path.extname(f).toLowerCase()]); } catch { return []; }
}
function onHype(fase, e, desfase) {
  try {
    const r = hype.procesar(fase, e, desfase);
    const t = r.estado;
    if (fase === 'begin') console.log(`🚂 ¡Empezó el tren del hype! Nivel ${t.nivel}${t.tipo !== 'regular' ? ' (' + t.tipoNombre + ')' : ''}`);
    else if (fase === 'end') console.log(`🚂 Terminó el tren del hype en el nivel ${t.nivel} (${t.total} puntos)`);
    else if (r.subio) console.log(`🚂 ¡El tren del hype subió al nivel ${t.nivel}!`);
    if (hype.getConfig().on) broadcast('hype', { ...r, config: hype.getConfig(), archivos: hypeArchivos(), cancionOk: hypeCancion().ok });
    return r;
  } catch (err) { console.error('[Hype]', err.message); throw err; }
}
app.get('/api/hype', (req, res) => { const c = hypeCancion(); res.json({ ...hype.publicEstado(), config: hype.getConfig(), archivos: hypeArchivos(), cancionOk: c.ok, cancion: c, canciones: hypeCanciones() }); });
// la medición automática de la canción (la hace el navegador del panel o del overlay)
app.post('/api/hype/cancion/perfil', podioRoute((req) => { const r = hype.setPerfil(req.body); broadcast('hype', { config: r, archivos: hypeArchivos(), cancionOk: hypeCancion().ok }); return r; }));
// subir una canción desde el panel: se guarda en la carpeta "sonidos"
app.post('/api/hype/subir', (req, res) => {
  const fs2 = require('fs');
  const nombre = path.basename(decodeURIComponent(String(req.headers['x-nombre'] || 'cancion.mp3'))).replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, '_').slice(0, 80);
  if (!SOUND_EXT[path.extname(nombre).toLowerCase()]) return res.json({ error: 'Tiene que ser .mp3, .wav, .ogg o .m4a' }, 400);
  if (!req.rawBuffer || req.rawBuffer.length < 1000) return res.json({ error: 'El archivo llegó vacío' }, 400);
  try { fs2.mkdirSync(SOUNDS_DIR, { recursive: true }); fs2.writeFileSync(path.join(SOUNDS_DIR, nombre), req.rawBuffer); }
  catch (err) { return res.json({ error: 'No se pudo guardar: ' + err.message }, 500); }
  console.log(`[Hype] Canción subida: ${nombre} (${Math.round(req.rawBuffer.length / 1024)} KB)`);
  ok(res, { nombre, bytes: req.rawBuffer.length });
});
app.post('/api/hype/config', podioRoute((req) => hype.setConfig(req.body)));
app.post('/api/hype/probar', (req, res) => {
  try {
    const before = hype.publicEstado().estado;
    const r = hype.probar(req.body.accion);
    const fase = r.estado.fase === 'inicio' ? 'begin' : r.estado.fase === 'fin' ? 'end' : 'progress';
    if (hype.getConfig().on) broadcast('hype', { ...r, prueba: true, config: hype.getConfig(), archivos: hypeArchivos(), cancionOk: hypeCancion().ok });
    console.log(`[Hype] Prueba: ${fase === 'begin' ? 'empieza el tren' : fase === 'end' ? 'termina el tren' : r.subio ? 'sube al nivel ' + r.estado.nivel : 'suma puntos'}`);
    ok(res, { result: r, antes: !!before });
  } catch (err) { res.json({ error: err.message }, 400); }
});

// ---------- Copias de seguridad ----------
if (RECUPERADOS.length) console.warn('💾 Se recuperaron de la copia de seguridad: ' + RECUPERADOS.join(', '));
respaldo.iniciar(() => { podio.saveNow(); store.saveNow(); });
app.get('/api/respaldo', (req, res) => res.json(respaldo.info()));
app.post('/api/respaldo/config', podioRoute((req) => respaldo.setConfig(req.body)));
app.post('/api/respaldo/ahora', podioRoute(() => { try { podio.saveNow(); store.saveNow(); } catch {} return respaldo.respaldar('a mano', true) && respaldo.info(); }));
app.post('/api/respaldo/abrir', (req, res) => {
  const dir = respaldo.carpetas()[0];
  try { require('fs').mkdirSync(dir, { recursive: true }); } catch {}
  exec(process.platform === 'win32' ? `explorer "${dir}"` : process.platform === 'darwin' ? `open "${dir}"` : `xdg-open "${dir}"`, () => {});
  ok(res);
});
app.post('/api/respaldo/restaurar', (req, res) => {
  try { podio.saveNow(); store.saveNow(); codigo.save(); hype.save(); automensajes.save(); } catch {}
  try { respaldo.pedirRestaurar(String(req.body.copia || '')); } catch (err) { return res.json({ error: err.message }, 400); }
  console.log(`💾 Restaurando la copia ${req.body.copia}: el reloj se reinicia…`);
  ok(res);
  setTimeout(restart, 500);
});

// ---------- Actualizaciones desde GitHub ----------
const actualizador = require('./src/actualizador');
{ const m = actualizador.marca(); if (m && !m.visto) console.log(`✅ Reloj actualizado de la versión ${m.de} a la ${m.a}. Tus datos quedaron igual.`); }
let ultimaBusqueda = null;
app.get('/api/actualizar', (req, res) => res.json({ version: require('./package.json').version, repo: actualizador.REPO, auto: d.settings.actualizarAuto !== false, marca: actualizador.marca(), ultima: ultimaBusqueda, live: !!stream.live }));
app.post('/api/actualizar/config', (req, res) => { if ('auto' in req.body) d.settings.actualizarAuto = !!req.body.auto; store.save(); ok(res, { auto: d.settings.actualizarAuto !== false }); });
app.post('/api/actualizar/visto', (req, res) => { actualizador.marcarVisto(); ok(res); });
app.post('/api/actualizar/buscar', async (req, res) => {
  try { const r = await actualizador.buscar(); ultimaBusqueda = { at: Date.now(), ...(r || { version: null }) }; ok(res, { result: ultimaBusqueda }); }
  catch (err) { res.json({ error: 'No se pudo revisar: ' + err.message }, 502); }
});
// Actualizar ahora: apaga el reloj, actualiza y lo vuelve a abrir (no se permite en vivo, salvo que lo confirmes)
app.post('/api/actualizar/ahora', (req, res) => {
  if (stream.live && !req.body.aunEnVivo) return res.json({ error: 'Estás en vivo: la actualización se hace sola la próxima vez que abras el reloj.' }, 409);
  try {
    spawn(process.execPath, [path.join(__dirname, 'iniciar.js'), '--actualizar-ahora'], { cwd: __dirname, detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env } }).unref();
  } catch (err) { return res.json({ error: err.message }, 500); }
  console.log('🔄 Actualizando: el reloj se cierra y vuelve a abrir solo…');
  ok(res);
});

const server = http.createServer(app.handle);
let hookServer;

// ---------- Servidor de webhooks (el único que va al túnel) ----------
const hooks = createApp();
const raw = (req) => req.rawBody || '';
const logHook = (name, result) => {
  if (result?.error) console.warn(`[${name}] ${result.error}`);
  else if (result?.ignored) console.log(`[${name}] ${result.ignored}`);
};

hooks.get('/', (req, res) => res.send('Reloj de subatón: webhooks activos ✅'));

hooks.post('/webhooks/paypal', async (req, res) => {
  const body = raw(req);
  res.send('OK', 200, 'text/plain');
  try {
    const result = await paypal.handleWebhook(d.secrets.paypal, req.headers, body);
    ppStatus.last = Date.now();
    ppStatus.detail = result.error || result.ignored || 'Último webhook OK';
    logHook('PayPal', result);
    if (result.event) onContribution(result.event);
    sendConnections();
  } catch (err) {
    console.error('[PayPal]', err.message);
  }
});

hooks.post('/webhooks/paypal-ipn', async (req, res) => {
  const body = raw(req);
  res.send('OK', 200, 'text/plain'); // PayPal exige respuesta 200 inmediata
  try {
    const result = await paypal.handleIpn(d.secrets.paypal, body);
    ppStatus.last = Date.now();
    ppStatus.detail = result.error || result.ignored || 'Último IPN OK';
    logHook('PayPal IPN', result);
    if (result.event) onContribution(result.event);
    sendConnections();
  } catch (err) {
    console.error('[PayPal IPN]', err.message);
  }
});

hooks.post('/webhooks/mercadopago', async (req, res) => {
  const body = raw(req);
  res.send('OK', 200, 'text/plain');
  try {
    logHook('Mercado Pago', await mp.handleWebhook(req.query, req.headers, body));
  } catch (err) {
    console.error('[Mercado Pago]', err.message);
  }
});

hookServer = http.createServer(hooks.handle);

// ---------- Arranque ----------
function openPanel() {
  if (process.env.NO_OPEN) return;
  const url = `http://localhost:${PORT}/menu`;
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

// Reinicia el programa (para aplicar el acceso remoto) sin abrir ventanas
function restart() {
  shuttingDown = true;
  for (const c of [twitch, mp, se]) try { c.stop(); } catch {}
  persistTimer();
  store.saveNow();
  console.log('🔄 Reiniciando el reloj…');
  logger.close();
  server.close(() => {
    spawn(process.execPath, [__filename], {
      cwd: __dirname,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, NO_OPEN: '1' },
    }).unref();
    process.exit(0);
  });
  server.closeAllConnections();
  hookServer.close();
  hookServer.closeAllConnections?.();
}

// Apagado limpio: guarda, avisa a paneles y overlay, corta conexiones y libera los puertos
let shuttingDown = false;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  persistTimer();
  store.saveNow();
  try { podio.saveNow(); } catch {}
  try { codigo.save(); } catch {}
  try { hype.save(); } catch {}
  try { automensajes.save(); } catch {}
  try { respaldo.respaldar('al cerrar', true); } catch {}
  console.log(`⏹ ${reason} · quedan ${fmtDuration(timer.remainingMs / 1000)} guardados`);
  logger.close(stream.live ? ['Resumen hasta el cierre:', ...sessionSummary()] : []);
  try { live.broadcast('shutdown', { reason }); } catch {}
  for (const c of [twitch, mp, se]) try { c.stop(); } catch {}
  setTimeout(() => {
    try { server.close(); server.closeAllConnections(); } catch {}
    try { hookServer.close(); hookServer.closeAllConnections?.(); } catch {}
    removePid();
    process.exit(0);
  }, 300);
  setTimeout(() => process.exit(0), 3000).unref();
}

// Archivo con el número de proceso: si alguna vez el reloj se cuelga, iniciar.bat lo puede cerrar
const PID_FILE = path.join(path.dirname(store.file), 'reloj.pid');
function writePid() {
  try { require('fs').writeFileSync(PID_FILE, String(process.pid)); } catch {}
}
function removePid() {
  try {
    if (require('fs').readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) require('fs').unlinkSync(PID_FILE);
  } catch {}
}
process.on('exit', removePid);

// Apagar al cerrar el panel: si no queda ningún panel abierto en esta PC durante 20 s
let panelSeen = false;
let panelCloseTimer = null;
function checkPanels() {
  if (shuttingDown) return;
  const n = live.ownerCount();
  if (n > 0) {
    panelSeen = true;
    if (panelCloseTimer) {
      clearTimeout(panelCloseTimer);
      panelCloseTimer = null;
    }
    return;
  }
  if (!panelSeen || !d.settings.shutdownOnPanelClose || panelCloseTimer) return;
  panelCloseTimer = setTimeout(() => {
    panelCloseTimer = null;
    if (live.ownerCount() > 0 || !d.settings.shutdownOnPanelClose) return;
    if (d.settings.descanso) {
      console.log('ℹ  Se cerró el panel, pero está en descanso: el reloj sigue escuchando subs, bits y donaciones en segundo plano.');
      return;
    }
    if (d.settings.keepAliveWhenLive && stream.live) {
      console.log('ℹ  Se cerró el panel, pero el stream está en vivo: el reloj sigue funcionando y se apagará cuando termine el stream.');
      return;
    }
    shutdown('Se cerró el panel');
  }, Number(process.env.PANEL_CLOSE_MS) || 20000);
}
live.onChange = checkPanels;
app.get('/api/panels', (req, res) => res.json({ owners: live.ownerCount() }));

// Si el reloj ya está abierto (doble clic otra vez), solo abre el panel
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    process.stdout.write(`El reloj ya está funcionando, abriendo el panel…\n`);
    openPanel();
    setTimeout(() => process.exit(0), 500);
  } else throw err;
});

server.listen(PORT, HOST, () => {
  writePid();
  logger.open('Reloj iniciado');
  newSession();
  console.log('\n  ⏱  Reloj de Subatón listo (versión ' + require('./package.json').version + ')');
  console.log(`  Menú principal:    http://localhost:${PORT}/menu`);
  console.log(`  Panel de control:  http://localhost:${PORT}/panel`);
  console.log(`  Overlay para OBS:  http://localhost:${PORT}/overlay`);
  console.log(`  Tiempo guardado:   ${fmtDuration(timer.remainingMs / 1000)} (en pausa)`);
  if (REMOTE) for (const a of lanAddresses()) console.log(`  Acceso remoto:     http://${a.ip}:${PORT}/panel (${a.kind === 'tailscale' ? 'Tailscale' : 'red local'})`);
  if (wasRunning) console.log('  ℹ  El reloj estaba corriendo cuando se cerró: quedó EN PAUSA con el tiempo guardado.');
  if (d.settings.descanso) console.log('  😴 Sigue en descanso: reloj en pausa, escuchando subs, bits y donaciones.');
  openPanel();
  twitch.start();
  mp.start();
  se.start();
  // Los webhooks (solo para PayPal directo / Mercado Pago en modo webhook) no deben frenar el resto
  hookServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.warn(`  ⚠  El puerto ${WEBHOOK_PORT} (webhooks) está ocupado por otro programa: los webhooks de PayPal directo no funcionarán. Todo lo demás sí.`);
    else console.error('[Webhooks]', err.message);
  });
  hookServer.listen(WEBHOOK_PORT, HOOKS_HOST, () => console.log(`  Webhooks (túnel):  http://localhost:${WEBHOOK_PORT}`));
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(sig, () => shutdown('Reloj cerrado'));
}

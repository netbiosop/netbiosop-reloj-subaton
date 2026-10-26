// Guarda toda la configuración y el estado en data/subaton.json
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'subaton.json');

const ALL_SOURCES = { paypal: true, mercadopago: true, bits: true, subs: true };

const DEFAULTS = {
  settings: {
    initialSeconds: 4 * 3600, // tiempo con el que arranca el subatón
    maxSeconds: 0,            // tope de tiempo restante (0 = sin límite)
    addAfterEnd: false,       // ¿sumar tiempo si el reloj ya llegó a 0?
    publicUrl: '',            // URL pública del túnel (solo para mostrar las URLs de webhooks)
    autoPauseOffline: true,   // pausar el reloj cuando termina el stream (el tiempo queda guardado)
    autoResumeOnline: true,   // reanudar el reloj cuando vuelves a estar en vivo
    shutdownOnPanelClose: true, // apagar el reloj cuando se cierran todos los paneles de esta PC
    keepAliveWhenLive: true,  // ...pero no mientras el stream está en vivo (se apaga al terminar)
    remoteAccess: false,      // permitir abrir el panel desde otra PC / celular (pide usuario y contraseña)
    modMaxSeconds: 0,         // máximo que un moderador puede sumar o quitar por acción (0 = sin límite)
    // Horas diarias: al cortar el stream se suman solas X horas al tiempo que quedó (para el próximo stream)
    horasDiarias: { on: false, seconds: 4 * 3600, unaVezPorDia: true, ultimoDia: '' },
    descanso: false,          // "Pausar todo": reloj en pausa, pero sigue escuchando subs, bits y donaciones
    descansoSumaTiempo: true, // en descanso, ¿lo que entra suma tiempo al reloj (queda guardado)?
    descansoPrevRunning: false, // ¿el reloj estaba corriendo al pausar todo? (para reanudarlo igual)
    sounds: {                 // sonidos del overlay (se escuchan en OBS)
      enabled: true,
      volume: 60,
      events: { sub: true, bits: true, paypal: true, mercadopago: true, grande: true, multiplicador: true, final: true, fin: true, manual: false },
    },
  },
  rates: {
    paypal:      { enabled: true, amount: 1,    seconds: 60, currency: 'USD', proportional: true, minAmount: 1 },
    mercadopago: { enabled: true, amount: 1000, seconds: 60, currency: 'ARS', proportional: true, minAmount: 500 },
    bits:        { enabled: true, amount: 100,  seconds: 60, proportional: true, minAmount: 100 },
    subs:        { enabled: true, tier1: 300, tier2: 600, tier3: 1500, countResubs: true, countGifts: true },
  },
  multiplier: {
    manual: { active: false, value: 2, until: null, appliesTo: { ...ALL_SOURCES } },
    schedules: [], // { id, start, end, value, appliesTo }
  },
  chat: {
    enabled: true,        // escuchar comandos en el chat de Twitch
    prefix: '!',
    allowMods: true,      // moderadores
    allowLeadMods: true,  // moderadores líderes (supermods)
    allowVips: false,
    users: [],            // usuarios extra con permiso (tu lista de "supermods")
    reply: true,          // responder en el chat
    publicTime: true,     // cualquiera puede usar !tiempo
    maxPerCommand: 0,     // máximo de tiempo por comando de sumar/quitar (0 = sin límite)
  },
  timer: { remainingMs: 4 * 3600 * 1000, running: false },
  stats: {},
  log: [],
  processed: [],
  mpSince: 0,
  secrets: {
    twitch: { clientId: '', clientSecret: '', accessToken: '', refreshToken: '', userId: '', login: '' },
    paypal: { mode: 'live', clientId: '', clientSecret: '', webhookId: '', receiverEmail: '' },
    mercadopago: { accessToken: '', webhookSecret: '', mode: 'polling', pollSeconds: 15 },
    streamelements: { jwt: '' },
    panel: { salt: '', passHash: '', sessions: [], users: [] }, // dueño (admin) y moderadores para acceso remoto
  },
};

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function merge(defaults, value) {
  if (!isPlainObject(defaults)) return value === undefined ? defaults : value;
  const out = {};
  const src = isPlainObject(value) ? value : {};
  for (const key of new Set([...Object.keys(defaults), ...Object.keys(src)])) {
    out[key] = key in defaults ? merge(defaults[key], src[key]) : src[key];
  }
  return out;
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return merge(DEFAULTS, raw);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[datos] No se pudo leer', FILE, '-', err.message);
    return merge(DEFAULTS, {});
  }
}

const store = {
  data: load(),
  _timer: null,
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveNow(), 250);
  },
  saveNow() {
    clearTimeout(this._timer);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, FILE);
  },
  defaults: DEFAULTS,
  file: FILE,
};

module.exports = store;

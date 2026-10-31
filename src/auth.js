// Control de acceso al panel
//  - En la PC del reloj (localhost): dueño, sin contraseña, acceso total.
//  - Desde otra PC / celular:
//      · usuario "admin" + contraseña del dueño  → panel completo
//      · usuarios moderadores creados por el dueño → panel de mods (solo lo indispensable,
//        con los permisos que el dueño les dé). Nunca ven conexiones, tokens, tarifas ni ajustes.
const crypto = require('crypto');

const COOKIE = 'reloj_sesion';
const MAX_AGE = 30 * 24 * 3600; // 30 días
const OWNER_USER = 'admin';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip', 'tailscale-user-login'];
// Básicos: iniciar/pausar · sumar/quitar · fijar tiempo · multiplicadores
// Sensibles (apagados por defecto): tarifas · ver montos de dinero · comandos del chat
const PERMS = ['run', 'add', 'set', 'mult', 'rates', 'money', 'chat'];

// Rutas abiertas (solo lectura, para OBS en otra PC, y la pantalla de entrada)
const OPEN_PATHS = new Set(['/overlay', '/overlay.html', '/sounds.js', '/login', '/api/login', '/favicon.ico',
  // Overlays del podio mensual (solo muestran nombres y totales)
  '/podio', '/podio.html', '/metas', '/metas.html', '/iconos.js', '/marca.css', '/top-general', '/top-general.html', '/reyes', '/reyes.html', '/patitos', '/patitos.html', '/api/podio',
  // Overlays del código de creador
  '/codigo-tarjeta', '/codigo-tarjeta.html', '/codigo-cinta', '/codigo-cinta.html', '/api/codigo',
  // Overlay del tren del hype
  '/hype', '/hype.html', '/api/hype', '/hype-analisis.js']);

// Lo único que puede usar un moderador
const MOD_GET = new Set(['/mod', '/mod.html', '/mod.js', '/panel.css', '/api/mod/data', '/events']);
const MOD_POST = {
  '/api/timer/start': 'run',
  '/api/timer/pause': 'run',
  '/api/timer/add': 'add',
  '/api/timer/set': 'set',
  '/api/multiplier/manual': 'mult',
  '/api/multiplier/schedule': 'mult',
  '/api/config': 'rates', // el servidor solo deja a los mods cambiar las tarifas, no los ajustes generales
  '/api/chat': 'chat',
  '/api/logout': null,
};

const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const cleanName = (n) => String(n || '').trim().toLowerCase();
const validName = (n) => /^[a-z0-9_.-]{3,24}$/.test(n) && n !== OWNER_USER;
const safeEq = (a, b) => {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

function createAuth(store) {
  const p = () => store.data.secrets.panel;
  const users = () => (p().users ||= []);
  const fails = new Map(); // ip -> { n, until }

  // ---------- Dueño ----------
  const hasPassword = () => !!p().passHash;
  function setPassword(pw) {
    const salt = crypto.randomBytes(16).toString('hex');
    Object.assign(p(), { salt, passHash: hash(pw, salt) });
    dropSessions(OWNER_USER);
    store.save();
  }
  function clearPassword() {
    Object.assign(p(), { salt: '', passHash: '' });
    dropSessions(OWNER_USER);
    store.save();
  }

  // ---------- Moderadores ----------
  const findUser = (name) => users().find((u) => u.name === cleanName(name));
  const hasAnyLogin = () => hasPassword() || users().some((u) => u.enabled);
  const cleanPerms = (perms = {}) => Object.fromEntries(PERMS.map((k) => [k, !!perms[k]]));
  const publicUser = (u) => ({ name: u.name, enabled: u.enabled, perms: u.perms, createdAt: u.createdAt, lastLogin: u.lastLogin || null });
  const listUsers = () => users().map(publicUser);

  function addUser(name, pw, perms) {
    name = cleanName(name);
    if (!validName(name)) throw new Error('Usuario inválido: 3 a 24 letras, números, punto, guion o guion bajo (no puede ser "admin")');
    if (findUser(name)) throw new Error('Ese usuario ya existe');
    if (String(pw).length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
    const salt = crypto.randomBytes(16).toString('hex');
    users().push({ name, salt, hash: hash(pw, salt), perms: cleanPerms(perms), enabled: true, createdAt: Date.now() });
    store.save();
  }
  function updateUser(name, { password, perms, enabled }) {
    const u = findUser(name);
    if (!u) throw new Error('Usuario no encontrado');
    if (password !== undefined) {
      if (String(password).length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
      u.salt = crypto.randomBytes(16).toString('hex');
      u.hash = hash(password, u.salt);
      dropSessions(u.name);
    }
    if (perms) u.perms = cleanPerms(perms);
    if (enabled !== undefined) {
      u.enabled = !!enabled;
      if (!u.enabled) dropSessions(u.name);
    }
    store.save();
  }
  function deleteUser(name) {
    const n = cleanName(name);
    p().users = users().filter((u) => u.name !== n);
    dropSessions(n);
    store.save();
  }

  // ---------- Inicio de sesión ----------
  // Devuelve { role, user } o null
  function check(name, pw) {
    name = cleanName(name);
    if (name === OWNER_USER) {
      return hasPassword() && safeEq(hash(pw, p().salt), p().passHash) ? { role: 'owner', user: OWNER_USER } : null;
    }
    const u = findUser(name);
    if (!u || !u.enabled) return null;
    if (!safeEq(hash(pw, u.salt), u.hash)) return null;
    u.lastLogin = Date.now();
    store.save();
    return { role: 'mod', user: u.name };
  }

  function newSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    const list = (p().sessions || []).filter((s) => s.exp > Date.now());
    list.push({ h: sha(token), exp: Date.now() + MAX_AGE * 1000, user });
    p().sessions = list.slice(-50);
    store.save();
    return token;
  }
  function dropSessions(user) {
    p().sessions = (p().sessions || []).filter((s) => s.user !== user);
  }
  function cookieToken(req) {
    const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
    return m ? m[1] : null;
  }
  // Devuelve { role, user, perms } de la sesión, o null
  function sessionOf(req) {
    const t = cookieToken(req);
    if (!t) return null;
    const h = sha(t);
    const s = (p().sessions || []).find((x) => x.h === h && x.exp > Date.now());
    if (!s) return null;
    if (s.user === OWNER_USER) return hasPassword() ? { role: 'owner', user: OWNER_USER } : null;
    const u = findUser(s.user);
    return u && u.enabled ? { role: 'mod', user: u.name, perms: u.perms } : null;
  }
  function logout(req) {
    const t = cookieToken(req);
    if (!t) return;
    const h = sha(t);
    p().sessions = (p().sessions || []).filter((s) => s.h !== h);
    store.save();
  }

  // ---------- Origen de la petición ----------
  function isLocal(req) {
    const ip = req.socket.remoteAddress || '';
    const loop = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!loop) return false;
    if (PROXY_HEADERS.some((h) => req.headers[h])) return false;
    const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    return LOCAL_HOSTS.has(host); // evita ataques de "DNS rebinding"
  }
  // Bloquea que otra página web abierta en el navegador mande órdenes al reloj
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }
  // IP real del visitante. Con un túnel (Cloudflare / ngrok) se usa la que agrega el túnel:
  // cf-connecting-ip o la ÚLTIMA de x-forwarded-for (la primera la puede inventar cualquiera)
  const ipOf = (req) => {
    if (req.headers['cf-connecting-ip']) return String(req.headers['cf-connecting-ip']);
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
    return xff.length ? xff[xff.length - 1] : req.socket.remoteAddress || '';
  };
  function tooManyFails(req) {
    const f = fails.get(ipOf(req));
    return f && f.until > Date.now();
  }
  function registerFail(req) {
    const ip = ipOf(req);
    const f = fails.get(ip) || { n: 0, until: 0 };
    f.n += 1;
    if (f.n >= 5) {
      f.until = Date.now() + 60_000;
      f.n = 0;
    }
    fails.set(ip, f);
  }
  const cookieHeader = (token, secure) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? MAX_AGE : 0}${secure ? '; Secure' : ''}`;

  // ---------- Portero: decide qué puede hacer cada petición ----------
  function modAllowed(req, perms) {
    if (req.method === 'GET') return MOD_GET.has(req.path);
    if (req.method === 'POST' && req.path in MOD_POST) {
      const need = MOD_POST[req.path];
      return !need || !!perms[need];
    }
    if (req.method === 'DELETE' && req.path.startsWith('/api/multiplier/schedule/')) return !!perms.mult;
    return false;
  }

  function guard(req, res) {
    if (req.method !== 'GET' && !sameOrigin(req)) {
      res.json({ error: 'Origen no permitido' }, 403);
      return false;
    }
    if (isLocal(req)) {
      req.localOwner = true;
      req.role = 'owner';
      req.user = 'dueño (esta PC)';
      return true;
    }
    if (OPEN_PATHS.has(req.path) || (req.path === '/events' && req.query.overlay === '1')) return true;
    if (req.method === 'GET' && req.path.startsWith('/sonidos/')) return true; // sonidos propios para el overlay

    const s = sessionOf(req);
    if (!s) {
      if (req.path.startsWith('/api/') || req.path === '/events') res.json({ error: 'Necesitas iniciar sesión', login: true }, 401);
      else res.redirect('/login');
      return false;
    }
    req.role = s.role;
    req.user = s.user;
    req.perms = s.perms;
    if (s.role === 'owner') return true;

    if (modAllowed(req, s.perms)) return true;
    if (req.method === 'GET' && !req.path.startsWith('/api/')) res.redirect('/mod');
    else res.json({ error: 'No tienes permiso para esto' }, 403);
    return false;
  }

  return {
    guard, isLocal, hasPassword, hasAnyLogin, setPassword, clearPassword,
    listUsers, addUser, updateUser, deleteUser, check, newSession, logout,
    tooManyFails, registerFail, cookieHeader, ipOf, OWNER_USER, PERMS,
  };
}

module.exports = { createAuth, COOKIE };

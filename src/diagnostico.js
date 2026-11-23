// 🩺 Diagnóstico de overlays.
//  • Latidos: cada overlay (public/latido.js) avisa cada 10 s que está vivo, desde OBS o desde un navegador.
//  • OBS: con el WebSocket de OBS (Herramientas → Ajustes del servidor WebSocket) el reloj ve las fuentes de navegador
//    de la escena que está al aire, y si una del reloj no responde la arregla sola:
//      1) si usa "localhost", la cambia a 127.0.0.1 (lo que más falla en Windows);
//      2) si no, la refresca sin caché (como el botón de OBS), como mucho una vez cada 3 minutos.
//  • La contraseña del WebSocket se guarda en data/subaton.json → secrets.obs (no se sube a GitHub).
const crypto = require('crypto');

const VIVO_MS = 30000;          // sin latido por 30 s = no está corriendo
const ESPERA_ARREGLO_MS = 180000;
const RECIENTES = 40;

function crearDiagnostico({ store, broadcast, puerto }) {
  const latidos = new Map(); // id → { pagina, url, obs, ua, desde, ultimo, errores, eventos }
  const actividad = [];
  const anotar = (t) => { actividad.unshift({ at: Date.now(), t }); actividad.length = Math.min(actividad.length, RECIENTES); console.log('[Debug] ' + t); };

  // ---------- Latidos de los overlays ----------
  function latido(b, ua) {
    const id = String(b.id || '').slice(0, 20); if (!id) return;
    const pagina = String(b.pagina || '').slice(0, 60);
    const l = latidos.get(id) || { pagina, url: String(b.url || '').slice(0, 200), desde: Number(b.desde) || Date.now(), eventos: [] };
    l.ultimo = Date.now(); l.ua = String(ua || '').slice(0, 200); l.obs = /\bOBS\b|obs-browser/i.test(l.ua);
    l.errores = Array.isArray(b.errores) ? b.errores.slice(-5) : [];
    if (b.evento && b.evento !== 'arrancó') { l.eventos.unshift({ at: Date.now(), t: String(b.evento).slice(0, 160) }); l.eventos.length = Math.min(l.eventos.length, 5); if (b.urgente || /no arranca/.test(b.evento)) anotar(`${pagina}${l.obs ? ' (OBS)' : ''}: ${b.evento}`); }
    latidos.set(id, l);
    if (b.adios) { // se está recargando: esta copia deja de contar, la nueva avisa sola
      l.ultimo = Date.now() - VIVO_MS; // ya no cuenta como viva, pero sus eventos se siguen viendo
    }
    for (const [k, v] of latidos) if (Date.now() - v.ultimo > 10 * 60000) latidos.delete(k); // olvida los que se cerraron hace rato
  }
  const vivos = (pagina, soloObs) => [...latidos.values()].filter((l) => Date.now() - l.ultimo < VIVO_MS && (!pagina || l.pagina === pagina) && (!soloObs || l.obs));

  function recargar(pagina, motivo) {
    broadcast('recargar', { pagina: pagina || '', motivo: motivo || 'pedido desde el panel 🩺 Debug' });
    anotar(pagina ? `🔄 Recargar ${pagina}` : '🔄 Recargar todos los overlays');
  }

  // ---------- OBS WebSocket (protocolo v5) ----------
  const conf = () => (store.data.secrets.obs ||= { host: '127.0.0.1', port: 4455, password: '' });
  const obs = { ws: null, listo: false, error: '', version: '', escena: '', fuentes: [], pend: new Map(), n: 0, timer: null, intento: 0 };
  const arreglos = new Map(); // fuente → última vez que se arregló
  const fallando = new Map(); // fuente → revisiones seguidas sin responder

  function conectarObs() {
    clearTimeout(obs.timer);
    try { obs.ws?.close(); } catch {}
    obs.listo = false;
    const c = conf();
    if (store.data.settings.obsDebug === false) { obs.error = 'apagado'; return; }
    let ws;
    try { ws = new WebSocket(`ws://${c.host || '127.0.0.1'}:${Number(c.port) || 4455}`); } catch (e) { obs.error = e.message; return reintentar(); }
    obs.ws = ws;
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.op === 0) { // Hello
        const d = { rpcVersion: 1, eventSubscriptions: 0 };
        if (m.d.authentication) {
          if (!c.password) { obs.error = 'OBS pide contraseña: cópiala de Herramientas → Ajustes del servidor WebSocket → Mostrar información de conexión'; ws.close(); return; }
          const secreto = crypto.createHash('sha256').update(c.password + m.d.authentication.salt).digest('base64');
          d.authentication = crypto.createHash('sha256').update(secreto + m.d.authentication.challenge).digest('base64');
        }
        obs.version = m.d.obsWebSocketVersion || '';
        ws.send(JSON.stringify({ op: 1, d }));
      } else if (m.op === 2) { obs.listo = true; obs.error = ''; obs.intento = 0; anotar('🔌 Conectado a OBS'); revisar().catch(() => {}); }
      else if (m.op === 7) { const p = obs.pend.get(m.d.requestId); if (p) { obs.pend.delete(m.d.requestId); m.d.requestStatus.result ? p.ok(m.d.responseData || {}) : p.mal(new Error(m.d.requestStatus.comment || 'OBS no pudo')); } }
    };
    ws.onclose = (ev) => {
      if (obs.ws !== ws) return;
      const antes = obs.listo; obs.listo = false;
      if (ev.code === 4009) obs.error = 'La contraseña del WebSocket de OBS no es correcta';
      else if (!obs.error || antes) obs.error = 'OBS no está abierto o su WebSocket está apagado (Herramientas → Ajustes del servidor WebSocket → Habilitar)';
      for (const p of obs.pend.values()) p.mal(new Error('se cortó la conexión con OBS'));
      obs.pend.clear();
      if (antes) anotar('🔌 Se perdió la conexión con OBS');
      reintentar();
    };
    ws.onerror = () => {};
  }
  function reintentar() { clearTimeout(obs.timer); obs.timer = setTimeout(conectarObs, Math.min(60, 5 * 2 ** obs.intento++) * 1000); }
  function pedir(requestType, requestData) {
    if (!obs.listo) return Promise.reject(new Error('OBS no está conectado'));
    const requestId = 'r' + ++obs.n;
    return new Promise((ok, mal) => {
      obs.pend.set(requestId, { ok, mal });
      obs.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
      setTimeout(() => { if (obs.pend.delete(requestId)) mal(new Error('OBS no respondió')); }, 8000);
    });
  }

  // ¿Esa dirección es del reloj? (localhost, 127.0.0.1 o la IP de esta PC, con el puerto del reloj)
  function delReloj(url) {
    try { const u = new URL(url); return /^https?:$/.test(u.protocol) && String(u.port || 80) === String(puerto) && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])|100\.)/.test(u.hostname)); } catch { return false; }
  }
  // Fuentes visibles en la escena al aire (entra en escenas y grupos anidados)
  async function fuentesAlAire() {
    const { currentProgramSceneName: escena } = await pedir('GetCurrentProgramScene');
    obs.escena = escena;
    const vistas = new Map();
    async function recorrer(nombre, grupo, nivel) {
      if (nivel > 4) return;
      const { sceneItems = [] } = await pedir(grupo ? 'GetGroupSceneItemList' : 'GetSceneItemList', { sceneName: nombre });
      for (const it of sceneItems) {
        if (!it.sceneItemEnabled) continue;
        if (it.isGroup) await recorrer(it.sourceName, true, nivel + 1);
        else if (it.sourceType === 'OBS_SOURCE_TYPE_SCENE') await recorrer(it.sourceName, false, nivel + 1);
        else if (it.inputKind === 'browser_source') vistas.set(it.sourceName, true);
      }
    }
    await recorrer(escena, false, 0);
    const { inputs = [] } = await pedir('GetInputList', { inputKind: 'browser_source' });
    const out = [];
    for (const i of inputs) {
      const { inputSettings: s = {} } = await pedir('GetInputSettings', { inputName: i.inputName });
      out.push({ nombre: i.inputName, url: s.url || '', archivoLocal: !!s.is_local_file, alAire: vistas.has(i.inputName) });
    }
    return out;
  }

  // ¿Esa fuente de OBS está corriendo? Si OBS ya mandó latidos, se exige el de OBS (uno abierto en un navegador no cuenta)
  function conEstado(f) {
    if (f.archivoLocal || !delReloj(f.url)) return { ...f, delReloj: false };
    const u = new URL(f.url), pagina = u.pathname.replace(/\.html$/, '') || '/';
    const hayObs = [...latidos.values()].some((l) => l.obs);
    const ok = hayObs ? vivos(pagina, true).length > 0 : vivos(pagina).some((l) => l.url === u.pathname + u.search);
    return { ...f, delReloj: true, pagina, ok };
  }

  // Revisa las fuentes del reloj que están al aire y arregla las que no responden
  async function revisar(forzar = false) {
    if (!obs.listo) return estado();
    const auto = store.data.settings.obsAutoArreglo !== false;
    const fuentes = await fuentesAlAire();
    obs.fuentes = fuentes.map((f) => {
      const x = conEstado(f);
      if (!x.delReloj) return x;
      x.fallas = x.ok || !x.alAire ? 0 : (fallando.get(f.nombre) || 0) + 1;
      fallando.set(f.nombre, x.fallas);
      return x;
    });
    for (const f of obs.fuentes) {
      if (!f.delReloj || !f.alAire || f.ok) continue;
      if (!(auto || forzar)) continue;
      if (!forzar && f.fallas < 2) continue; // recién cargando (ej. cambió la escena): se espera a la próxima revisión
      const ultima = arreglos.get(f.nombre) || 0;
      if (!forzar && Date.now() - ultima < ESPERA_ARREGLO_MS) continue;
      arreglos.set(f.nombre, Date.now());
      try {
        const u = new URL(f.url);
        if (u.hostname === 'localhost') {
          u.hostname = '127.0.0.1';
          await pedir('SetInputSettings', { inputName: f.nombre, inputSettings: { url: u.toString() }, overlay: true });
          anotar(`🛠️ "${f.nombre}" no respondía: se cambió localhost por 127.0.0.1`);
        } else {
          await pedir('PressInputPropertiesButton', { inputName: f.nombre, propertyName: 'refreshnocache' });
          anotar(`🛠️ "${f.nombre}" no respondía: se refrescó en OBS`);
        }
      } catch (e) { anotar(`⚠️ No se pudo arreglar "${f.nombre}": ${e.message}`); }
    }
    return estado();
  }
  async function arreglar(nombre) {
    const f = obs.fuentes.find((x) => x.nombre === nombre);
    if (!f) throw new Error('No encuentro esa fuente en OBS');
    const u = new URL(f.url);
    if (u.hostname === 'localhost') { u.hostname = '127.0.0.1'; await pedir('SetInputSettings', { inputName: nombre, inputSettings: { url: u.toString() }, overlay: true }); }
    else await pedir('PressInputPropertiesButton', { inputName: nombre, propertyName: 'refreshnocache' });
    arreglos.set(nombre, Date.now());
    anotar(`🛠️ "${nombre}" refrescada desde el panel`);
    setTimeout(() => revisar().catch(() => {}), 5000);
    return estado();
  }

  function estado() {
    const c = conf();
    const paginas = new Map();
    for (const l of latidos.values()) {
      const p = paginas.get(l.pagina) || { pagina: l.pagina, obs: 0, navegador: 0, ultimo: 0, errores: [], eventos: [] };
      if (Date.now() - l.ultimo < VIVO_MS) l.obs ? p.obs++ : p.navegador++;
      p.ultimo = Math.max(p.ultimo, l.ultimo);
      p.errores.push(...(l.errores || [])); p.eventos.push(...(l.eventos || []));
      paginas.set(l.pagina, p);
    }
    for (const p of paginas.values()) { p.errores = p.errores.sort((a, b) => b.at - a.at).slice(0, 3); p.eventos = p.eventos.sort((a, b) => b.at - a.at).slice(0, 3); }
    return {
      paginas: [...paginas.values()],
      obs: { conectado: obs.listo, error: obs.listo ? '' : obs.error, version: obs.version, escena: obs.escena, fuentes: obs.fuentes.map((f) => ({ ...conEstado(f), fallas: f.fallas })), host: c.host, port: c.port, tienePassword: !!c.password, auto: store.data.settings.obsAutoArreglo !== false, on: store.data.settings.obsDebug !== false },
      actividad: actividad.slice(0, 25),
    };
  }
  function setConfig(b = {}) {
    const c = conf();
    if ('host' in b) c.host = String(b.host || '127.0.0.1').trim().slice(0, 60) || '127.0.0.1';
    if ('port' in b) c.port = Math.min(65535, Math.max(1, Number(b.port) || 4455));
    if (b.password != null && b.password !== '') c.password = String(b.password);
    if (b.quitarPassword) c.password = '';
    if ('auto' in b) store.data.settings.obsAutoArreglo = !!b.auto;
    if ('on' in b) store.data.settings.obsDebug = !!b.on;
    store.save();
    obs.intento = 0; obs.error = '';
    conectarObs();
    return estado();
  }

  function iniciar() {
    conectarObs();
    setInterval(() => { if (obs.listo) revisar().catch((e) => { obs.error = e.message; }); }, 20000);
  }

  return { iniciar, latido, recargar, revisar, arreglar, estado, setConfig, vivos };
}

module.exports = { crearDiagnostico };

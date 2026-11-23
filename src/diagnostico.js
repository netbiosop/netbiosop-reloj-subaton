// 🩺 Debug de overlays. No hace nada solo: todo pasa cuando tocas un botón del panel /diagnostico.
//  • Revisar: les pregunta a los overlays abiertos si están vivos (responden en 1–2 s, desde OBS o desde un navegador).
//    Si configuraste el WebSocket de OBS, además mira las fuentes de navegador de la escena al aire.
//  • Recargar: recarga un overlay (o todos) dentro de OBS.
//  • Arreglar: en una fuente de OBS del reloj, cambia "localhost" por 127.0.0.1 o la refresca como el botón de OBS.
//  • La contraseña del WebSocket se guarda en data/subaton.json → secrets.obs (no se sube a GitHub).
const crypto = require('crypto');

const ESPERA_RESPUESTAS_MS = 2500;
const RECIENTES = 40;

function crearDiagnostico({ store, broadcast, puerto }) {
  let respuestas = new Map(); // id → { pagina, url, obs, errores, eventos } (de la última revisión)
  let ultimaRevision = 0;
  let fuentesObs = [];
  const obsInfo = { conectado: false, error: '', version: '', escena: '' };
  const actividad = [];
  const anotar = (t) => { actividad.unshift({ at: Date.now(), t }); actividad.length = Math.min(actividad.length, RECIENTES); console.log('[Debug] ' + t); };

  // Un overlay respondió (o avisó que se recarga)
  function latido(b, ua) {
    const id = String(b.id || '').slice(0, 20); if (!id) return;
    const l = respuestas.get(id) || { pagina: String(b.pagina || '').slice(0, 60), url: String(b.url || '').slice(0, 200), eventos: [] };
    l.at = Date.now(); l.obs = /\bOBS\b|obs-browser/i.test(String(ua || ''));
    l.errores = Array.isArray(b.errores) ? b.errores.slice(-5) : [];
    if (b.evento) l.eventos.unshift({ at: Date.now(), t: String(b.evento).slice(0, 160) });
    respuestas.set(id, l);
  }

  function recargar(pagina) {
    broadcast('recargar', { pagina: pagina || '' });
    anotar(pagina ? `🔄 Recargar ${pagina}` : '🔄 Recargar todos los overlays');
  }

  // ---------- OBS WebSocket (protocolo v5), solo mientras dura una revisión ----------
  const conf = () => (store.data.secrets.obs ||= { host: '127.0.0.1', port: 4455, password: '' });
  function abrirObs() {
    const c = conf();
    return new Promise((ok, mal) => {
      let ws, n = 0;
      const pend = new Map();
      const fin = setTimeout(() => { try { ws.close(); } catch {} mal(new Error('OBS no respondió: ¿está abierto y con el WebSocket habilitado?')); }, 6000);
      try { ws = new WebSocket(`ws://${c.host || '127.0.0.1'}:${Number(c.port) || 4455}`); } catch (e) { clearTimeout(fin); return mal(e); }
      const pedir = (requestType, requestData) => new Promise((ok2, mal2) => {
        const requestId = 'r' + ++n; pend.set(requestId, { ok2, mal2 });
        ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
        setTimeout(() => { if (pend.delete(requestId)) mal2(new Error('OBS no respondió')); }, 8000);
      });
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.op === 0) {
          const d = { rpcVersion: 1, eventSubscriptions: 0 };
          if (m.d.authentication) {
            if (!c.password) { clearTimeout(fin); ws.close(); return mal(new Error('OBS pide contraseña: cópiala de Herramientas → Ajustes del servidor WebSocket → Mostrar información de conexión')); }
            const secreto = crypto.createHash('sha256').update(c.password + m.d.authentication.salt).digest('base64');
            d.authentication = crypto.createHash('sha256').update(secreto + m.d.authentication.challenge).digest('base64');
          }
          obsInfo.version = m.d.obsWebSocketVersion || '';
          ws.send(JSON.stringify({ op: 1, d }));
        } else if (m.op === 2) { clearTimeout(fin); ok({ pedir, cerrar: () => { try { ws.close(); } catch {} } }); }
        else if (m.op === 7) { const p = pend.get(m.d.requestId); if (p) { pend.delete(m.d.requestId); m.d.requestStatus.result ? p.ok2(m.d.responseData || {}) : p.mal2(new Error(m.d.requestStatus.comment || 'OBS no pudo')); } }
      };
      ws.onclose = (ev) => {
        clearTimeout(fin);
        for (const p of pend.values()) p.mal2(new Error('se cortó la conexión con OBS'));
        mal(new Error(ev.code === 4009 ? 'La contraseña del WebSocket de OBS no es correcta' : 'OBS no está abierto o su WebSocket está apagado (Herramientas → Ajustes del servidor WebSocket → Habilitar)'));
      };
      ws.onerror = () => {};
    });
  }

  // ¿Esa dirección es del reloj? (localhost, 127.0.0.1 o una IP de la red, con el puerto del reloj)
  function delReloj(url) {
    try { const u = new URL(url); return /^https?:$/.test(u.protocol) && String(u.port || 80) === String(puerto) && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])|100\.)/.test(u.hostname)); } catch { return false; }
  }
  // Fuentes de navegador, marcando las que están visibles en la escena al aire (entra en escenas y grupos anidados)
  async function leerFuentes(pedir) {
    const { currentProgramSceneName: escena } = await pedir('GetCurrentProgramScene');
    obsInfo.escena = escena;
    const alAire = new Set();
    async function recorrer(nombre, grupo, nivel) {
      if (nivel > 4) return;
      const { sceneItems = [] } = await pedir(grupo ? 'GetGroupSceneItemList' : 'GetSceneItemList', { sceneName: nombre });
      for (const it of sceneItems) {
        if (!it.sceneItemEnabled) continue;
        if (it.isGroup) await recorrer(it.sourceName, true, nivel + 1);
        else if (it.sourceType === 'OBS_SOURCE_TYPE_SCENE') await recorrer(it.sourceName, false, nivel + 1);
        else if (it.inputKind === 'browser_source') alAire.add(it.sourceName);
      }
    }
    await recorrer(escena, false, 0);
    const { inputs = [] } = await pedir('GetInputList', { inputKind: 'browser_source' });
    const out = [];
    for (const i of inputs) {
      const { inputSettings: s = {} } = await pedir('GetInputSettings', { inputName: i.inputName });
      out.push({ nombre: i.inputName, url: s.url || '', archivoLocal: !!s.is_local_file, alAire: alAire.has(i.inputName) });
    }
    return out;
  }
  // ¿Respondió el overlay de esa fuente en la última revisión?
  function conEstado(f) {
    if (f.archivoLocal || !delReloj(f.url)) return { ...f, delReloj: false };
    const u = new URL(f.url), pagina = u.pathname.replace(/\.html$/, '') || '/';
    const lista = [...respuestas.values()].filter((l) => l.pagina === pagina);
    const hayObs = [...respuestas.values()].some((l) => l.obs);
    const ok = hayObs ? lista.some((l) => l.obs) : lista.some((l) => l.url === u.pathname + u.search);
    return { ...f, delReloj: true, pagina, ok };
  }
  async function arreglarFuente(pedir, f) {
    const u = new URL(f.url);
    if (u.hostname === 'localhost') {
      u.hostname = '127.0.0.1';
      await pedir('SetInputSettings', { inputName: f.nombre, inputSettings: { url: u.toString() }, overlay: true });
      anotar(`🛠️ "${f.nombre}": se cambió localhost por 127.0.0.1`);
    } else {
      await pedir('PressInputPropertiesButton', { inputName: f.nombre, propertyName: 'refreshnocache' });
      anotar(`🛠️ "${f.nombre}": se refrescó en OBS`);
    }
  }

  // Botón "Revisar": pregunta a los overlays y (si está configurado) mira OBS
  async function revisar() {
    respuestas = new Map();
    broadcast('debug-revisar', {});
    await new Promise((ok) => setTimeout(ok, ESPERA_RESPUESTAS_MS));
    ultimaRevision = Date.now();
    if (conf().password) {
      let obs;
      try {
        obs = await abrirObs();
        fuentesObs = await leerFuentes(obs.pedir);
        obsInfo.conectado = true; obsInfo.error = '';
      } catch (e) { obsInfo.conectado = false; obsInfo.error = e.message; fuentesObs = []; }
      finally { obs?.cerrar(); }
    } else { obsInfo.conectado = false; obsInfo.error = ''; fuentesObs = []; }
    const n = respuestas.size, enObs = [...respuestas.values()].filter((l) => l.obs).length;
    anotar(`🔍 Revisión: ${n} overlay${n === 1 ? '' : 's'} respondi${n === 1 ? 'ó' : 'eron'} (${enObs} en OBS)${obsInfo.conectado ? ` · OBS: escena "${obsInfo.escena}"` : ''}`);
    return estado();
  }

  // Botón "🛠️ Arreglar" de una fuente de OBS
  async function arreglar(nombre) {
    const obs = await abrirObs();
    try {
      const fuentes = await leerFuentes(obs.pedir);
      const f = fuentes.find((x) => x.nombre === nombre);
      if (!f) throw new Error('No encuentro esa fuente en OBS');
      if (!delReloj(f.url)) throw new Error('Esa fuente no es del reloj');
      await arreglarFuente(obs.pedir, f);
      fuentesObs = await leerFuentes(obs.pedir);
    } finally { obs.cerrar(); }
    return estado();
  }

  function estado() {
    const c = conf();
    const paginas = new Map();
    for (const l of respuestas.values()) {
      const p = paginas.get(l.pagina) || { pagina: l.pagina, obs: 0, navegador: 0, errores: [], eventos: [] };
      l.obs ? p.obs++ : p.navegador++;
      p.errores.push(...(l.errores || [])); p.eventos.push(...(l.eventos || []));
      paginas.set(l.pagina, p);
    }
    for (const p of paginas.values()) { p.errores = p.errores.sort((a, b) => b.at - a.at).slice(0, 3); p.eventos = p.eventos.sort((a, b) => b.at - a.at).slice(0, 3); }
    return {
      ultimaRevision, paginas: [...paginas.values()],
      obs: { ...obsInfo, fuentes: fuentesObs.map(conEstado), host: c.host, port: c.port, tienePassword: !!c.password },
      actividad: actividad.slice(0, 25),
    };
  }
  function setConfig(b = {}) {
    const c = conf();
    if ('host' in b) c.host = String(b.host || '127.0.0.1').trim().slice(0, 60) || '127.0.0.1';
    if ('port' in b) c.port = Math.min(65535, Math.max(1, Number(b.port) || 4455));
    if (b.password != null && b.password !== '') c.password = String(b.password);
    if (b.quitarPassword) c.password = '';
    store.save();
    return estado();
  }

  return { latido, recargar, revisar, arreglar, estado, setConfig };
}

module.exports = { crearDiagnostico };

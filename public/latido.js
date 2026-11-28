// Vigilante de overlays (para el panel 🩺 Debug). No hace nada solo:
//  • Guarda los errores que tenga el overlay.
//  • Cuando tocas "Revisar" en el panel 🩺 Debug, responde que está vivo (y desde dónde: OBS o navegador).
//  • Cuando tocas "Recargar" en el panel, se recarga.
//  • Modo liviano (Podio y Metas → "Animaciones de fondo" apagado): en Metas, Top general, Podio y Reyes
//    frena las animaciones que se repiten sin fin (brillos, rayas, rebotes). Las que pasan una vez (un aporte nuevo) siguen.
//    En una fuente de OBS se puede forzar con ?animado=1 o ?liviano=1 al final de la dirección.
(() => {
  if (window.__latido) return; window.__latido = true;
  const pagina = location.pathname.replace(/\.html$/, '') || '/';
  const id = Math.random().toString(36).slice(2, 10);
  const inicio = Date.now();
  const errores = [];

  const responder = (evento) => fetch('/api/latido', {
    method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, pagina, url: location.pathname + location.search, desde: inicio, errores: errores.slice(-5), evento: evento || '' }),
  }).catch(() => {});

  const error = (t) => { errores.push({ at: Date.now(), t: String(t).slice(0, 200) }); if (errores.length > 20) errores.shift(); };
  window.addEventListener('error', (e) => { if (e.message) error(e.message + (e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : '')); }, true);
  window.addEventListener('unhandledrejection', (e) => error('promesa: ' + (e.reason?.message || e.reason)));

  // ---------- Modo liviano ----------
  const CON_LIVIANO = ['/metas', '/top-general', '/podio', '/reyes'];
  const q = new URLSearchParams(location.search);
  const forzado = q.has('animado') ? false : q.has('liviano') ? true : null;
  let liviano = false;
  const frenadas = new Set();
  const esInfinita = (a) => { try { return a.effect && a.effect.getComputedTiming().iterations === Infinity; } catch { return false; } };
  function frenar(a) { if (!liviano || !esInfinita(a)) return; a.pause(); a.currentTime = 0; frenadas.add(a); }
  function aplicarLiviano(si) {
    liviano = forzado ?? si;
    document.documentElement.classList.toggle('liviano', liviano);
    if (liviano) { for (const a of document.getAnimations()) frenar(a); }
    else { for (const a of frenadas) { try { a.play(); } catch {} } frenadas.clear(); }
  }
  if (CON_LIVIANO.includes(pagina)) {
    document.addEventListener('animationstart', () => { if (liviano) for (const a of document.getAnimations()) if (!frenadas.has(a)) frenar(a); }, true);
    if (forzado !== null) aplicarLiviano(forzado);
    fetch('/api/estilo', { cache: 'no-store' }).then((r) => r.json()).then((j) => aplicarLiviano(!j.animado)).catch(() => aplicarLiviano(true));
  }

  try {
    new (window.EventoVivo || EventSource)('/events?overlay=1').onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      const p = m.payload || {};
      if (m.type === 'debug-revisar') responder();
      else if (m.type === 'estilo' && CON_LIVIANO.includes(pagina)) aplicarLiviano(!p.animado);
      else if (m.type === 'recargar' && (!p.pagina || p.pagina === pagina)) responder('recargado desde el panel 🩺 Debug').finally(() => setTimeout(() => location.reload(), 300));
    };
  } catch {}
})();

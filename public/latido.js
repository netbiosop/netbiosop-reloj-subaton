// Vigilante de overlays (para el panel 🩺 Debug). No hace nada solo:
//  • Guarda los errores que tenga el overlay.
//  • Cuando tocas "Revisar" en el panel 🩺 Debug, responde que está vivo (y desde dónde: OBS o navegador).
//  • Cuando tocas "Recargar" en el panel, se recarga.
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

  try {
    new EventSource('/events?overlay=1').onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      const p = m.payload || {};
      if (m.type === 'debug-revisar') responder();
      else if (m.type === 'recargar' && (!p.pagina || p.pagina === pagina)) responder('recargado desde el panel 🩺 Debug').finally(() => setTimeout(() => location.reload(), 300));
    };
  } catch {}
})();

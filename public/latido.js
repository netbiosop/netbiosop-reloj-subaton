// Vigilante de overlays: va dentro de cada overlay (OBS o navegador).
//  • Cada 10 s avisa al reloj "estoy vivo" (/api/latido): así el panel 🩺 Debug sabe cuáles corren en OBS.
//  • Si el overlay falla al arrancar (un error en los primeros segundos), se recarga solo (hasta 3 veces seguidas).
//  • Si el reloj se cerró y vuelve, se recarga para arrancar limpio con los datos nuevos.
//  • Obedece "Recargar" desde el panel 🩺 Debug.
(() => {
  if (window.__latido) return; window.__latido = true;
  const pagina = location.pathname.replace(/\.html$/, '') || '/';
  const id = Math.random().toString(36).slice(2, 10);
  const inicio = Date.now();
  const errores = [];
  const CLAVE = 'latido-recargas:' + pagina;
  const leer = () => { try { return JSON.parse(sessionStorage.getItem(CLAVE) || '{"n":0,"at":0}'); } catch { return { n: 0, at: 0 }; } };
  const escribir = (v) => { try { sessionStorage.setItem(CLAVE, JSON.stringify(v)); } catch {} };

  function recargar(motivo) {
    const r = leer();
    const n = Date.now() - r.at < 120000 ? r.n + 1 : 1; // cuenta las recargas seguidas (en 2 min)
    if (n > 3) { avisar('no arranca después de 3 intentos: ' + motivo); return; } // no entrar en un bucle
    escribir({ n, at: Date.now() });
    avisar('se recarga solo: ' + motivo, true, true).finally(() => setTimeout(() => location.reload(), 300));
  }
  // si estuvo 2 minutos bien, se olvidan los intentos anteriores
  setTimeout(() => escribir({ n: 0, at: 0 }), 120000);

  function avisar(evento, urgente, adios) {
    return fetch('/api/latido', {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, pagina, url: location.pathname + location.search, desde: inicio, errores: errores.slice(-5), evento: evento || '', urgente: !!urgente, adios: !!adios }),
    }).catch(() => {});
  }

  function error(texto) {
    errores.push({ at: Date.now(), t: String(texto).slice(0, 200) });
    if (errores.length > 20) errores.shift();
    avisar('error: ' + String(texto).slice(0, 120));
    if (Date.now() - inicio < 15000) setTimeout(() => recargar('falló al arrancar (' + String(texto).slice(0, 80) + ')'), 4000);
  }
  window.addEventListener('error', (e) => { if (e.message) error(e.message + (e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : '')); }, true);
  window.addEventListener('unhandledrejection', (e) => error('promesa: ' + (e.reason?.message || e.reason)));

  avisar('arrancó');
  setInterval(() => avisar(), 10000);

  // Órdenes del reloj y reconexión
  let cayo = false;
  try {
    const es = new EventSource('/events?overlay=1');
    es.onerror = () => { cayo = true; };
    es.onopen = () => { if (cayo) { cayo = false; recargar('el reloj volvió a estar disponible'); } };
    es.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'recargar') {
        const p = m.payload || {};
        if (!p.pagina || p.pagina === pagina || p.id === id) { escribir({ n: 0, at: 0 }); recargar(p.motivo || 'pedido desde el panel 🩺 Debug'); }
      }
    };
  } catch {}
})();

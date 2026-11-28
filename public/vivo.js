// Avisos en vivo para los overlays. Usa WebSocket porque el navegador de OBS deja abiertas solo 6 conexiones
// a la vez contra el reloj: con EventSource, a partir del 4.º o 5.º overlay las fuentes quedaban sin cargar
// o sin actualizarse. Se usa igual que EventSource (onmessage, onopen, onerror, close) y se reconecta solo.
(function () {
  if (window.EventoVivo) return;
  function EventoVivo(urlSse) {
    if (!('WebSocket' in window)) return new EventSource(urlSse);
    const yo = this;
    let ws = null, cerrado = false, espera = 1000;
    yo.readyState = 0;
    yo.onmessage = yo.onopen = yo.onerror = null;
    const oyentes = { message: [], open: [], error: [] };
    yo.addEventListener = (t, f) => (oyentes[t] || (oyentes[t] = [])).push(f);
    yo.removeEventListener = (t, f) => { oyentes[t] = (oyentes[t] || []).filter((g) => g !== f); };
    const avisar = (t, ev) => { try { yo['on' + t] && yo['on' + t](ev); } catch (e) { console.error(e); } for (const f of oyentes[t] || []) { try { f(ev); } catch (e) { console.error(e); } } };
    function conectar() {
      if (cerrado) return;
      try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/vivo'); }
      catch { return setTimeout(conectar, espera); }
      ws.onopen = () => { espera = 1000; yo.readyState = 1; avisar('open', { type: 'open' }); };
      ws.onmessage = (m) => { if (typeof m.data === 'string' && m.data) avisar('message', { type: 'message', data: m.data }); };
      ws.onclose = () => {
        if (cerrado) return;
        yo.readyState = 0; avisar('error', { type: 'error' });
        setTimeout(conectar, espera); espera = Math.min(espera * 1.5, 5000);
      };
    }
    yo.close = () => { cerrado = true; yo.readyState = 2; try { ws && ws.close(); } catch {} };
    conectar();
  }
  window.EventoVivo = EventoVivo;
})();

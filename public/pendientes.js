// Aviso "¿Es donación?": aparece abajo a la derecha en el menú, el panel del reloj y el panel del podio
// cuando entra una donación de Mercado Pago o PayPal que espera tu respuesta.
(() => {
  const css = `
  #pend{position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;gap:10px;max-width:min(380px,calc(100vw - 32px));font:14px/1.4 Inter,system-ui,sans-serif}
  .pend{background:#1b1826;color:#ecebf2;border:2px solid #ffb547;border-radius:14px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.55);animation:pend-entra .35s ease}
  .pend h4{margin:0 0 4px;font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:#ffb547}
  .pend .q{font-size:15px}
  .pend .q b{font-size:17px}
  .pend .det{font-size:12px;color:#9a96ab;margin-top:2px;word-break:break-word}
  .pend .bt{display:flex;gap:8px;margin-top:10px}
  .pend button{flex:1;font:inherit;font-weight:700;border-radius:10px;padding:9px 8px;cursor:pointer;border:1px solid transparent}
  .pend .si{background:#3ddc97;color:#06210f} .pend .no{background:#2a2535;color:#ff8a9b;border-color:#ff5d73}
  .pend label{display:flex;gap:6px;align-items:center;font-size:12px;color:#9a96ab;margin-top:8px;cursor:pointer}
  .pend .err{color:#ff5d73;font-size:12px;margin-top:6px}
  @keyframes pend-entra{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`;
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const caja = document.createElement('div'); caja.id = 'pend';
  document.body.appendChild(caja); // el script va al final del <body> en las tres páginas

  const tituloBase = document.title;
  let conocidas = new Set(), primera = true;
  function sonar() {
    try {
      const a = new (window.AudioContext || window.webkitAudioContext)();
      [880, 1175].forEach((f, i) => { const o = a.createOscillator(), g = a.createGain(); o.frequency.value = f; o.connect(g); g.connect(a.destination);
        const t = a.currentTime + i * 0.18; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16); o.start(t); o.stop(t + 0.17); });
    } catch (err) { console.warn('[Aviso de donación] No se pudo sonar:', err.message); } // el navegador puede bloquear el audio
  }
  function pintar(lista) {
    const nuevas = lista.filter((p) => !conocidas.has(p.key));
    if (nuevas.length && !primera) sonar();
    primera = false;
    conocidas = new Set(lista.map((p) => p.key));
    document.title = lista.length ? `(${lista.length}) ¿Donación? · ${tituloBase}` : tituloBase;
    caja.innerHTML = lista.map((p) => {
      const ev = p.ev, plat = ev.source === 'paypal' ? 'PayPal' : 'Mercado Pago';
      const h = new Date(p.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      return `<div class="pend" data-key="${esc(p.key)}">
        <h4>💸 ¿Es una donación? · ${plat}</h4>
        <div class="q"><b>${esc(ev.user)}</b> · ${esc(Number(ev.amount).toLocaleString('es'))} ${esc(ev.currency || '')}</div>
        <div class="det">${h}${ev.message ? ' · “' + esc(String(ev.message).slice(0, 120)) + '”' : ''}</div>
        <div class="bt"><button class="si" data-r="1">✔ Es donación</button><button class="no" data-r="0">✖ No es donación</button></div>
        <label><input type="checkbox" data-siempre> ${ev.payer ? 'Lo mismo para sus próximos pagos (no preguntar más)' : 'Si es donación, que sus próximas cuenten solas'}</label>
        <div class="err"></div></div>`;
    }).join('');
  }
  caja.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    const card = b.closest('.pend'), si = b.dataset.r === '1';
    card.querySelectorAll('button').forEach((x) => (x.disabled = true));
    try {
      const r = await fetch('/api/pendientes/decidir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: card.dataset.key, esDonacion: si, siempre: card.querySelector('[data-siempre]').checked }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || 'Error ' + r.status);
      card.remove();
    } catch (err) { card.querySelector('.err').textContent = err.message; card.querySelectorAll('button').forEach((x) => (x.disabled = false)); }
  });
  async function cargar() {
    try { const j = await (await fetch('/api/pendientes', { cache: 'no-store' })).json(); pintar(j.lista || []); }
    catch (err) { console.warn('[Aviso de donación] No se pudo leer la lista:', err.message); }
  }
  cargar();
  setInterval(cargar, 30000); // respaldo: los avisos llegan al instante por /events
  // usa la conexión /events de la página: Chrome deja 6 por servidor y con una segunda por pestaña el panel se cuelga
  (function escuchar() {
    if (!window.__es) return setTimeout(escuchar, 300); // el panel del reloj la abre después de cargar sus datos
    window.__es.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.type === 'pendientes') pintar(m.payload.lista || []); });
  })();
})();

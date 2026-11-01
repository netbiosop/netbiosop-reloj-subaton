// Lo que comparten la página del multichat y sus ajustes: etiquetas de plataforma, armado de cada mensaje y conexión en vivo.
window.Multichat = (() => {
  const PLAT = {
    twitch: { nombre: 'Twitch', corto: 'TW', color: '#9146ff', texto: '#fff' },
    kick: { nombre: 'Kick', corto: 'KICK', color: '#53fc18', texto: '#0b0e0f' },
    youtube: { nombre: 'YouTube', corto: 'YT', color: '#ff0033', texto: '#fff' },
    tiktok: { nombre: 'TikTok', corto: 'TT', color: '#fe2c55', texto: '#fff', borde: '#25f4ee' },
  };
  const ROL = { 'dueño': '👑', mod: '🛡️', vip: '💎', sub: '⭐' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // los colores muy oscuros no se leen sobre fondo oscuro
  function legible(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex || '#ddd';
    const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const luz = (0.299 * r + 0.587 * g + 0.114 * b);
    if (luz >= 110) return '#' + m[1];
    const k = 110 / Math.max(luz, 1), f = (v) => Math.min(255, Math.round(v * k + 40)).toString(16).padStart(2, '0');
    return '#' + f(r) + f(g) + f(b);
  }
  function etiqueta(p, largo = false) {
    const x = PLAT[p] || { nombre: p, corto: p, color: '#666', texto: '#fff' };
    return `<span class="mc-plat mc-${esc(p)}" style="background:${x.color};color:${x.texto}${x.borde ? `;box-shadow:inset -3px 0 0 ${x.borde}` : ''}">${esc(largo ? x.nombre : x.corto)}</span>`;
  }
  function cuerpo(m) {
    return (m.partes || []).map((p) => (p.t === 'emote' && p.url ? `<img class="mc-emote" src="${esc(p.url)}" alt="${esc(p.v)}" title="${esc(p.v)}" onerror="this.replaceWith(this.alt)">` : esc(p.v))).join('');
  }
  function elemento(m, { conPlataforma = true } = {}) {
    const div = document.createElement('div');
    div.className = `mc-msg mc-tipo-${m.tipo || 'mensaje'} mc-p-${m.plataforma}`;
    div.dataset.plataforma = m.plataforma;
    const extra = m.extra ? `<span class="mc-extra">${esc(m.extra)}</span> ` : '';
    div.innerHTML = `${conPlataforma ? etiqueta(m.plataforma) + ' ' : ''}${m.rol && ROL[m.rol] ? `<span class="mc-rol" title="${esc(m.rol)}">${ROL[m.rol]}</span>` : ''}<span class="mc-autor" style="color:${esc(legible(m.color))}">${esc(m.autor)}</span><span class="mc-sep">:</span> ${extra}<span class="mc-texto">${cuerpo(m)}</span>`;
    return div;
  }
  // Conexión en vivo: llama a alMensaje(m), alEstado(estado), alConfig(config)
  function conectar({ alMensaje, alEstado, alConfig, alInicio }) {
    fetch('/api/multichat').then((r) => r.json()).then((j) => { alInicio?.(j); alEstado?.(j.estado); alConfig?.(j.config); }).catch((e) => console.error('[Multichat] No se pudo leer /api/multichat:', e));
    const es = new EventSource('/events');
    es.onmessage = (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      if (d.type !== 'multichat') return;
      if (d.payload.mensaje) alMensaje?.(d.payload.mensaje);
      if (d.payload.estado) alEstado?.(d.payload.estado);
      if (d.payload.config) alConfig?.(d.payload.config);
    };
    return es;
  }
  return { PLAT, etiqueta, elemento, conectar, esc };
})();

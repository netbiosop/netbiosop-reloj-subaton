// Panel de mods: solo reloj, multiplicadores e historial (según los permisos que dio el dueño)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const SOURCES = ['paypal', 'mercadopago', 'bits', 'subs'];
const LABELS = { paypal: 'PayPal', mercadopago: 'Mercado Pago', bits: 'Bits', subs: 'Subs', manual: 'Manual' };

let data = null;
let state = null;
let receivedAt = 0;
let serverOffset = 0;

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) {
    location.href = '/login';
    throw new Error('Necesitas iniciar sesión');
  }
  if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
  return j;
}
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = 'toast'), 2200);
}
const pad = (n) => String(n).padStart(2, '0');
const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
function fmtDur(sec) {
  const neg = sec < 0;
  sec = Math.round(Math.abs(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (neg ? '-' : '') + (h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`);
}
function parseDur(str) {
  str = String(str || '').trim().replace(',', '.');
  if (!str) return null;
  const neg = str.startsWith('-');
  str = str.replace(/^[-+]/, '');
  let secs;
  if (str.includes(':')) {
    const p = str.split(':').map(Number);
    if (p.some((n) => !Number.isFinite(n))) return null;
    secs = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  } else {
    const n = Number(str);
    if (!Number.isFinite(n)) return null;
    secs = n * 60;
  }
  return Math.round(neg ? -secs : secs);
}
const fmtWhen = (ms) => new Date(ms).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const toLocalInput = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16);

// ---------- reloj ----------
function tick() {
  requestAnimationFrame(tick);
  if (!state) return;
  const rem = state.running ? state.remainingMs - (Date.now() - receivedAt) : state.remainingMs;
  const txt = fmtClock(rem);
  const big = $('#bigTime');
  if (big.textContent !== txt) big.textContent = txt;
  big.classList.toggle('paused', !state.running);
}
requestAnimationFrame(tick);

function renderState() {
  const pill = $('#runPill');
  const saved = !state.running && !state.ended && state.stream?.live === false && state.remainingMs > 0;
  pill.className = 'pill' + (state.running ? ' run' : state.ended ? ' end' : saved ? ' saved' : '');
  pill.textContent = state.running ? 'Corriendo' : state.ended ? 'Terminado' : saved ? 'Guardado para el próximo stream' : 'En pausa';
  $('#btnStart').disabled = state.running;
  $('#btnPause').disabled = !state.running;
  renderMult();
}

const run = (p, okMsg) => p.then((r) => (okMsg && toast(typeof okMsg === 'function' ? okMsg(r) : okMsg), r)).catch((e) => toast(e.message, true));
$('#btnStart').onclick = () => run(api('POST', '/api/timer/start'), (r) => (r.started ? 'Reloj iniciado' : 'El reloj está en 0'));
$('#btnPause').onclick = () => run(api('POST', '/api/timer/pause'), 'Reloj pausado');
const addTime = (s) => run(api('POST', '/api/timer/add', { seconds: s }), (r) => `${r.entry.seconds >= 0 ? '+' : ''}${fmtDur(r.entry.seconds)}${r.capped ? ' (máximo permitido)' : ''}`);
$$('[data-add]').forEach((b) => (b.onclick = () => addTime(Number(b.dataset.add))));
$('#btnCustomAdd').onclick = () => {
  const s = parseDur($('#customAdd').value);
  if (!s) return toast('Escribe un tiempo válido', true);
  addTime(s).then(() => ($('#customAdd').value = ''));
};
$('#btnSet').onclick = () => {
  const s = parseDur($('#setTime').value);
  if (s === null || s < 0) return toast('Escribe un tiempo válido', true);
  if (!confirm(`¿Dejar el reloj en ${fmtDur(s)}?`)) return;
  run(api('POST', '/api/timer/set', { seconds: s }), 'Reloj fijado en ' + fmtDur(s)).then(() => ($('#setTime').value = ''));
};

// ---------- multiplicador ----------
function chips(container, prefix) {
  container.innerHTML = SOURCES.map((s) => `<label><input type="checkbox" id="${prefix}-${s}" checked> ${LABELS[s]}</label>`).join('');
}
chips($('#manualApplies'), 'ma');
chips($('#schedApplies'), 'sa');
const readApplies = (prefix) => Object.fromEntries(SOURCES.map((s) => [s, $(`#${prefix}-${s}`).checked]));
let multValue = 2;
$$('#multSeg button').forEach((b) => (b.onclick = () => {
  multValue = Number(b.dataset.mv);
  $$('#multSeg button').forEach((x) => x.classList.toggle('on', x === b));
}));
$('#btnMultOn').onclick = () => {
  const appliesTo = readApplies('ma');
  if (!Object.values(appliesTo).some(Boolean)) return toast('Elige al menos una fuente', true);
  run(api('POST', '/api/multiplier/manual', { active: true, value: multValue, minutes: Number($('#multMinutes').value), appliesTo }), `x${multValue} activado`);
};
$('#btnMultOff').onclick = () => run(api('POST', '/api/multiplier/manual', { active: false }), 'Multiplicador apagado');
$('#btnSchedule').onclick = () => {
  const start = new Date($('#schStart').value).getTime();
  const end = new Date($('#schEnd').value).getTime();
  if (!start || !end) return toast('Elige inicio y fin', true);
  const appliesTo = readApplies('sa');
  if (!Object.values(appliesTo).some(Boolean)) return toast('Elige al menos una fuente', true);
  run(api('POST', '/api/multiplier/schedule', { start, end, value: Number($('#schValue').value), appliesTo }), 'Multiplicador programado');
};
(() => {
  const next = Math.ceil(Date.now() / 3600000) * 3600000;
  $('#schStart').value = toLocalInput(next);
  $('#schEnd').value = toLocalInput(next + 3600000);
})();

function renderMult() {
  const m = state?.multiplier;
  const el = $('#multNow');
  const banner = $('#multBanner');
  if (m && m.value > 1) {
    const left = m.until ? ` · termina en ${fmtDur((m.until - (Date.now() + serverOffset)) / 1000)}` : ' · sin hora de fin';
    const srcs = SOURCES.filter((s) => m.bySource[s] > 1).map((s) => `${LABELS[s]} x${m.bySource[s]}`).join(', ');
    el.className = 'mult-now on';
    el.innerHTML = `<b>x${m.value}</b> activo — ${srcs}${left}`;
    banner.classList.remove('hidden');
    banner.textContent = `x${m.value} activo en ${m.labels.join(', ')}`;
  } else {
    el.className = 'mult-now';
    el.textContent = 'Sin multiplicador activo';
    banner.classList.add('hidden');
  }
}
setInterval(() => state && renderMult(), 1000);

function renderSchedules() {
  const list = $('#schedList');
  const now = Date.now() + serverOffset;
  const items = data.multiplier.schedules.filter((s) => s.end > now - 3600000);
  list.innerHTML = items.length ? '' : '<li class="empty" style="justify-content:center">No hay multiplicadores programados</li>';
  for (const s of items) {
    const li = document.createElement('li');
    const st = now >= s.end ? ['Terminado', 'past'] : now >= s.start ? ['Activo', ''] : ['Próximo', 'past'];
    const srcs = SOURCES.filter((k) => s.appliesTo[k]).map((k) => LABELS[k]).join(', ');
    li.innerHTML = `<span class="x">x${s.value}</span><span class="when">${fmtWhen(s.start)} → ${fmtWhen(s.end)}<br><small style="color:var(--muted)">${srcs}</small></span><span class="badge ${st[1]}">${st[0]}</span>`;
    if (data.me.perms.mult) {
      const b = document.createElement('button');
      b.className = 'ghost sm';
      b.textContent = 'Quitar';
      b.onclick = () => run(api('DELETE', '/api/multiplier/schedule/' + s.id), 'Quitado');
      li.appendChild(b);
    }
    list.appendChild(li);
  }
}

// ---------- historial ----------
function logItem(e, fresh) {
  const li = document.createElement('li');
  if (fresh) li.className = 'fresh';
  const cls = e.seconds > 0 ? '' : e.seconds < 0 ? 'neg' : 'zero';
  li.innerHTML = `<span class="t">${new Date(e.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span><span class="tag ${e.source}">${LABELS[e.source] || e.source}</span><span class="txt"></span><span class="plus ${cls}">${e.seconds > 0 ? '+' : ''}${fmtDur(e.seconds)}${e.multiplier > 1 ? `<span class="xm">x${e.multiplier}</span>` : ''}</span>`;
  li.querySelector('.txt').textContent = e.text;
  if (e.test) li.querySelector('.txt').insertAdjacentHTML('beforeend', '<span class="test">(prueba)</span>');
  return li;
}
function renderLog() {
  const ul = $('#log');
  ul.innerHTML = data.log.length ? '' : '<li class="empty" style="display:block">Todavía no hay eventos</li>';
  data.log.forEach((e) => ul.appendChild(logItem(e)));
}

// ---------- tarifas (permiso "rates") ----------
const RATE_SRC = [['paypal', 'PayPal'], ['mercadopago', 'Mercado Pago'], ['bits', 'Bits']];
function renderRates() {
  if (!data.rates) return;
  const r = data.rates;
  const money = ([k, name]) => `<div class="rate" data-src="${k}">
      <div class="rate-head"><span class="tag ${k}">${name}</span><label class="switch"><input type="checkbox" data-f="enabled" ${r[k].enabled ? 'checked' : ''}><span></span></label></div>
      <div class="rate-line">Por cada <input type="number" step="any" min="0" data-f="amount" value="${r[k].amount}"> ${k === 'bits' ? 'bits' : `<input class="cur" data-f="currency" maxlength="3" value="${r[k].currency || ''}">`} suma <input class="dur" data-f="seconds" data-dur value="${fmtDur(r[k].seconds)}"></div>
      <div class="rate-line small">Mínimo <input type="number" step="any" min="0" data-f="minAmount" value="${r[k].minAmount}"> <label class="check"><input type="checkbox" data-f="proportional" ${r[k].proportional ? 'checked' : ''}> Proporcional</label></div>
    </div>`;
  const s = r.subs;
  $('#modRates').innerHTML = RATE_SRC.map(money).join('') + `<div class="rate" data-src="subs">
      <div class="rate-head"><span class="tag subs">Subs</span><label class="switch"><input type="checkbox" data-f="enabled" ${s.enabled ? 'checked' : ''}><span></span></label></div>
      <div class="tiers"><label>Tier 1 / Prime<input class="dur" data-f="tier1" data-dur value="${fmtDur(s.tier1)}"></label><label>Tier 2<input class="dur" data-f="tier2" data-dur value="${fmtDur(s.tier2)}"></label><label>Tier 3<input class="dur" data-f="tier3" data-dur value="${fmtDur(s.tier3)}"></label></div>
      <div class="rate-line small"><label class="check"><input type="checkbox" data-f="countResubs" ${s.countResubs ? 'checked' : ''}> Contar resubs</label><label class="check"><input type="checkbox" data-f="countGifts" ${s.countGifts ? 'checked' : ''}> Contar regaladas</label></div>
    </div>`;
}
$('#btnSaveRates').onclick = () => {
  const rates = {};
  for (const box of $$('#modRates .rate')) {
    const src = box.dataset.src;
    const r = {};
    for (const inp of $$('[data-f]', box)) {
      const f = inp.dataset.f;
      if (inp.type === 'checkbox') r[f] = inp.checked;
      else if ('dur' in inp.dataset) r[f] = Math.max(0, parseDur(inp.value) ?? data.rates[src][f]);
      else if (inp.type === 'number') r[f] = Number(inp.value);
      else r[f] = inp.value;
    }
    rates[src] = r;
  }
  run(api('POST', '/api/config', { rates }), 'Tarifas guardadas').then(load);
};

// ---------- montos (permiso "money") ----------
function renderStats() {
  if (!data.stats) return;
  const cells = SOURCES.map((s) => {
    const x = data.stats[s] || { count: 0, amount: 0, seconds: 0 };
    const main = s === 'subs' ? `${x.count} subs` : s === 'bits' ? `${x.amount} bits` : `${x.amount} ${data.currencies?.[s] || ''}`;
    return `<div class="stat"><div class="k">${LABELS[s]}</div><div class="v">${main}</div><div class="s">+${fmtDur(x.seconds)}</div></div>`;
  });
  $('#modStats').innerHTML = cells.join('');
}

// ---------- comandos del chat (permiso "chat") ----------
function renderChat() {
  if (!data.chat) return;
  const c = data.chat;
  $$('#modChat [data-c]').forEach((i) => (i.checked = !!c[i.dataset.c]));
  $('#chatUsers').value = c.users.join('\n');
  $('#chatPrefix').value = c.prefix;
  $('#chatMax').value = c.maxPerCommand ? fmtDur(c.maxPerCommand) : '';
}
$('#btnSaveChat').onclick = () => {
  const body = Object.fromEntries($$('#modChat [data-c]').map((i) => [i.dataset.c, i.checked]));
  body.users = $('#chatUsers').value.split(/[\s,]+/).filter(Boolean);
  body.prefix = $('#chatPrefix').value || '!';
  body.maxPerCommand = Math.max(0, parseDur($('#chatMax').value) ?? 0);
  run(api('POST', '/api/chat', body), 'Comandos guardados');
};

// ---------- permisos ----------
function applyPerms() {
  const p = data.me.perms;
  $$('[data-perm]').forEach((el) => el.classList.toggle('hidden', !p[el.dataset.perm]));
  $('#noPermClock').classList.toggle('hidden', p.run || p.add || p.set);
  $('#maxHint').textContent = data.maxPerAction ? `Máximo por acción: ${fmtDur(data.maxPerAction)}` : '';
  $('#meName').textContent = data.me.name;
}
$('#btnLogout').onclick = async () => {
  await api('POST', '/api/logout').catch(() => {});
  location.href = '/login';
};

// ---------- carga y tiempo real ----------
async function load() {
  data = await api('GET', '/api/mod/data');
  state = data.state;
  receivedAt = Date.now();
  serverOffset = state.serverNow - Date.now();
  $('#totalAdded').textContent = fmtDur(data.totalAdded);
  applyPerms();
  renderRates();
  renderStats();
  renderChat();
  renderState();
  renderSchedules();
  renderLog();
}
function connect() {
  const es = new EventSource('/events');
  es.onmessage = async (ev) => {
    const { type, payload } = JSON.parse(ev.data);
    if (type === 'shutdown') {
      es.close();
      document.body.innerHTML = '<div style="display:grid;place-items:center;height:100vh;text-align:center;padding:16px"><div><h1 style="font-family:Bebas Neue,sans-serif;font-size:52px;margin:0">Reloj apagado</h1><p style="color:#9a96ab">El dueño del canal apagó el reloj. Esta página se reconecta sola cuando vuelva a encenderse.</p></div></div>';
      const back = () => fetch('/api/mod/data', { cache: 'no-store' }).then((r) => (r.ok ? location.reload() : setTimeout(back, 3000))).catch(() => setTimeout(back, 3000));
      return setTimeout(back, 4000);
    }
    if (!data) return;
    if (type === 'state') {
      state = payload;
      receivedAt = Date.now();
      serverOffset = payload.serverNow - Date.now();
      renderState();
    } else if (type === 'log') {
      data.log.unshift(payload);
      $('#log .empty')?.remove();
      $('#log').prepend(logItem(payload, true));
      if (!payload.test && payload.source !== 'manual') {
        data.totalAdded += payload.seconds || 0;
        if (data.stats) api('GET', '/api/mod/data').then((r) => { data.stats = r.stats; renderStats(); }).catch(() => {});
      }
      $('#totalAdded').textContent = fmtDur(data.totalAdded);
    } else if (type === 'multiplier') {
      data.multiplier = payload;
      renderSchedules();
    } else if (type === 'reset') {
      load();
    }
  };
  // Si el dueño cambió los permisos, la conexión se reinicia: se vuelven a cargar los datos
  let dropped = false;
  es.onopen = () => {
    if (dropped) load().catch(() => {});
    dropped = false;
  };
  es.onerror = () => {
    dropped = true;
    // Si el dueño quitó el acceso, la próxima petición lleva a la pantalla de entrada
    fetch('/api/mod/data', { cache: 'no-store' }).then((r) => r.status === 401 && (location.href = '/login')).catch(() => {});
  };
}
load().then(connect).catch((e) => toast('No se pudo cargar: ' + e.message, true));
setInterval(() => data && renderSchedules(), 30000);

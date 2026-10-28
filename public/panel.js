const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const SOURCES = ['paypal', 'mercadopago', 'bits', 'subs'];
const LABELS = { paypal: 'PayPal', mercadopago: 'Mercado Pago', bits: 'Bits', subs: 'Subs', manual: 'Manual' };

let data = null;
let state = null;
let receivedAt = 0;
let serverOffset = 0;

// ---------- utilidades ----------
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && j.login) {
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
function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
function fmtDur(sec) {
  const neg = sec < 0;
  sec = Math.round(Math.abs(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (neg ? '-' : '') + (h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`);
}
// "15" = 15 minutos · "1:30" = 1 min 30 s · "2:00:00" = 2 horas
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
function fmtWhen(ms) {
  return new Date(ms).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function toLocalInput(ms) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  navigator.clipboard.writeText($(b.dataset.copy).textContent.trim());
  toast('Copiado');
});

// ---------- reloj ----------
function tick() {
  requestAnimationFrame(tick);
  if (!state) return;
  const rem = state.running ? state.remainingMs - (Date.now() - receivedAt) : state.remainingMs;
  const big = $('#bigTime');
  const txt = fmtClock(rem);
  if (big.textContent !== txt) big.textContent = txt;
  big.classList.toggle('paused', !state.running);
}
requestAnimationFrame(tick);

function renderState() {
  const pill = $('#runPill');
  const savedForNext = !state.running && !state.ended && state.stream?.live === false && state.remainingMs > 0;
  pill.className = 'pill' + (state.running ? ' run' : state.ended ? ' end' : savedForNext ? ' saved' : '');
  pill.textContent = state.running ? 'Corriendo' : state.ended ? 'Terminado' : savedForNext ? 'Guardado para el próximo stream' : 'En pausa';
  renderStream();
  $('#btnStart').disabled = state.running;
  $('#btnPause').disabled = !state.running;
  renderMultNow();
  renderExamples();
}

$('#btnStart').onclick = () => api('POST', '/api/timer/start').then((r) => !r.started && toast('El reloj está en 0: fija un tiempo primero', true));
$('#btnPause').onclick = () => api('POST', '/api/timer/pause');
$$('[data-add]').forEach((b) => (b.onclick = () => api('POST', '/api/timer/add', { seconds: Number(b.dataset.add) })));
$('#btnCustomAdd').onclick = () => {
  const s = parseDur($('#customAdd').value);
  if (!s) return toast('Escribe un tiempo válido', true);
  api('POST', '/api/timer/add', { seconds: s }).then(() => ($('#customAdd').value = ''));
};
$('#btnSet').onclick = () => {
  const s = parseDur($('#setTime').value);
  if (s === null || s < 0) return toast('Escribe un tiempo válido', true);
  api('POST', '/api/timer/set', { seconds: s }).then(() => { $('#setTime').value = ''; toast('Reloj fijado en ' + fmtDur(s)); });
};

// ---------- multiplicador ----------
function appliesChips(container, prefix) {
  container.innerHTML = SOURCES.map((s) => `<label><input type="checkbox" id="${prefix}-${s}" checked> ${LABELS[s]}</label>`).join('');
}
appliesChips($('#manualApplies'), 'ma');
appliesChips($('#schedApplies'), 'sa');
const readApplies = (prefix) => Object.fromEntries(SOURCES.map((s) => [s, $(`#${prefix}-${s}`).checked]));

let multValue = 2;
$$('#multSeg button').forEach((b) => (b.onclick = () => {
  multValue = Number(b.dataset.mv);
  $('#multCustom').value = '';
  $$('#multSeg button').forEach((x) => x.classList.toggle('on', x === b));
}));
$('#multCustom').oninput = (e) => {
  const v = Number(e.target.value);
  if (v >= 1) { multValue = v; $$('#multSeg button').forEach((x) => x.classList.remove('on')); }
};
$('#btnMultOn').onclick = () => {
  const appliesTo = readApplies('ma');
  if (!Object.values(appliesTo).some(Boolean)) return toast('Elige al menos una fuente', true);
  api('POST', '/api/multiplier/manual', { active: true, value: multValue, minutes: Number($('#multMinutes').value), appliesTo }).then(() => toast(`x${multValue} activado`));
};
$('#btnMultOff').onclick = () => api('POST', '/api/multiplier/manual', { active: false }).then(() => toast('Multiplicador manual apagado'));
$('#btnSchedule').onclick = () => {
  const start = new Date($('#schStart').value).getTime();
  const end = new Date($('#schEnd').value).getTime();
  if (!start || !end) return toast('Elige fecha y hora de inicio y fin', true);
  const appliesTo = readApplies('sa');
  if (!Object.values(appliesTo).some(Boolean)) return toast('Elige al menos una fuente', true);
  api('POST', '/api/multiplier/schedule', { start, end, value: Number($('#schValue').value), appliesTo })
    .then(() => toast('Multiplicador programado'))
    .catch((e) => toast(e.message, true));
};
(() => {
  const now = Date.now();
  const next = Math.ceil(now / 3600000) * 3600000;
  $('#schStart').value = toLocalInput(next);
  $('#schEnd').value = toLocalInput(next + 3600000);
})();

function renderMultNow() {
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
setInterval(() => state && renderMultNow(), 1000);

function renderSchedules() {
  const list = $('#schedList');
  const now = Date.now() + serverOffset;
  const items = data.multiplier.schedules;
  list.innerHTML = items.length ? '' : '<li class="empty" style="justify-content:center">No hay multiplicadores programados</li>';
  for (const s of items) {
    const li = document.createElement('li');
    const st = now >= s.end ? ['Terminado', 'past'] : now >= s.start ? ['Activo', ''] : ['Próximo', 'past'];
    const srcs = SOURCES.filter((k) => s.appliesTo[k]).map((k) => LABELS[k]).join(', ');
    li.innerHTML = `<span class="x">x${s.value}</span><span class="when">${fmtWhen(s.start)} → ${fmtWhen(s.end)}<br><small style="color:var(--muted)">${srcs}</small></span><span class="badge ${st[1]}">${st[0]}</span><button class="ghost sm">Quitar</button>`;
    li.querySelector('button').onclick = () => api('DELETE', '/api/multiplier/schedule/' + s.id);
    list.appendChild(li);
  }
}
setInterval(() => data && renderSchedules(), 15000);

// ---------- tarifas ----------
function fillRates() {
  for (const src of SOURCES) {
    const box = $(`.rate[data-src="${src}"]`);
    const r = data.rates[src];
    $$('[data-f]', box).forEach((inp) => {
      const v = r[inp.dataset.f];
      if (inp.type === 'checkbox') inp.checked = !!v;
      else if ('dur' in inp.dataset) inp.value = fmtDur(v);
      else inp.value = v ?? '';
    });
    box.classList.toggle('off', !r.enabled);
  }
  $('#setInitial').value = fmtDur(data.settings.initialSeconds);
  $('#setMax').value = data.settings.maxSeconds ? fmtDur(data.settings.maxSeconds) : '';
  $('#setAfterEnd').checked = data.settings.addAfterEnd;
  renderDaily();
  renderExamples();
}

// Horas diarias automáticas
function renderDaily() {
  const h = data.settings.horasDiarias || { on: false, seconds: 14400, unaVezPorDia: true, ultimoDia: '' };
  if (document.activeElement !== $('#setDaily')) $('#setDaily').value = fmtDur(h.seconds || 0);
  $('#setDailyOn').checked = !!h.on;
  $('#setDailyOnce').checked = h.unaVezPorDia !== false;
  $('#dailyRow').classList.toggle('off', !h.on);
  const ult = h.ultimoDia ? new Date(h.ultimoDia + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }) : null;
  $('#dailyHint').innerHTML = h.on
    ? `Cada vez que termine el stream se suman <b>${fmtDur(h.seconds || 0)}</b> al tiempo que haya quedado (aunque esté en 0), para el próximo stream.${h.unaVezPorDia !== false ? ' Si se corta y vuelves el mismo día, no se suman de nuevo.' : ''}${ult ? ` Última vez: ${ult}.` : ''}`
    : 'Apagado. Actívalo si haces streams de horas fijas por día (ej. 4:00:00): el reloj arranca cada stream con esas horas más lo que sobró.';
}
$('#btnDailyNow').onclick = async () => {
  const s = parseDur($('#setDaily').value);
  if (!s) return toast('Escribe cuántas horas sumar');
  if (!confirm(`¿Sumar ${fmtDur(s)} al reloj ahora?`)) return;
  clearTimeout(saveTimer);
  await api('POST', '/api/config', { settings: { initialSeconds: data.settings.initialSeconds, maxSeconds: data.settings.maxSeconds, addAfterEnd: data.settings.addAfterEnd, horasDiarias: { seconds: s } } });
  await api('POST', '/api/horas-diarias');
  toast(`+${fmtDur(s)} sumadas al reloj`);
};

function readRates() {
  const rates = {};
  for (const src of SOURCES) {
    const box = $(`.rate[data-src="${src}"]`);
    const r = {};
    $$('[data-f]', box).forEach((inp) => {
      const f = inp.dataset.f;
      if (inp.type === 'checkbox') r[f] = inp.checked;
      else if ('dur' in inp.dataset) r[f] = Math.max(0, parseDur(inp.value) ?? data.rates[src][f]);
      else if (inp.type === 'number') r[f] = Number(inp.value);
      else r[f] = inp.value;
    });
    rates[src] = r;
  }
  return rates;
}

function renderExamples() {
  if (!data) return;
  const rates = readRatesSafe();
  for (const src of ['paypal', 'mercadopago', 'bits']) {
    const r = rates[src];
    const ex = $(`.rate[data-src="${src}"] [data-ex]`);
    const unit = src === 'bits' ? 'bits' : r.currency;
    const sample = r.amount * (src === 'bits' ? 10 : 5) || 0;
    const half = r.amount * 2.5;
    const calc = (a) => (a < r.minAmount ? 0 : (r.proportional ? a / r.amount : Math.floor(a / r.amount)) * r.seconds);
    const mult = state?.multiplier?.bySource?.[src] || 1;
    const multTxt = mult > 1 ? ` → con x${mult}: <b>+${fmtDur(calc(sample) * mult)}</b>` : '';
    ex.innerHTML = r.amount > 0
      ? `${sample} ${unit} = <b>+${fmtDur(calc(sample))}</b>${multTxt} · ${half} ${unit} = <b>+${fmtDur(calc(half))}</b>`
      : 'Pon un monto mayor a 0';
  }
}
function readRatesSafe() {
  try { return readRates(); } catch { return data.rates; }
}

let saveTimer;
function scheduleSave() {
  $('#saveState').textContent = 'Guardando…';
  renderExamples();
  SOURCES.forEach((s) => $(`.rate[data-src="${s}"]`).classList.toggle('off', !$(`.rate[data-src="${s}"] [data-f="enabled"]`).checked));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const settings = {
      initialSeconds: Math.max(0, parseDur($('#setInitial').value) ?? data.settings.initialSeconds),
      maxSeconds: Math.max(0, parseDur($('#setMax').value) ?? 0),
      addAfterEnd: $('#setAfterEnd').checked,
      horasDiarias: {
        on: $('#setDailyOn').checked,
        seconds: Math.max(0, parseDur($('#setDaily').value) ?? (data.settings.horasDiarias?.seconds || 0)),
        unaVezPorDia: $('#setDailyOnce').checked,
      },
    };
    try {
      await api('POST', '/api/config', { settings, rates: readRates() });
      $('#saveState').textContent = 'Guardado ✓';
    } catch (e) {
      $('#saveState').textContent = 'Error al guardar';
    }
  }, 500);
}
$$('.rates input, .settings-row input').forEach((inp) => {
  inp.addEventListener('input', scheduleSave);
  inp.addEventListener('change', scheduleSave);
  if ('dur' in inp.dataset) inp.addEventListener('blur', () => {
    const v = parseDur(inp.value);
    if (v !== null) inp.value = inp.id === 'setMax' && v === 0 ? '' : fmtDur(v);
  });
});

// ---------- conexiones ----------
function statusOf(kind) {
  const c = data.connections;
  if (kind === 'twitch') {
    const t = c.twitch;
    const map = { conectado: 'ok', error: 'err', conectando: 'wait', reconectando: 'wait' };
    return { cls: map[t.status] || '', text: t.status === 'conectado' ? `Conectado${t.login ? ' · ' + t.login : ''}${t.detail ? ' · ' + t.detail : ''}` : t.status + (t.detail ? ' · ' + t.detail : '') };
  }
  if (kind === 'mercadopago') {
    const m = c.mercadopago;
    return { cls: m.status === 'conectado' ? 'ok' : m.status === 'error' ? 'err' : '', text: m.status === 'conectado' ? `Conectado${m.nickname ? ' · ' + m.nickname : ''} · ${m.detail}` : m.status + (m.detail ? ' · ' + m.detail : '') };
  }
  const se = c.streamelements;
  if (se?.status === 'conectado') return { cls: 'ok', text: 'Conectado vía StreamElements' };
  if (se?.status === 'error') return { cls: 'err', text: 'StreamElements: ' + se.detail };
  if (se && ['conectando', 'reconectando'].includes(se.status)) return { cls: 'wait', text: 'StreamElements: ' + se.status };
  const p = c.paypal;
  const configured = data.settings.publicUrl;
  if (p.last) return { cls: /inválid|no verificado|faltan|otra cuenta/i.test(p.detail) ? 'err' : 'ok', text: `${p.detail} (${new Date(p.last).toLocaleTimeString('es')})` };
  return { cls: configured ? 'wait' : '', text: configured ? 'Esperando avisos de PayPal' : 'Falta configurar el túnel' };
}
function renderConnections() {
  const chips = [['twitch', 'Twitch'], ['mercadopago', 'Mercado Pago'], ['paypal', 'PayPal']];
  $('#connChips').innerHTML = chips.map(([k, n]) => {
    const st = statusOf(k);
    return `<span class="chip ${st.cls}" title="${st.text.replace(/"/g, '')}"><i></i>${n}</span>`;
  }).join('');
  for (const [id, k] of [['#stTwitch', 'twitch'], ['#stMp', 'mercadopago'], ['#stPp', 'paypal']]) {
    const st = statusOf(k);
    $(id).className = 'status ' + st.cls;
    $(id).textContent = st.text;
  }
  $('#twRedirect').textContent = data.connections.twitch.redirectUri;
  const se = data.connections.streamelements;
  $('#seState').value = se ? se.status + (se.detail ? ' · ' + se.detail : '') : '';
  const tw = data.connections.twitch;
  $('#chatWarn').classList.toggle('hidden', !(tw.status === 'conectado' && /Comandos de chat desactivados/.test(tw.detail || '')));
}
function fillSecrets() {
  const s = data.secrets;
  $('#twClientId').value = s.twitch.clientId;
  $('#twSecret').placeholder = s.twitch.hasSecret ? '•••••••• (guardado)' : '';
  $('#mpMode').value = s.mercadopago.mode;
  $('#mpPoll').value = s.mercadopago.pollSeconds;
  $('#mpNombre').value = s.mercadopago.nombre || 'inicial';
  $('#mpToken').placeholder = s.mercadopago.hasToken ? '•••••••• (guardado)' : 'APP_USR-...';
  $('#mpSecret').placeholder = s.mercadopago.hasWebhookSecret ? '•••••••• (guardado)' : '';
  $('#seJwt').placeholder = s.streamelements?.hasJwt ? '•••••••• (guardado)' : 'eyJhbGciOi...';
  $('#ppMode').value = s.paypal.mode;
  $('#ppEmail').value = s.paypal.receiverEmail;
  $('#ppClientId').value = s.paypal.clientId;
  $('#ppSecret').placeholder = s.paypal.hasSecret ? '•••••••• (guardado)' : '';
  $('#ppWebhookId').value = s.paypal.webhookId;
  $('#publicUrl').value = data.settings.publicUrl;
  $('#hookPort').textContent = data.ports.webhooks;
  renderHookUrls();
}
function renderHookUrls() {
  const base = ($('#publicUrl').value.trim() || 'https://TU-TUNEL').replace(/\/+$/, '');
  $$('.hookurl').forEach((c) => (c.textContent = base + c.dataset.hook));
}
$('#publicUrl').addEventListener('input', renderHookUrls);

async function saveSecrets(payload, msg) {
  try {
    const r = await api('POST', '/api/secrets', payload);
    data.secrets = r.secrets;
    $$('input[type=password]').forEach((i) => (i.value = ''));
    fillSecrets();
    toast(msg || 'Guardado');
  } catch (e) {
    toast(e.message, true);
  }
}
$('#btnTwSave').onclick = () => saveSecrets({ twitch: { clientId: $('#twClientId').value, clientSecret: $('#twSecret').value } }, 'Datos de Twitch guardados. Ahora pulsa “Conectar con Twitch”.');
$('#btnTwConnect').onclick = (e) => {
  if (!$('#twClientId').value || !data.secrets.twitch.hasSecret) {
    e.preventDefault();
    toast('Primero guarda el Client ID y el Client Secret', true);
  }
};
$('#btnTwReconnect').onclick = () => api('POST', '/api/twitch/reconnect');
$('#btnTwDisconnect').onclick = () => confirm('¿Desconectar Twitch?') && api('POST', '/api/twitch/disconnect');
$('#btnMpSave').onclick = () => saveSecrets({ mercadopago: { accessToken: $('#mpToken').value, mode: $('#mpMode').value, pollSeconds: Number($('#mpPoll').value) || 15, nombre: $('#mpNombre').value, webhookSecret: $('#mpSecret').value } }, 'Mercado Pago guardado, conectando…');
$('#btnMpClear').onclick = () => confirm('¿Quitar el token de Mercado Pago?') && saveSecrets({ mercadopago: { accessToken: null } }, 'Token quitado');
$('#btnSeSave').onclick = () => {
  if (!$('#seJwt').value.trim() && !data.secrets.streamelements?.hasJwt) return toast('Pega el JWT Token primero', true);
  saveSecrets({ streamelements: { jwt: $('#seJwt').value } }, 'StreamElements guardado, conectando…');
};
$('#btnSeClear').onclick = () => confirm('¿Quitar el token de StreamElements?') && saveSecrets({ streamelements: { jwt: null } }, 'Token quitado');
$('#btnPpSave').onclick = async () => {
  await api('POST', '/api/config', { settings: { ...data.settings, publicUrl: $('#publicUrl').value } });
  data.settings.publicUrl = $('#publicUrl').value.trim().replace(/\/+$/, '');
  saveSecrets({ paypal: { mode: $('#ppMode').value, receiverEmail: $('#ppEmail').value, clientId: $('#ppClientId').value, clientSecret: $('#ppSecret').value, webhookId: $('#ppWebhookId').value } }, 'PayPal guardado');
  renderConnections();
};

// ---------- comandos del chat ----------
function renderCmdTable() {
  const p = data.chat.prefix || '!';
  const rows = [
    ['tiempo', 'Muestra el tiempo que queda (también <code>' + p + 'reloj</code>)'],
    ['sumar 10', 'Suma 10 minutos · acepta <code>1:30</code>, <code>2h</code>, <code>45s</code>'],
    ['quitar 5', 'Quita 5 minutos'],
    ['fijar 3:00:00', 'Deja el reloj en un tiempo exacto'],
    ['pausa', 'Pausa el reloj'],
    ['iniciar', 'Inicia o reanuda el reloj'],
    ['x2 30', 'x2 en todo por 30 min (sin minutos = hasta apagarlo)'],
    ['x3 15 subs bits', 'x3 solo en subs y bits por 15 min (también <code>paypal</code>, <code>mp</code>)'],
    ['multioff', 'Apaga el multiplicador (o <code>' + p + 'x1</code>)'],
    ['mp.add @usuario', 'La última donación de Mercado Pago pasa a ser de ese usuario de Twitch (en el podio y las metas), y las próximas de esa persona ya llegan con su nombre · <code>' + p + 'mp.add @usuario 1500</code> elige la de ese monto'],
    ['comandos', 'Lista los comandos en el chat'],
  ];
  $('#cmdTable').innerHTML = rows.map(([c, t]) => `<tr><td><code>${p}${c}</code></td><td>${t}</td></tr>`).join('');
}
function fillChat() {
  const c = data.chat;
  $$('[data-c]').forEach((i) => (i.checked = !!c[i.dataset.c]));
  $('#chatUsers').value = c.users.join('\n');
  $('#chatPrefix').value = c.prefix;
  $('#chatMax').value = c.maxPerCommand ? fmtDur(c.maxPerCommand) : '';
  renderCmdTable();
}
let chatTimer;
function saveChat() {
  $('#chatSave').textContent = 'Guardando…';
  clearTimeout(chatTimer);
  chatTimer = setTimeout(async () => {
    const body = Object.fromEntries($$('[data-c]').map((i) => [i.dataset.c, i.checked]));
    body.users = $('#chatUsers').value.split(/[\s,]+/).filter(Boolean);
    body.prefix = $('#chatPrefix').value || '!';
    body.maxPerCommand = Math.max(0, parseDur($('#chatMax').value) ?? 0);
    try {
      const r = await api('POST', '/api/chat', body);
      data.chat = r.chat;
      renderCmdTable();
      $('#chatSave').textContent = 'Guardado ✓';
    } catch {
      $('#chatSave').textContent = 'Error al guardar';
    }
  }, 500);
}
$$('#chatCard input, #chatCard textarea').forEach((i) => {
  i.addEventListener('input', saveChat);
  i.addEventListener('change', saveChat);
});
$('#chatMax').addEventListener('blur', (e) => {
  const v = parseDur(e.target.value);
  if (v !== null) e.target.value = v ? fmtDur(v) : '';
});

// ---------- stream y registros ----------
function renderStream() {
  const s = state?.stream;
  const dot = $('#liveDot');
  const txt = $('#liveText');
  if (!s || s.live === null) {
    dot.className = 'live-dot';
    txt.textContent = 'Conecta Twitch para detectar cuándo estás en vivo';
  } else if (s.live) {
    dot.className = 'live-dot on';
    txt.textContent = 'En vivo desde las ' + new Date(s.since).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  } else {
    dot.className = 'live-dot off';
    txt.textContent = 'Apagado';
  }
  const left = fmtDur(Math.max(0, state.remainingMs) / 1000);
  $('#savedHint').innerHTML = s?.live === false && !state.running
    ? `Quedan <b>${left}</b> guardados para el próximo stream. Si quieres cambiarlos usa <b>Fijar en</b> o los botones ± del reloj.`
    : 'Cuando el stream termina, el tiempo que sobra queda guardado y puedes editarlo antes del próximo stream con <b>Fijar en</b> o los botones ±.';
}
function fillStream() {
  $('#autoPause').checked = data.settings.autoPauseOffline;
  $('#autoResume').checked = data.settings.autoResumeOnline;
  $('#offOnClose').checked = data.settings.shutdownOnPanelClose;
  $('#keepLive').checked = data.settings.keepAliveWhenLive;
  $('#keepLive').disabled = !data.settings.shutdownOnPanelClose;
}
for (const id of ['#autoPause', '#autoResume', '#offOnClose', '#keepLive']) {
  $(id).onchange = async () => {
    const r = await api('POST', '/api/stream-settings', {
      autoPauseOffline: $('#autoPause').checked,
      autoResumeOnline: $('#autoResume').checked,
      shutdownOnPanelClose: $('#offOnClose').checked,
      keepAliveWhenLive: $('#keepLive').checked,
    });
    data.settings = r.settings;
    fillStream();
    toast('Guardado');
  };
}

// ---------- reloj apagado ----------
let isOff = false;
function showShutdown(reason) {
  if (isOff) return;
  isOff = true;
  window.__es?.close();
  document.title = 'Reloj apagado';
  document.body.innerHTML = `<div class="off-page"><div><h1>Reloj apagado</h1><p>${reason ? reason + '. ' : ''}El tiempo quedó guardado.</p><p>Ya puedes cerrar esta pestaña. Para volver a encenderlo abre <b>iniciar.bat</b>: esta página se reconecta sola.</p></div></div>`;
  // Intenta cerrar la pestaña (el navegador lo permite si se abrió desde iniciar.bat y no navegaste)
  setTimeout(() => window.close(), 1200);
  // Si el reloj vuelve a encenderse, esta pestaña se recarga sola
  const back = async () => {
    try {
      const r = await fetch('/api/version', { cache: 'no-store' });
      if (r.ok) return location.reload();
    } catch { /* sigue apagado: se reintenta */ }
    setTimeout(back, 1500);
  };
  setTimeout(back, 1500);
}
$('#btnLogsFolder').onclick = () => api('POST', '/api/logs/open-folder').then(() => toast('Abriendo la carpeta de logs'));
$('#btnShutdown').onclick = async () => {
  if (!confirm('¿Apagar el reloj?\n\nEl tiempo queda guardado. Para volver a encenderlo abre iniciar.bat.')) return;
  await api('POST', '/api/shutdown').catch(() => {}); /* el reloj corta la conexión al apagarse o reiniciarse */
  showShutdown();
};

// ---------- sonidos ----------
let sounds = null;
function renderSounds() {
  if (!sounds) return;
  $('#sndOn').checked = sounds.enabled;
  if (document.activeElement !== $('#sndVol')) $('#sndVol').value = sounds.volume;
  $('#sndVolTxt').textContent = sounds.volume + '%';
  const list = $('#sndList');
  list.innerHTML = '';
  for (const [k, name] of Object.entries(SubSounds.EVENTS)) {
    const row = document.createElement('div');
    row.className = 'snd';
    row.innerHTML = `<label class="check"><input type="checkbox" ${sounds.events[k] ? 'checked' : ''}> ${name}</label>${sounds.custom?.[k] ? `<span class="own" title="${sounds.custom[k]}">propio</span>` : ''}<button class="ghost sm" data-try>Probar</button><button class="ghost sm" data-obs>En OBS</button>`;
    row.querySelector('input').onchange = (e) => saveSounds({ events: { [k]: e.target.checked } });
    row.querySelector('[data-try]').onclick = () => SubSounds.play(k, { volume: sounds.volume, custom: sounds.custom, last: true });
    row.querySelector('[data-obs]').onclick = () => api('POST', '/api/sounds/test', { event: k }).then(() => toast('Sonando en el overlay'));
    list.appendChild(row);
  }
}
async function saveSounds(body) {
  try {
    const r = await api('POST', '/api/sounds', body);
    sounds = r.sounds;
    renderSounds();
    $('#soundSave').textContent = 'Guardado ✓';
  } catch (e) {
    toast(e.message, true);
  }
}
$('#sndOn').onchange = () => saveSounds({ enabled: $('#sndOn').checked });
$('#sndVol').oninput = () => ($('#sndVolTxt').textContent = $('#sndVol').value + '%');
$('#sndVol').onchange = () => saveSounds({ volume: Number($('#sndVol').value) });
$('#btnSndFolder').onclick = () => api('POST', '/api/sounds/open-folder').then((r) => { sounds = r.sounds; renderSounds(); toast('Abriendo la carpeta de sonidos'); });

// ---------- acceso remoto y usuarios ----------
let remote = null;
const PERM_LABELS = { run: 'Iniciar / pausar', add: 'Sumar / quitar', set: 'Fijar tiempo', mult: 'Multiplicadores', rates: '🔒 Tarifas', money: '🔒 Ver montos', chat: '🔒 Comandos del chat' };
function renderRemote() {
  if (!remote) return;
  document.body.classList.toggle('is-remote', !remote.isLocal);
  $('#remoteOn').checked = remote.enabled;
  $('#remoteOn').disabled = !remote.isLocal;
  $('#remotePw').placeholder = remote.hasPassword ? '•••••••• (guardada; escribe otra para cambiarla)' : 'sin contraseña: admin no puede entrar desde afuera';
  $('#btnRemoteClear').classList.toggle('hidden', !remote.hasPassword);
  $('#btnLogout').classList.toggle('hidden', remote.isLocal);
  $('#remoteRestart').classList.toggle('hidden', !remote.needsRestart || !remote.isLocal);
  $('#remoteSub').textContent = remote.active ? 'Activado' : !remote.hasAnyLogin ? 'Crea un moderador o pon la contraseña de admin para poder activarlo' : 'Desactivado · solo se puede usar en esta PC';
  if (document.activeElement !== $('#modMax')) $('#modMax').value = remote.modMaxSeconds ? fmtDur(remote.modMaxSeconds) : '';

  const ul = $('#remoteAddrs');
  if (!remote.active) ul.innerHTML = '<li class="empty" style="justify-content:center">Activa el acceso remoto para ver las direcciones</li>';
  else if (!remote.addresses.length) ul.innerHTML = '<li class="empty" style="justify-content:center">Esta PC no está conectada a ninguna red</li>';
  else ul.innerHTML = remote.addresses.map((a) => {
    const url = `http://${a.ip}:${remote.port}`;
    return `<li><span class="k ${a.kind === 'tailscale' ? 'ts' : ''}">${a.kind === 'tailscale' ? 'Tailscale' : 'Misma red'}</span><code>${url}</code><button class="ghost sm" data-copytext="${url}">Copiar</button><span class="hint" style="margin:0">Overlay para OBS en otra PC: <code>${url}/overlay</code></span></li>`;
  }).join('');

  const list = $('#userList');
  list.innerHTML = remote.users.length ? '' : '<li class="empty" style="text-align:center">Todavía no hay moderadores</li>';
  for (const u of remote.users) {
    const li = document.createElement('li');
    li.className = u.enabled ? '' : 'off';
    li.innerHTML = `<div class="u-head"><span class="u-name"></span><span class="u-meta">${u.lastLogin ? 'Último acceso: ' + new Date(u.lastLogin).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Nunca entró'}</span>
      <label class="switch" title="Activo"><input type="checkbox" data-act="enabled" ${u.enabled ? 'checked' : ''}><span></span></label>
      <button class="ghost sm" data-act="pw">Cambiar contraseña</button><button class="danger-ghost sm" data-act="del">Eliminar</button></div>
      <div class="perms">${Object.entries(PERM_LABELS).map(([k, t]) => `<label class="check"><input type="checkbox" data-perm-k="${k}" ${u.perms[k] ? 'checked' : ''}> ${t}</label>`).join('')}</div>`;
    li.querySelector('.u-name').textContent = u.name;
    const url = '/api/users/' + encodeURIComponent(u.name);
    li.querySelector('[data-act="enabled"]').onchange = (e) => saveUser('POST', url, { enabled: e.target.checked }, e.target.checked ? `${u.name} activado` : `${u.name} desactivado: ya no puede entrar`);
    li.querySelector('[data-act="pw"]').onclick = () => {
      const pw = prompt(`Nueva contraseña para ${u.name} (mín. 6 caracteres):`);
      if (pw) saveUser('POST', url, { password: pw }, 'Contraseña cambiada: se cerró su sesión');
    };
    li.querySelector('[data-act="del"]').onclick = () => confirm(`¿Eliminar a ${u.name}? Se cierra su sesión al instante.`) && saveUser('DELETE', url, null, `${u.name} eliminado`);
    li.querySelectorAll('[data-perm-k]').forEach((cb) => (cb.onchange = () => {
      const perms = Object.fromEntries([...li.querySelectorAll('[data-perm-k]')].map((x) => [x.dataset.permK, x.checked]));
      saveUser('POST', url, { perms }, 'Permisos guardados');
    }));
    list.appendChild(li);
  }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copytext]');
  if (!b) return;
  navigator.clipboard.writeText(b.dataset.copytext);
  toast('Copiado');
});
async function loadRemote() {
  remote = await api('GET', '/api/remote');
  renderRemote();
}
async function saveRemote(body, msg) {
  try {
    const r = await api('POST', '/api/remote', body);
    remote = r.remote;
    renderRemote();
    if (msg) toast(msg);
  } catch (e) {
    toast(e.message, true);
    renderRemote();
  }
}
async function saveUser(method, url, body, msg) {
  try {
    const r = await api(method, url, body);
    remote = r.remote;
    renderRemote();
    toast(msg);
    return true;
  } catch (e) {
    toast(e.message, true);
    renderRemote();
    return false;
  }
}
$('#btnAddUser').onclick = async () => {
  const perms = Object.fromEntries($$('#uPerms [data-p]').map((x) => [x.dataset.p, x.checked]));
  const name = $('#uName').value.trim();
  if (await saveUser('POST', '/api/users', { name, password: $('#uPw').value, perms }, `Usuario ${name.toLowerCase()} creado`)) {
    $('#uName').value = '';
    $('#uPw').value = '';
  }
};
$('#btnRemotePw').onclick = () => {
  const pw = $('#remotePw').value;
  if (pw.length < 6) return toast('La contraseña debe tener al menos 6 caracteres', true);
  saveRemote({ password: pw }, 'Contraseña de admin guardada').then(() => ($('#remotePw').value = ''));
};
$('#btnRemoteClear').onclick = () => confirm('¿Quitar la contraseña de admin? Ya no podrás entrar como dueño desde otra PC.') && saveRemote({ removePassword: true }, 'Contraseña de admin quitada');
$('#remoteOn').onchange = () => saveRemote({ enabled: $('#remoteOn').checked }, $('#remoteOn').checked ? 'Activado: reinicia el reloj para aplicarlo' : 'Desactivado: reinicia el reloj para aplicarlo');
$('#modMax').addEventListener('change', () => {
  const v = parseDur($('#modMax').value);
  saveRemote({ modMaxSeconds: Math.max(0, v ?? 0) }, 'Máximo guardado');
});
$('#btnLogout').onclick = async () => {
  await api('POST', '/api/logout').catch((err) => console.warn('[Salir]', err));
  location.href = '/login';
};
$('#btnRestart').onclick = async () => {
  await api('POST', '/api/restart').catch(() => {}); /* el reloj corta la conexión al apagarse o reiniciarse */
  toast('Reiniciando el reloj…');
  window.__es?.close();
  const t0 = Date.now();
  const wait = async () => {
    try {
      const r = await fetch('/api/remote', { cache: 'no-store' });
      if (!r.ok) throw 0;
      location.reload();
    } catch {
      if (Date.now() - t0 < 30000) setTimeout(wait, 800);
      else toast('El reloj no volvió a abrir: ábrelo con iniciar.bat', true);
    }
  };
  setTimeout(wait, 1500);
};

// ---------- simulador ----------
$('#simSource').onchange = () => {
  const subs = $('#simSource').value === 'subs';
  $$('.sim-subs').forEach((e) => e.classList.toggle('hidden', !subs));
  $$('.sim-money').forEach((e) => e.classList.toggle('hidden', subs));
  $('#simAmount').value = $('#simSource').value === 'bits' ? 500 : $('#simSource').value === 'mercadopago' ? 5000 : 5;
};
$('#btnSim').onclick = async () => {
  const source = $('#simSource').value;
  try {
    const r = await api('POST', '/api/simulate', {
      source,
      user: $('#simUser').value,
      amount: Number($('#simAmount').value),
      kind: $('#simKind').value,
      tier: Number($('#simTier').value),
      count: Number($('#simCount').value),
    });
    const e = r.entry;
    toast(e.seconds > 0 ? `+${fmtDur(e.seconds)}${e.multiplier > 1 ? ` (x${e.multiplier})` : ''}` : e.note || 'No sumó tiempo', !(e.seconds > 0));
  } catch (err) {
    toast(err.message, true);
  }
};

$('#btnSimLive').onclick = () => api('POST', '/api/simulate-stream', { live: true });
$('#btnSimOff').onclick = () => api('POST', '/api/simulate-stream', { live: false });

// ---------- historial ----------
function logItem(e, fresh) {
  const li = document.createElement('li');
  if (fresh) li.className = 'fresh';
  const cls = e.seconds > 0 ? '' : e.seconds < 0 ? 'neg' : 'zero';
  li.innerHTML = `<span class="t">${new Date(e.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span>
    <span class="tag ${e.source}">${LABELS[e.source] || e.source}</span>
    <span class="txt"></span>
    <span class="plus ${cls}">${e.seconds > 0 ? '+' : ''}${fmtDur(e.seconds)}${e.multiplier > 1 ? `<span class="xm">x${e.multiplier}</span>` : ''}</span>`;
  const txt = li.querySelector('.txt');
  txt.textContent = e.text;
  if (e.test) txt.insertAdjacentHTML('beforeend', '<span class="test">(prueba)</span>');
  if (e.note) {
    const n = document.createElement('span');
    n.className = 'note';
    n.textContent = e.note;
    txt.appendChild(n);
  }
  return li;
}
function renderLog() {
  const ul = $('#log');
  ul.innerHTML = '';
  if (!data.log.length) ul.innerHTML = '<li class="empty" style="display:block">Todavía no hay eventos</li>';
  data.log.forEach((e) => ul.appendChild(logItem(e)));
}
function renderStats() {
  const st = data.stats || {};
  const total = Object.values(st).reduce((a, s) => a + (s.seconds || 0), 0);
  const cells = SOURCES.map((s) => {
    const x = st[s] || { count: 0, amount: 0, seconds: 0 };
    const main = s === 'subs' ? `${x.count} subs` : s === 'bits' ? `${x.amount} bits` : `${x.amount} ${data.rates[s].currency}`;
    return `<div class="stat"><div class="k">${LABELS[s]}</div><div class="v">${main}</div><div class="s">+${fmtDur(x.seconds)}</div></div>`;
  });
  cells.push(`<div class="stat"><div class="k">Total sumado</div><div class="v">${fmtDur(total)}</div><div class="s">sin contar pruebas</div></div>`);
  $('#stats').innerHTML = cells.join('');
}
$('#btnClearLog').onclick = () => confirm('¿Borrar el historial? (no cambia el reloj)') && api('POST', '/api/log/clear');
$('#btnReset').onclick = () => confirm('¿Reiniciar el subatón?\n\nEl reloj vuelve al tiempo inicial y en pausa, y se borran historial y totales.') && api('POST', '/api/reset').then(() => toast('Subatón reiniciado'));

// ---------- carga y tiempo real ----------
async function load() {
  data = await api('GET', '/api/data');
  state = data.state;
  receivedAt = Date.now();
  serverOffset = state.serverNow - Date.now();
  const overlay = `${location.origin}/overlay`;
  $('#overlayUrl').textContent = overlay;
  $('#overlayOpen').href = overlay;
  fillRates();
  fillSecrets();
  fillChat();
  fillStream();
  sounds = data.state.sounds;
  renderSounds();
  loadRemote().catch((err) => console.warn('[Acceso remoto]', err));
  renderConnections();
  renderSchedules();
  renderLog();
  renderStats();
  renderState();
}

function connect() {
  const es = (window.__es = new EventSource('/events'));
  // Si se corta la conexión (reloj reiniciándose o apagado), avisa y al volver recarga todo
  let lost = null;
  es.onerror = () => {
    if (isOff || lost) return;
    lost = setTimeout(() => {
      if (es.readyState !== 1 && !isOff && !$('.conn-banner')) document.body.insertAdjacentHTML('afterbegin', '<div class="conn-banner">Sin conexión con el reloj… reintentando</div>');
    }, 1500);
  };
  es.onopen = () => {
    if (lost) {
      clearTimeout(lost);
      if ($('.conn-banner')) location.reload();
      lost = null;
    }
  };
  es.onmessage = async (ev) => {
    const { type, payload } = JSON.parse(ev.data);
    if (type === 'shutdown') return showShutdown(payload?.reason);
    if (!data) return;
    if (type === 'state') {
      state = payload;
      receivedAt = Date.now();
      serverOffset = payload.serverNow - Date.now();
      renderState();
    } else if (type === 'log') {
      data.log.unshift(payload);
      const ul = $('#log');
      ul.querySelector('.empty')?.remove();
      ul.prepend(logItem(payload, true));
      if (!payload.test && payload.source !== 'manual') {
        const r = await api('GET', '/api/data');
        data.stats = r.stats;
        renderStats();
      }
    } else if (type === 'multiplier') {
      data.multiplier = payload;
      renderSchedules();
    } else if (type === 'connections') {
      data.connections = payload;
      renderConnections();
    } else if (type === 'config') {
      data.settings = payload.settings;
      data.rates = payload.rates;
      if (!document.activeElement?.closest('.rates, .settings-row')) fillRates();
      else renderDaily();
      renderStats();
    } else if (type === 'reset') {
      const r = await api('GET', '/api/data');
      Object.assign(data, { log: r.log, stats: r.stats, multiplier: r.multiplier });
      renderLog();
      renderStats();
      renderSchedules();
    }
  };
}

load().then(connect).catch((e) => toast('No se pudo cargar el panel: ' + e.message, true));

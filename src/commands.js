// Comandos del chat de Twitch para controlar el reloj (solo tú, mods, supermods y la gente que elijas)
const { fmtDuration } = require('./engine');

// "10" = 10 minutos · "1:30" = 1 min 30 s · "2:00:00" = 2 horas · también "30s", "10m", "2h", "1h30m"
function parseDur(str) {
  str = String(str || '').trim().toLowerCase().replace(',', '.');
  if (!str) return null;
  if (str.includes(':')) {
    const p = str.split(':').map(Number);
    if (p.some((n) => !Number.isFinite(n) || n < 0)) return null;
    return Math.round(p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]);
  }
  const units = str.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?:in)?)?(?:(\d+(?:\.\d+)?)s)?$/);
  if (units && (units[1] || units[2] || units[3])) {
    return Math.round((Number(units[1]) || 0) * 3600 + (Number(units[2]) || 0) * 60 + (Number(units[3]) || 0));
  }
  const n = Number(str);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : null;
}

const SOURCE_WORDS = {
  paypal: 'paypal', pp: 'paypal',
  mp: 'mercadopago', mercadopago: 'mercadopago', mercado: 'mercadopago',
  bits: 'bits', bit: 'bits',
  subs: 'subs', sub: 'subs',
};
const SOURCE_LABEL = { paypal: 'PayPal', mercadopago: 'Mercado Pago', bits: 'Bits', subs: 'Subs' };

function createCommands({ store, timer, engine, twitch, setManualMultiplier, podio }) {
  const d = () => store.data;
  let lastPublic = 0;

  function permission(e) {
    const c = d().chat;
    const badges = new Set((e.badges || []).map((b) => b.set_id));
    const login = String(e.chatter_user_login || '').toLowerCase();
    if (e.chatter_user_id === e.broadcaster_user_id || badges.has('broadcaster')) return true;
    if (c.users.map((u) => u.toLowerCase()).includes(login)) return true;
    if (c.allowLeadMods && badges.has('lead_moderator')) return true;
    if (c.allowMods && (badges.has('moderator') || badges.has('lead_moderator'))) return true;
    if (c.allowVips && badges.has('vip')) return true;
    return false;
  }

  function remainingText() {
    const m = engine.multiplierStatus();
    const mult = m.value > 1 ? ` · x${m.value} en ${m.labels.join(', ')}` : '';
    const state = timer.ended ? ' (terminado)' : timer.running ? '' : ' (en pausa)';
    return `⏱ Quedan ${fmtDuration(timer.remainingMs / 1000)}${state}${mult}`;
  }

  function capped(seconds) {
    const max = Number(d().chat.maxPerCommand) || 0;
    return max > 0 ? Math.min(seconds, max) : seconds;
  }

  async function handle(e) {
    const c = d().chat;
    if (!c.enabled) return;
    const text = String(e.message?.text || '').trim();
    const prefix = c.prefix || '!';
    if (!text.startsWith(prefix)) return;

    const [rawCmd, ...args] = text.slice(prefix.length).trim().split(/\s+/);
    const cmd = (rawCmd || '').toLowerCase();
    const who = e.chatter_user_name || e.chatter_user_login;
    const reply = (msg) => c.reply && twitch.sendChat(msg, e.message_id);

    // Comando público para ver el tiempo
    if (cmd === 'tiempo' || cmd === 'reloj') {
      const allowed = permission(e) || c.publicTime;
      if (!allowed) return;
      if (!permission(e) && Date.now() - lastPublic < 15000) return;
      lastPublic = Date.now();
      return reply(remainingText());
    }

    const KNOWN = ['mp.add', 'vincular', 'sumar', 'agregar', 'add', 'quitar', 'restar', 'fijar', 'pausa', 'pausar', 'iniciar', 'seguir', 'play', 'multi', 'x1', 'multioff', 'comandos', 'ayuda'];
    const multMatch = cmd.match(/^x(\d+(?:\.\d+)?)$/);
    if (!KNOWN.includes(cmd) && !multMatch) return;
    if (!permission(e)) return;

    const log = (t) => engine.logNote(`${who}: ${t}`);
    console.log(`[Chat] ${who} → ${text}`);

    switch (cmd) {
      // !mp.add @usuario [monto] → la última donación de Mercado Pago pasa a ser de ese usuario de Twitch (y las próximas de esa persona también)
      case 'mp.add':
      case 'vincular': {
        const usuario = (args[0] || '').replace(/^@/, '');
        if (!usuario || !podio) return reply(`Uso: ${prefix}mp.add @usuario (la última donación de Mercado Pago) · ${prefix}mp.add @usuario 1500 (la de ese monto)`);
        try {
          const ev = podio.vincularMP(usuario, args[1]);
          return reply(`✅ La donación de Mercado Pago de ${Number(ev.amount).toLocaleString('es')} ${ev.currency} ahora es de @${usuario}${ev.recordado ? ' · las próximas de esa persona ya llegan con su nombre' : ''}`);
        } catch (err) { return reply('⚠️ ' + err.message); }
      }
      case 'sumar':
      case 'agregar':
      case 'add': {
        const s = parseDur(args[0]);
        if (!s) return reply(`Uso: ${prefix}sumar 10 (minutos) · ${prefix}sumar 1:30 · ${prefix}sumar 2h`);
        const entry = engine.manualAdjust(capped(s), `${who} sumó tiempo (${prefix}sumar)`);
        return reply(`✅ +${fmtDuration(entry.seconds)} · quedan ${fmtDuration(timer.remainingMs / 1000)}`);
      }
      case 'quitar':
      case 'restar': {
        const s = parseDur(args[0]);
        if (!s) return reply(`Uso: ${prefix}quitar 5 (minutos) · ${prefix}quitar 0:30`);
        const entry = engine.manualAdjust(-capped(s), `${who} quitó tiempo (${prefix}quitar)`);
        return reply(`➖ ${fmtDuration(Math.abs(entry.seconds))} · quedan ${fmtDuration(timer.remainingMs / 1000)}`);
      }
      case 'fijar': {
        const s = parseDur(args[0]);
        if (s === null) return reply(`Uso: ${prefix}fijar 3:00:00`);
        timer.set(s * 1000);
        log(`fijó el reloj en ${fmtDuration(s)}`);
        return reply(`🕒 Reloj fijado en ${fmtDuration(s)}`);
      }
      case 'pausa':
      case 'pausar':
        timer.pause();
        log('pausó el reloj');
        return reply('⏸ Reloj en pausa');
      case 'iniciar':
      case 'seguir':
      case 'play':
        if (!timer.start()) return reply(timer.running ? 'El reloj ya está corriendo' : 'El reloj está en 0: usa ' + prefix + 'fijar primero');
        log('inició el reloj');
        return reply('▶ ¡Reloj corriendo! ' + remainingText());
      case 'x1':
      case 'multioff':
        setManualMultiplier({ active: false });
        log('apagó el multiplicador');
        return reply('Multiplicador apagado');
      case 'comandos':
      case 'ayuda':
        return reply(`${prefix}tiempo · ${prefix}mp.add @usuario · ${prefix}sumar 10 · ${prefix}quitar 5 · ${prefix}fijar 3:00:00 · ${prefix}pausa · ${prefix}iniciar · ${prefix}x2 30 [subs bits paypal mp] · ${prefix}multioff`);
    }

    // !x2 30 subs bits  ·  !multi 2.5 15
    let value, rest;
    if (multMatch) {
      value = Number(multMatch[1]);
      rest = args;
    } else {
      value = Number(args[0]);
      rest = args.slice(1);
    }
    if (!(value >= 1)) return reply(`Uso: ${prefix}x2 30 (minutos) [subs bits paypal mp]`);
    if (value === 1) {
      setManualMultiplier({ active: false });
      return reply('Multiplicador apagado');
    }
    let minutes = 0;
    if (rest[0] && !SOURCE_WORDS[rest[0].toLowerCase()]) {
      const s = parseDur(rest.shift());
      if (s === null) return reply(`Uso: ${prefix}x2 30 (minutos) [subs bits paypal mp]`);
      minutes = s / 60;
    }
    const picked = rest.map((w) => SOURCE_WORDS[w.toLowerCase()]).filter(Boolean);
    const appliesTo = { paypal: false, mercadopago: false, bits: false, subs: false };
    (picked.length ? picked : Object.keys(appliesTo)).forEach((k) => (appliesTo[k] = true));
    setManualMultiplier({ active: true, value, minutes, appliesTo });
    const srcs = picked.length ? [...new Set(picked)].map((k) => SOURCE_LABEL[k]).join(', ') : 'todo';
    log(`activó x${value} en ${srcs}${minutes ? ` por ${fmtDuration(minutes * 60)}` : ''}`);
    return reply(`🔥 x${value} activado en ${srcs}${minutes ? ` por ${fmtDuration(minutes * 60)}` : ' hasta que se apague'}`);
  }

  return { handle };
}

module.exports = { createCommands };

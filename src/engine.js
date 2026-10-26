// Convierte cada donación / bits / sub en tiempo, aplicando tarifas y multiplicadores
const crypto = require('crypto');

const SOURCES = ['paypal', 'mercadopago', 'bits', 'subs'];
const LABELS = { paypal: 'PayPal', mercadopago: 'Mercado Pago', bits: 'Bits', subs: 'Subs', manual: 'Manual' };

function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Math.abs(totalSeconds)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function createEngine({ store, timer, broadcast }) {
  const d = () => store.data;
  const processed = new Set(d().processed);

  function remember(key) {
    processed.add(key);
    d().processed.push(key);
    if (d().processed.length > 3000) {
      const removed = d().processed.splice(0, d().processed.length - 3000);
      removed.forEach((k) => processed.delete(k));
    }
  }

  // ---------- Multiplicadores ----------
  function activeMultipliers(now = Date.now()) {
    const list = [];
    const m = d().multiplier.manual;
    if (m.active) {
      if (m.until && now >= m.until) {
        m.active = false;
        store.save();
      } else {
        list.push({ kind: 'manual', value: Number(m.value) || 1, since: m.since || null, until: m.until, appliesTo: m.appliesTo });
      }
    }
    for (const s of d().multiplier.schedules) {
      if (now >= s.start && now < s.end) list.push({ kind: 'programado', id: s.id, value: Number(s.value) || 1, since: s.start, until: s.end, appliesTo: s.appliesTo });
    }
    return list;
  }

  function multiplierFor(source, now = Date.now()) {
    let best = 1;
    for (const a of activeMultipliers(now)) if (a.appliesTo?.[source] && a.value > best) best = a.value;
    return best;
  }

  function multiplierStatus(now = Date.now()) {
    const active = activeMultipliers(now);
    const bySource = {};
    for (const src of SOURCES) bySource[src] = multiplierFor(src, now);
    const top = Math.max(1, ...Object.values(bySource));
    const sources = SOURCES.filter((s) => bySource[s] === top && top > 1);
    const ends = active.filter((a) => a.value === top && a.until).map((a) => a.until);
    const indefinite = active.some((a) => a.value === top && !a.until);
    return {
      value: top,
      bySource,
      sources,
      labels: sources.map((s) => LABELS[s]),
      until: top > 1 && !indefinite && ends.length ? Math.max(...ends) : null,
      since: top > 1 ? Math.min(...active.filter((a) => a.value === top && a.since).map((a) => a.since), Date.now()) : null,
    };
  }

  // ---------- Tarifas ----------
  function baseSeconds(ev) {
    const r = d().rates[ev.source];
    if (!r || !r.enabled) return { secs: 0, note: `${LABELS[ev.source]} desactivado` };

    if (ev.source === 'subs') {
      if (ev.kind === 'resub' && !r.countResubs) return { secs: 0, note: 'Resubs desactivados' };
      if (ev.kind === 'gift' && !r.countGifts) return { secs: 0, note: 'Subs regaladas desactivadas' };
      const per = Number(r['tier' + (ev.tier || 1)] ?? r.tier1) || 0;
      return { secs: per * (ev.count || 1) };
    }

    const amount = Number(ev.amount) || 0;
    const block = Number(r.amount) || 0;
    if (block <= 0) return { secs: 0, note: 'Tarifa sin monto configurado' };
    if (ev.source !== 'bits' && r.currency && ev.currency && r.currency.toUpperCase() !== String(ev.currency).toUpperCase()) {
      return { secs: 0, note: `Moneda ${ev.currency} distinta de ${r.currency} (no se sumó)` };
    }
    if (amount < (Number(r.minAmount) || 0)) return { secs: 0, note: 'Por debajo del mínimo' };
    const units = r.proportional ? amount / block : Math.floor(amount / block);
    return { secs: units * (Number(r.seconds) || 0) };
  }

  function describe(e) {
    const who = e.user || 'Alguien';
    switch (e.source) {
      case 'paypal':
      case 'mercadopago':
        return `${who} donó ${e.amount} ${e.currency || ''}${e.via ? ` (vía ${e.via})` : ''}`.trim();
      case 'bits':
        return `${who} envió ${e.amount} bits${e.kind ? ` (${e.kind})` : ''}`;
      case 'subs':
        if (e.kind === 'gift') return `${who} regaló ${e.count} sub${e.count > 1 ? 's' : ''} (Tier ${e.tier})`;
        if (e.kind === 'resub') return `${who} renovó su sub${e.months ? ` (${e.months} meses)` : ''} (Tier ${e.tier})`;
        return `${who} se suscribió (Tier ${e.tier})`;
      default:
        return e.text || 'Ajuste manual';
    }
  }

  function pushLog(entry) {
    d().log.unshift(entry);
    if (d().log.length > 500) d().log.length = 500;
    broadcast('log', entry);
  }

  // ---------- Entrada principal: llega una donación / bits / sub ----------
  function contribute(ev) {
    if (ev.id) {
      const key = `${ev.source}:${ev.id}`;
      if (processed.has(key)) return { duplicate: true };
      remember(key);
    }

    const { secs, note: baseNote } = baseSeconds(ev);
    const mult = multiplierFor(ev.source);
    const wanted = Math.round(secs * mult);
    let note = baseNote || '';
    let addedMs = 0;

    if (wanted > 0) {
      if (d().settings.descanso && !d().settings.descansoSumaTiempo) {
        note = 'En descanso: cuenta para el podio y las metas, no suma tiempo';
      } else if (timer.ended && !d().settings.addAfterEnd) {
        note = 'El subatón ya terminó (no se sumó)';
      } else {
        addedMs = timer.add(wanted * 1000, (Number(d().settings.maxSeconds) || 0) * 1000);
        if (addedMs < wanted * 1000) note = 'Limitado por el tiempo máximo';
      }
    }

    const entry = {
      id: crypto.randomUUID(),
      at: Date.now(),
      source: ev.source,
      kind: ev.kind || null,
      user: ev.user || '',
      amount: ev.amount ?? null,
      currency: ev.currency || null,
      tier: ev.tier || null,
      count: ev.count || null,
      months: ev.months || null,
      via: ev.via || null,
      payer: ev.payer || null,
      multiplier: mult,
      seconds: Math.round(addedMs / 1000),
      note,
      test: !!ev.test,
    };
    entry.text = describe(entry);

    if (!entry.test) {
      const st = (d().stats[ev.source] ||= { count: 0, amount: 0, seconds: 0 });
      st.count += ev.source === 'subs' ? ev.count || 1 : 1;
      if (ev.source !== 'subs') st.amount = Math.round((st.amount + (Number(ev.amount) || 0)) * 100) / 100;
      st.seconds += entry.seconds;
    }

    pushLog(entry);
    if (entry.seconds > 0) broadcast('added', { text: entry.text, seconds: entry.seconds, multiplier: mult, source: ev.source, user: entry.user });
    store.save();
    console.log(`[${LABELS[ev.source]}] ${entry.text} → +${fmtDuration(entry.seconds)}${mult > 1 ? ` (x${mult})` : ''}${note ? ` · ${note}` : ''}`);
    return entry;
  }

  function manualAdjust(seconds, text) {
    const addedMs = timer.add(seconds * 1000, seconds > 0 ? (Number(d().settings.maxSeconds) || 0) * 1000 : 0);
    const secs = Math.round(addedMs / 1000);
    const entry = {
      id: crypto.randomUUID(),
      at: Date.now(),
      source: 'manual',
      multiplier: 1,
      seconds: secs,
      text: text || (secs >= 0 ? 'Tiempo agregado a mano' : 'Tiempo quitado a mano'),
      note: '',
    };
    pushLog(entry);
    console.log(`[Manual] ${entry.text}: ${secs >= 0 ? '+' : '-'}${fmtDuration(secs)} → quedan ${fmtDuration(timer.remainingMs / 1000)}`);
    if (secs > 0) broadcast('added', { text: '', seconds: secs, multiplier: 1, source: 'manual' });
    store.save();
    return entry;
  }

  function logNote(text) {
    const entry = { id: crypto.randomUUID(), at: Date.now(), source: 'manual', multiplier: 1, seconds: 0, text, note: '' };
    pushLog(entry);
    console.log(`[Manual] ${text}`);
    store.save();
    return entry;
  }

  return { contribute, manualAdjust, logNote, multiplierFor, multiplierStatus, activeMultipliers, SOURCES, LABELS };
}

module.exports = { createEngine, fmtDuration, LABELS, SOURCES };

// Sonidos del reloj: generados en el momento (sin archivos ni derechos de autor).
// Si pones un archivo propio en la carpeta "sonidos" (ej. sub.mp3), se usa ese en lugar del generado.
(function () {
  const EVENTS = {
    sub: 'Sub / resub',
    bits: 'Bits',
    paypal: 'PayPal',
    mercadopago: 'Mercado Pago',
    grande: 'Aporte grande',
    multiplicador: 'Multiplicador activado',
    final: 'Últimos 10 segundos (tic)',
    fin: 'Fin del subatón',
    manual: 'Tiempo agregado a mano',
  };

  let ctx = null;
  const ac = () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  };

  // Un tono con envolvente suave
  function tone(out, { f, t = 0, d = 0.3, type = 'sine', g = 0.3, f2 = null, a = 0.008 }) {
    const c = out.context;
    const o = c.createOscillator();
    const v = c.createGain();
    const t0 = c.currentTime + t;
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d);
    v.gain.setValueAtTime(0.0001, t0);
    v.gain.exponentialRampToValueAtTime(g, t0 + a);
    v.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(v).connect(out);
    o.start(t0);
    o.stop(t0 + d + 0.05);
  }

  const N = (n) => 440 * Math.pow(2, (n - 69) / 12); // nota MIDI → Hz

  const SYNTH = {
    sub(out) {
      [72, 76, 79, 84].forEach((n, i) => tone(out, { f: N(n), t: i * 0.085, d: 0.45, type: 'triangle', g: 0.4 }));
      tone(out, { f: N(96), t: 0.34, d: 0.5, type: 'sine', g: 0.08 });
    },
    bits(out) {
      for (let i = 0; i < 6; i++) tone(out, { f: 1400 + Math.random() * 1400, t: i * 0.045, d: 0.12, type: 'square', g: 0.13 });
      tone(out, { f: N(88), t: 0.27, d: 0.4, type: 'sine', g: 0.32 });
    },
    paypal(out) {
      tone(out, { f: N(83), t: 0, d: 0.09, type: 'square', g: 0.3 });
      tone(out, { f: N(88), t: 0.08, d: 0.45, type: 'square', g: 0.3 });
    },
    mercadopago(out) {
      tone(out, { f: N(81), t: 0, d: 0.09, type: 'square', g: 0.3 });
      tone(out, { f: N(86), t: 0.08, d: 0.45, type: 'square', g: 0.3 });
    },
    grande(out) {
      [67, 72, 76, 79].forEach((n, i) => tone(out, { f: N(n), t: i * 0.11, d: 0.3, type: 'triangle', g: 0.3 }));
      [72, 76, 79, 84].forEach((n) => tone(out, { f: N(n), t: 0.5, d: 1.3, type: 'triangle', g: 0.16, a: 0.03 }));
      tone(out, { f: N(48), t: 0.5, d: 1.2, type: 'sine', g: 0.3, a: 0.02 });
      for (let i = 0; i < 8; i++) tone(out, { f: 2000 + Math.random() * 2000, t: 0.55 + i * 0.07, d: 0.15, type: 'sine', g: 0.05 });
    },
    multiplicador(out) {
      const c = out.context;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(600, c.currentTime);
      lp.frequency.exponentialRampToValueAtTime(5000, c.currentTime + 0.55);
      lp.connect(out);
      tone(lp, { f: 180, f2: 1100, t: 0, d: 0.6, type: 'sawtooth', g: 0.3, a: 0.05 });
      tone(lp, { f: 270, f2: 1650, t: 0, d: 0.6, type: 'sawtooth', g: 0.15, a: 0.05 });
      tone(out, { f: N(91), t: 0.58, d: 0.6, type: 'triangle', g: 0.42 });
      tone(out, { f: N(96), t: 0.66, d: 0.7, type: 'sine', g: 0.12 });
    },
    final(out, opts = {}) {
      tone(out, { f: opts.last ? 1500 : 1000, t: 0, d: 0.06, type: 'square', g: 0.2, a: 0.002 });
    },
    fin(out) {
      [[110, 0.4], [220, 0.22], [331, 0.14], [442, 0.08], [557, 0.05]].forEach(([f, g]) => tone(out, { f, t: 0, d: 3, type: 'sine', g, a: 0.005 }));
      [72, 76, 79].forEach((n, i) => tone(out, { f: N(n), t: 0.25 + i * 0.12, d: 1.2, type: 'triangle', g: 0.12 }));
    },
    manual(out) {
      tone(out, { f: 520, f2: 880, t: 0, d: 0.14, type: 'sine', g: 0.4 });
    },
  };

  // play('sub', { volume: 0-100, custom: { sub: 'sub.mp3' }, base: '/sonidos/', last: bool })
  function play(event, opts = {}) {
    const vol = Math.max(0, Math.min(100, opts.volume ?? 70)) / 100;
    if (!vol) return;
    const file = opts.custom && opts.custom[event];
    if (file) {
      const a = new Audio((opts.base || '/sonidos/') + encodeURIComponent(file));
      a.volume = vol;
      a.play().catch(() => {});
      return;
    }
    const fn = SYNTH[event];
    if (!fn) return;
    try {
      const c = ac();
      const master = c.createGain();
      master.gain.value = vol;
      master.connect(c.destination);
      fn(master, opts);
    } catch (e) {
      console.warn('[Sonidos]', event, e);
    }
  }

  // Dibuja un sonido en cualquier AudioContext (lo usa la vista previa)
  function renderTo(c, event, opts = {}) {
    const master = c.createGain();
    master.gain.value = (opts.volume ?? 70) / 100;
    master.connect(c.destination);
    SYNTH[event](master, opts);
  }

  window.SubSounds = { play, renderTo, EVENTS, unlock: () => { try { ac(); } catch (e) { console.warn('[Sonidos] Audio no disponible:', e); } } };
})();

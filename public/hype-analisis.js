// Analiza una canción y arma los tiempos para sincronizar el tren del hype:
// ritmo (BPM), dónde cae cada golpe, golpes fuertes (drops), la parte que se repite y el final.
// Uso: const perfil = HypeAnalisis.analizar(audioBuffer)
(function () {
  function mono(buf) {
    const n = buf.length, out = new Float32Array(n), ch = buf.numberOfChannels;
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / ch; }
    return out;
  }
  const media = (a, i, j) => { let s = 0, k = 0; for (let x = Math.max(0, i); x < Math.min(a.length, j); x++) { s += a[x]; k++; } return k ? s / k : 0; };

  function analizar(buf) {
    const sr = buf.sampleRate, x = mono(buf), hop = Math.round(sr / 86), fps = sr / hop, nF = Math.floor(x.length / hop);
    // energía por cuadro (volumen) y energía de agudos (para los golpes)
    const rms = new Float32Array(nF), agudo = new Float32Array(nF);
    for (let f = 0; f < nF; f++) {
      let s = 0, h = 0; const a = f * hop, b = Math.min(x.length, a + hop * 2);
      for (let i = a + 1; i < b; i++) { s += x[i] * x[i]; const d = x[i] - x[i - 1]; h += d * d; }
      rms[f] = Math.sqrt(s / (b - a)); agudo[f] = Math.sqrt(h / (b - a));
    }
    // fuerza de cada golpe: subida de energía (en escala logarítmica)
    const on = new Float32Array(nF);
    for (let f = 1; f < nF; f++) on[f] = Math.max(0, Math.log(1e-4 + agudo[f]) - Math.log(1e-4 + agudo[f - 1])) + 0.5 * Math.max(0, Math.log(1e-4 + rms[f]) - Math.log(1e-4 + rms[f - 1]));
    const mOn = on.reduce((a, b) => a + b, 0) / nF; for (let f = 0; f < nF; f++) on[f] = Math.max(0, on[f] - mOn);

    // 1) ritmo: autocorrelación + ajuste fino con una grilla de golpes
    let mejor = { lag: 0, v: -1 };
    for (let lag = Math.floor(fps * 60 / 190); lag <= Math.ceil(fps * 60 / 70); lag++) {
      let v = 0; for (let f = 0; f + lag < nF; f++) v += on[f] * on[f + lag];
      if (v > mejor.v) mejor = { lag, v };
    }
    let bpm = 60 * fps / mejor.lag;
    while (bpm < 95) bpm *= 2; while (bpm > 180) bpm /= 2;
    const grilla = (b) => { // mejor fase para un BPM dado
      const P = 60 / b * fps; let best = { s: -1, fase: 0 };
      for (let ph = 0; ph < P; ph += 0.5) { let s = 0; for (let t = ph; t < nF; t += P) { const i = Math.round(t); s += on[i] + 0.5 * ((on[i - 1] || 0) + (on[i + 1] || 0)); } if (s > best.s) best = { s, fase: ph }; }
      return best;
    };
    let fino = { bpm, ...grilla(bpm) };
    for (let b = bpm - 2; b <= bpm + 2; b += 0.05) { const g = grilla(b); if (g.s > fino.s) fino = { bpm: b, ...g }; }
    bpm = Math.round(fino.bpm * 10) / 10; if (Math.abs(bpm - Math.round(bpm)) < 0.15) bpm = Math.round(bpm);
    const P = 60 / bpm; let golpe = (fino.fase / fps) % P, golpeAj = null;
    const aGolpe = (t) => { const g0 = golpeAj ?? golpe; return g0 + Math.round((t - g0) / P) * P; };

    // 2) volumen suavizado por segundo y fin real de la música
    const vol = (t0, t1) => media(rms, Math.round(t0 * fps), Math.round(t1 * fps));
    const dur = nF / fps, maxV = Math.max(...Array.from({ length: Math.floor(dur) }, (_, s) => vol(s, s + 1)));
    let finMusica = dur; while (finMusica > 1 && vol(finMusica - 1, finMusica) < maxV * 0.06) finMusica -= 0.25;

    // 3) golpes fuertes: el volumen salta después de una bajada
    const golpes = [];
    for (let t = 0.5; t < finMusica - 2; t += 0.05) {
      const antes = vol(t - 1.2, t - 0.1), despues = vol(t + 0.05, t + 2.5);
      if (despues > maxV * 0.45 && despues > antes * 1.6) golpes.push({ t: aGolpe(t), fuerza: despues / Math.max(antes, maxV * 0.03), vol: despues });
    }
    // cada zona candidata: buscar el instante exacto del salto de volumen y pegarlo al golpe más cercano
    const salto = (t) => vol(t, t + 0.2) - vol(t - 0.45, t - 0.05);
    for (const g of golpes) {
      let mejorT = g.t, mejorS = -1;
      for (let t = g.t - 0.6; t <= g.t + 2.6; t += 1 / fps) { const s2 = salto(t); if (s2 > mejorS) { mejorS = s2; mejorT = t; } }
      g.raw = mejorT; g.t = aGolpe(mejorT); g.salto = mejorS;
    }
    // uno por zona: el salto más fuerte en cada 6 s
    golpes.sort((a, b) => (b.salto * b.fuerza) - (a.salto * a.fuerza));
    const hits = [];
    for (const g of golpes) if (!hits.some((h) => Math.abs(h.t - g.t) < 6)) hits.push(g);
    hits.sort((a, b) => a.t - b.t);
    // afinar la fase con los golpes fuertes reales (la grilla puede quedar unos milisegundos corrida)
    if (hits.length >= 2) {
      const difs = hits.map((h) => { const d = h.raw - aGolpe(h.raw); return d; }).sort((a, b) => a - b);
      const off = difs[Math.floor(difs.length / 2)];
      if (Math.abs(off) < P / 3) { golpeAj = ((golpe + off) % P + P) % P; for (const h of hits) h.t = golpeAj + Math.round((h.raw - golpeAj) / P) * P; }
    }
    for (const h of hits) h.vol = vol(h.t + 0.05, h.t + 2.5);

    // 4) entrada del tren: el primer golpe con música (o el primer golpe fuerte si está cerca)
    let entrada = 0; while (entrada < finMusica && vol(entrada, entrada + 0.3) < maxV * 0.3) entrada += 0.05;
    entrada = Math.max(golpe, aGolpe(entrada));
    const golpeCerca = hits.find((h) => h.t >= entrada - 0.3 && h.t <= entrada + 4);
    if (golpeCerca) entrada = golpeCerca.t;
    if (entrada > 8) entrada = aGolpe(Math.min(entrada, 2));
    // la barra aparece en el siguiente golpe fuerte (o 16 golpes después)
    const sig = hits.find((h) => h.t >= entrada + 4 && h.t <= entrada + 14);
    const barra = sig ? sig.t : entrada + 16 * P;

    // 5) la parte que se repite: la zona más fuerte, empezando en un golpe fuerte, de 64/48/32 golpes
    let loop = null;
    const inicios = hits.filter((h) => h.t >= barra - 0.1).map((h) => h.t);
    if (!inicios.length) for (let t = aGolpe(barra); t < finMusica - 16 * P; t += 16 * P) inicios.push(t);
    const sinSilencio = (a, b) => { for (let t = a; t < b - 0.5; t += 0.5) if (vol(t, t + 1) < maxV * 0.2) return false; return true; };
    for (const ini of inicios) for (const n of [64, 56, 48, 40, 32, 24, 16]) {
      const fin = ini + n * P; if (fin > finMusica - 3 || !sinSilencio(ini, fin)) continue;
      const v = vol(ini, fin) * (1 + n / 64);
      if (!loop || v > loop.v) loop = { desde: ini, hasta: fin, v };
    }
    if (!loop) { const ini = aGolpe(Math.max(barra, 0)); loop = { desde: ini, hasta: Math.min(finMusica - 1, ini + 16 * P) }; }

    // 6) el final: el último golpe fuerte que deja entre 6 y 25 s de canción; si no, los últimos ~12 s
    const finales = hits.filter((h) => h.t >= loop.desde + 4 && finMusica - h.t >= 6 && finMusica - h.t <= 25);
    let finDesde = finales.length ? finales[finales.length - 1].t : aGolpe(Math.max(loop.hasta, finMusica - 12));
    if (finDesde >= finMusica - 2) finDesde = aGolpe(Math.max(0, finMusica - 10));

    // drops (OVERDRIVE): los golpes fuertes después de la barra y antes del final, los 3 más potentes
    let drops = hits.filter((h) => h.t > barra + 1 && h.t < finDesde - 0.5 && h.vol > maxV * 0.6).sort((a, b) => b.vol * b.salto - a.vol * a.salto).slice(0, 3).map((h) => h.t).sort((a, b) => a - b);
    if (!drops.length) drops = [loop.desde];
    const r2 = (v) => Math.round(v * 100) / 100;
    return {
      bpm, golpe: Math.round((golpeAj ?? golpe) * 1000) / 1000, entrada: r2(entrada), barra: r2(barra),
      loopDesde: r2(loop.desde), loopHasta: Math.round(loop.hasta * 1000) / 1000,
      drop: drops.map(r2), finDesde: r2(finDesde), duracion: r2(finMusica),
    };
  }
  window.HypeAnalisis = { analizar };
})();

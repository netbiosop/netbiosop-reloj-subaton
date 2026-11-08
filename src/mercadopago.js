// Mercado Pago: detecta pagos aprobados que recibes.
//  - Modo "polling" (recomendado): cada X segundos consulta tus últimos pagos. No necesita túnel.
//  - Modo "webhook": Mercado Pago avisa a /webhooks/mercadopago (necesita URL pública).
// En los dos modos el pago se confirma consultando la API con TU token, así que no se puede falsificar.
const crypto = require('crypto');

const API = 'https://api.mercadopago.com';
const START_RETRY_MS = 60 * 1000;

// "Luis Villa" coincide con "LUIS MARÍA VILLA" (las palabras de la regla, en orden, empezando por el primer nombre);
// una sola letra vale como inicial: "Luis V" coincide con "Luis Villa" y "Luis Valdez". "Luisa Villa" no coincide con "Luis Villa".
const palabras = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
const igual = (palabra, regla) => (regla.length === 1 ? palabra.startsWith(regla) : palabra === regla);
function coincideNombre(nombre, regla) {
  const n = palabras(nombre), r = palabras(regla);
  if (!r.length || !n.length || !igual(n[0], r[0])) return false;
  let i = 1;
  for (const w of r.slice(1)) { while (i < n.length && !igual(n[i], w)) i++; if (i++ >= n.length) return false; }
  return true;
}

class MercadoPagoClient {
  constructor({ store, onContribution, onStatus }) {
    this.store = store;
    this.onContribution = onContribution;
    this.onStatus = onStatus || (() => {});
    this.status = 'desconectado';
    this.detail = '';
    this.userId = null;
    this.nickname = '';
  }

  get s() {
    return this.store.data.secrets.mercadopago;
  }

  setStatus(status, detail = '') {
    if (status === this.status && detail === this.detail) return;
    this.status = status;
    this.detail = detail;
    this.onStatus();
  }

  info() {
    return { status: this.status, detail: this.detail, nickname: this.nickname, mode: this.s.mode };
  }

  async api(path) {
    const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + this.s.accessToken } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`${r.status} ${j.message || j.error || ''}`.trim()), { status: r.status });
    return j;
  }

  async start() {
    this.stop();
    if (!this.s.accessToken) {
      this.setStatus('desconectado');
      return;
    }
    try {
      const me = await this.api('/users/me');
      this.userId = me.id;
      this.nickname = me.nickname || '';
      if (!this.store.data.mpSince) {
        this.store.data.mpSince = Date.now();
        this.store.save();
      }
      if (this.s.mode === 'polling') {
        this.setStatus('conectado', 'Revisando pagos cada ' + (this.s.pollSeconds || 15) + ' s');
        this.poll();
        this.pollTimer = setInterval(() => this.poll(), Math.max(5, Number(this.s.pollSeconds) || 15) * 1000);
      } else {
        this.setStatus('conectado', 'Esperando webhooks');
      }
      console.log(`[Mercado Pago] Conectado como ${this.nickname} (modo ${this.s.mode})`);
    } catch (err) {
      console.error('[Mercado Pago]', err.message);
      if (err.status >= 400 && err.status < 500 && err.status !== 429) return this.setStatus('error', 'Token inválido: ' + err.message);
      this.setStatus('reconectando', 'Sin conexión con Mercado Pago, reintentando: ' + err.message);
      this.retryTimer = setTimeout(() => this.start(), START_RETRY_MS);
    }
  }

  stop() {
    clearInterval(this.pollTimer);
    clearTimeout(this.retryTimer);
  }

  async poll() {
    try {
      const q = new URLSearchParams({ sort: 'date_created', criteria: 'desc', limit: '50' });
      const res = await this.api('/v1/payments/search?' + q);
      for (const p of (res.results || []).reverse()) await this.processPayment(p);
      this.setStatus('conectado', 'Revisando pagos cada ' + (this.s.pollSeconds || 15) + ' s');
    } catch (err) {
      this.setStatus('error', 'Error consultando pagos: ' + err.message);
    }
  }

  // ---------- Nombre de quien donó ----------
  // Mercado Pago lo pone en distintos lugares según cómo se pagó (transferencia, dinero en cuenta, tarjeta…)
  nombreDe(p) {
    const bp = p.point_of_interaction?.transaction_data?.bank_info?.payer || {};
    const cands = [
      bp.long_name, bp.account_holder_name, bp.name,
      [p.payer?.first_name, p.payer?.last_name].filter(Boolean).join(' '),
      [p.additional_info?.payer?.first_name, p.additional_info?.payer?.last_name].filter(Boolean).join(' '),
      p.card?.cardholder?.name,
      p.payer?.nickname,
    ];
    const n = cands.map((v) => String(v || '').replace(/\s+/g, ' ').trim()).find((v) => v && !/^(null|undefined|n\/a)$/i.test(v));
    return n || '';
  }
  // todos los nombres que trae el pago (para la lista de "no contar")
  nombresDe(p) {
    const bp = p.point_of_interaction?.transaction_data?.bank_info?.payer || {};
    return [bp.long_name, bp.account_holder_name, bp.name, [p.payer?.first_name, p.payer?.last_name].filter(Boolean).join(' '),
      [p.additional_info?.payer?.first_name, p.additional_info?.payer?.last_name].filter(Boolean).join(' '), p.card?.cardholder?.name, p.payer?.nickname]
      .map((v) => String(v || '').trim()).filter(Boolean);
  }
  ignorar(p, nombre, motivo) {
    console.log(`[Mercado Pago] Pago ignorado: ${p.transaction_amount} ${p.currency_id || ''}${nombre ? ' de ' + nombre : ''} · ${motivo}. No suma tiempo, ni podio, ni metas.`);
  }
  // cómo se muestra en el stream: "Juan P." (por defecto), solo "Juan" o "Juan Pérez"
  formatear(nombre) {
    const titulo = (w) => w.charAt(0).toLocaleUpperCase('es') + w.slice(1).toLocaleLowerCase('es');
    const partes = nombre.split(' ').filter(Boolean).map(titulo);
    if (!partes.length) return '';
    const modo = this.s.nombre || 'inicial';
    if (modo === 'completo') return partes.join(' ');
    if (modo === 'nombre' || partes.length === 1) return partes[0];
    return partes[0] + ' ' + partes[partes.length - 1].charAt(0) + '.';
  }
  // quién es (para recordar el nombre que le pongas a mano): id del pagador, documento o cuenta
  clave(p) {
    const bp = p.point_of_interaction?.transaction_data?.bank_info?.payer || {};
    const k = p.payer?.id || p.payer?.identification?.number || bp.id || bp.account_id || bp.identification?.number;
    return k ? 'mp:' + crypto.createHash('sha256').update(String(k)).digest('hex').slice(0, 16) : null;
  }

  async processPayment(p) {
    if (!p || p.status !== 'approved') return;
    // Ignora pagos aprobados antes de empezar el subatón
    const approvedAt = Date.parse(p.date_approved || p.date_created || 0);
    if (approvedAt && approvedAt < (this.store.data.mpSince || 0) - 60_000) return;
    const amount = Number(p.transaction_amount);
    if (!(amount > 0)) return;
    if ((this.vistos ||= new Set()).has(String(p.id))) return;
    this.vistos.add(String(p.id));
    // la búsqueda de pagos a veces viene sin el nombre o sin quién lo cobró: se pide el pago completo
    const cobrador = (x) => x.collector_id ?? x.collector?.id;
    let nombre = this.nombreDe(p);
    if (!nombre || (this.userId && !cobrador(p))) {
      try { const full = await this.api('/v1/payments/' + encodeURIComponent(p.id)); p = { ...p, ...full }; nombre = this.nombreDe(p); }
      catch (err) {
        console.warn(`[Mercado Pago] No se pudo pedir el pago ${p.id} completo:`, err.message);
        // sin saber quién lo cobró se descartaría: si el fallo es pasajero (red, 429, 5xx) se olvida para que el
        // próximo sondeo lo reintente; un 4xx fijo no se reintenta (serían un pedido y un aviso cada sondeo para siempre)
        const fijo = err.status >= 400 && err.status < 500 && err.status !== 429;
        if (this.userId && !cobrador(p) && !fijo) { this.vistos.delete(String(p.id)); return; }
      }
    }
    // Solo pagos que RECIBES: se descarta si no está confirmado que lo cobraste tú, o si lo pagaste tú
    if (this.userId) {
      if (String(cobrador(p) ?? '') !== String(this.userId)) return this.ignorar(p, nombre, 'no figura que lo cobraste tú (un pago o compra que hiciste)');
      if (p.payer?.id && String(p.payer.id) === String(this.userId)) return this.ignorar(p, nombre, 'lo pagaste tú');
    }
    const pk = this.clave(p);
    // Personas de "no contar" (ej. el sueldo): por nombre o porque marcaste un pago suyo como "No es donación"
    const lista = this.store.data.settings.mpIgnorar || {};
    if (pk && (lista.claves || []).some((c) => c.clave === pk)) return this.ignorar(p, nombre, 'marcaste a esta persona como "no es donación"');
    const regla = this.nombresDe(p).map((n) => (lista.nombres || []).find((r) => coincideNombre(n, r))).find(Boolean);
    if (regla) return this.ignorar(p, nombre, `está en tu lista de "no contar" ("${regla}")`);
    // si en el motivo de la transferencia escribió su usuario de Twitch (@usuario), se usa ese
    const arroba = String(p.description || p.additional_info?.items?.[0]?.title || '').match(/(?<![\w.])@([A-Za-z0-9_]{3,25})/);   // sin letra antes: un correo no es @usuario
    const recordado = (arroba && arroba[1]) || (pk && this.store.data.mpNombres && this.store.data.mpNombres[pk]);
    if (arroba && pk) (this.store.data.mpNombres ||= {})[pk] = arroba[1];
    if (!nombre && !recordado) console.warn(`[Mercado Pago] Pago ${p.id} sin nombre del que donó (método: ${p.payment_method_id || p.payment_type_id || '?'}). Puedes ponerle el nombre en el podio y se recuerda para la próxima.`);
    this.onContribution({
      source: 'mercadopago',
      id: String(p.id),
      amount,
      currency: p.currency_id,
      user: recordado || this.formatear(nombre) || 'Donación Mercado Pago',
      payer: pk,
      message: p.description || '',
    });
  }

  verifySignature(headers, dataId) {
    if (!this.s.webhookSecret) return true;
    const sig = String(headers['x-signature'] || '');
    const parts = Object.fromEntries(sig.split(',').map((kv) => kv.trim().split('=').map((x) => x.trim())));
    if (!parts.ts || !parts.v1) return false;
    const id = /^[a-z0-9]+$/i.test(dataId) ? String(dataId).toLowerCase() : dataId;
    const manifest = `id:${id};request-id:${headers['x-request-id'] || ''};ts:${parts.ts};`;
    const expected = crypto.createHmac('sha256', this.s.webhookSecret).update(manifest).digest('hex');
    return expected.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  }

  async handleWebhook(query, headers, rawBody) {
    let body = {};
    try { body = JSON.parse(rawBody || '{}'); } catch { /* Mercado Pago también manda tipo e id en la URL */ }
    const type = body.type || query.type || query.topic;
    const id = query['data.id'] || body.data?.id || query.id;
    if (type !== 'payment' || !id) return { ignored: `Aviso de tipo ${type || '?'} ignorado` };
    if (!this.verifySignature(headers, String(id))) return { error: 'Webhook de Mercado Pago con firma inválida (ignorado)' };
    if (!this.s.accessToken) return { error: 'Falta el Access Token de Mercado Pago en el panel' };
    const p = await this.api('/v1/payments/' + encodeURIComponent(id));
    await this.processPayment(p);
    return { ok: true };
  }
}

module.exports = { MercadoPagoClient };

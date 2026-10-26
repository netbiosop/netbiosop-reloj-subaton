// Mercado Pago: detecta pagos aprobados que recibes.
//  - Modo "polling" (recomendado): cada X segundos consulta tus últimos pagos. No necesita túnel.
//  - Modo "webhook": Mercado Pago avisa a /webhooks/mercadopago (necesita URL pública).
// En los dos modos el pago se confirma consultando la API con TU token, así que no se puede falsificar.
const crypto = require('crypto');

const API = 'https://api.mercadopago.com';

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
    if (!r.ok) throw new Error(`${r.status} ${j.message || j.error || ''}`.trim());
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
      this.setStatus('error', 'Token inválido: ' + err.message);
      console.error('[Mercado Pago]', err.message);
    }
  }

  stop() {
    clearInterval(this.pollTimer);
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
    // Solo pagos que RECIBES (no los que haces tú)
    if (this.userId && p.collector_id && String(p.collector_id) !== String(this.userId)) return;
    // Ignora pagos aprobados antes de empezar el subatón
    const approvedAt = Date.parse(p.date_approved || p.date_created || 0);
    if (approvedAt && approvedAt < (this.store.data.mpSince || 0) - 60_000) return;
    const amount = Number(p.transaction_amount);
    if (!(amount > 0)) return;
    if ((this.vistos ||= new Set()).has(String(p.id))) return;
    this.vistos.add(String(p.id));
    // la búsqueda de pagos a veces viene sin el nombre: se pide el pago completo
    let nombre = this.nombreDe(p);
    if (!nombre) { try { const full = await this.api('/v1/payments/' + encodeURIComponent(p.id)); nombre = this.nombreDe(full); p = { ...p, ...full }; } catch {} }
    const pk = this.clave(p);
    // si en el motivo de la transferencia escribió su usuario de Twitch (@usuario), se usa ese
    const arroba = String(p.description || p.additional_info?.items?.[0]?.title || '').match(/@([A-Za-z0-9_]{3,25})/);
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
    try { body = JSON.parse(rawBody || '{}'); } catch {}
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

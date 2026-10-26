// StreamElements: recibe las donaciones (tips) de tu página de StreamElements, por ejemplo las de PayPal.
// Usa el WebSocket "Astro" de StreamElements con tu JWT Token. No necesita túnel.
const ASTRO_URL = 'wss://astro.streamelements.com/';

class StreamElementsClient {
  constructor({ store, onContribution, onStatus }) {
    this.store = store;
    this.onContribution = onContribution;
    this.onStatus = onStatus || (() => {});
    this.status = 'desconectado';
    this.detail = '';
    this.ws = null;
    this.stopped = true;
    this.backoff = 2000;
    this.reconnectToken = null;
    this.triedRoom = false;
  }

  get s() {
    return this.store.data.secrets.streamelements;
  }

  setStatus(status, detail = '') {
    if (status === this.status && detail === this.detail) return;
    this.status = status;
    this.detail = detail;
    this.onStatus();
  }

  info() {
    return { status: this.status, detail: this.detail, hasToken: !!this.s.jwt };
  }

  // El JWT trae el ID de tu canal de StreamElements
  channelId() {
    try {
      const payload = JSON.parse(Buffer.from(this.s.jwt.split('.')[1], 'base64url').toString('utf8'));
      return payload.channel || payload.channel_id || null;
    } catch {
      return null;
    }
  }

  start() {
    this.stop();
    if (!this.s.jwt) {
      this.setStatus('desconectado');
      return;
    }
    this.stopped = false;
    this.triedRoom = false;
    this.reconnectToken = null;
    this.setStatus('conectando');
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    try { this.ws?.close(); } catch {}
    this.ws = null;
  }

  connect() {
    const url = this.reconnectToken ? `${ASTRO_URL}?reconnect_token=${encodeURIComponent(this.reconnectToken)}` : ASTRO_URL;
    const resuming = !!this.reconnectToken;
    this.reconnectToken = null;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.onMessage(msg, resuming);
    });
    ws.addEventListener('close', () => {
      if (ws !== this.ws || this.stopped) return;
      if (this.status !== 'error') this.setStatus('reconectando');
      this.retryTimer = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 60000);
    });
    ws.addEventListener('error', () => console.error('[StreamElements] Error en la conexión'));
  }

  subscribe(withRoom) {
    const data = { topic: 'channel.tips', token: this.s.jwt, token_type: 'jwt' };
    if (withRoom) data.room = this.channelId();
    this.ws.send(JSON.stringify({ type: 'subscribe', nonce: withRoom ? 'tips-room' : 'tips', data }));
  }

  onMessage(msg, resuming) {
    switch (msg.type) {
      case 'welcome':
        this.backoff = 2000;
        if (!resuming) this.subscribe(false);
        else this.setStatus('conectado', 'Escuchando donaciones');
        break;
      case 'response':
        this.setStatus('conectado', 'Escuchando donaciones');
        console.log('[StreamElements] Conectado, escuchando donaciones');
        break;
      case 'error': {
        const code = msg.error || msg.data?.error || msg.data?.message || 'error';
        // Si falla sin "room", se prueba una vez indicando el canal del token
        if (!this.triedRoom && this.channelId() && code !== 'err_unauthorized') {
          this.triedRoom = true;
          return this.subscribe(true);
        }
        const nice = code === 'err_unauthorized' ? 'JWT Token inválido o vencido: cópialo de nuevo en StreamElements' : `StreamElements respondió: ${code}`;
        console.error('[StreamElements]', nice);
        this.setStatus('error', nice);
        if (code === 'err_unauthorized') this.stop();
        break;
      }
      case 'reconnect':
        this.reconnectToken = msg.data?.reconnect_token || null;
        break;
      case 'message':
        if (msg.topic === 'channel.tips') this.handleTip(msg.data || {});
        break;
    }
  }

  handleTip(t) {
    const status = String(t.status || 'success').toLowerCase();
    if (status && !['success', 'completed', 'approved'].includes(status)) {
      console.log(`[StreamElements] Donación con estado "${t.status}" ignorada`);
      return;
    }
    const dn = t.donation || {};
    const amount = Number(dn.amount);
    if (!(amount > 0)) return;
    this.onContribution({
      source: 'paypal',
      via: 'StreamElements',
      id: 'se:' + (t._id || t.transactionId || t.id),
      amount,
      currency: dn.currency,
      user: dn.user?.username || 'Anónimo',
      message: dn.message || '',
    });
  }
}

module.exports = { StreamElementsClient };

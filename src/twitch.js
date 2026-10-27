// Twitch EventSub por WebSocket: recibe Bits, Subs nuevas, resubs, subs regaladas
// y los mensajes del chat (para los comandos de mods), sin abrir puertos ni túneles.
// Usa el WebSocket que trae Node.js 22+

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const SCOPES = ['bits:read', 'channel:read:subscriptions', 'user:read:chat', 'user:write:chat', 'channel:read:hype_train'];
// Tren del hype (versión 2 de Twitch). Si falta el permiso, hay que Desconectar y volver a Conectar con Twitch
const HYPE_TOPICS = [['channel.hype_train.begin', '2'], ['channel.hype_train.progress', '2'], ['channel.hype_train.end', '2']];
const TOPICS = [
  ['channel.bits.use', '1'], // Bits: cheers en el chat + Power-ups (si falla, se usa channel.cheer)
  ['channel.subscribe', '1'],
  ['channel.subscription.gift', '1'],
  ['channel.subscription.message', '1'],
  ['stream.online', '1'],
  ['stream.offline', '1'],
];

const tierNum = (t) => ({ '1000': 1, '2000': 2, '3000': 3 }[String(t)] || 1);

class TwitchClient {
  constructor({ store, onContribution, onChat, onStream, onStatus, onHype, redirectUri }) {
    this.store = store;
    this.onStream = onStream || (() => {});
    this.checkedLive = false;
    this.onContribution = onContribution;
    this.onChat = onChat || (() => {});
    this.onHype = onHype || (() => {});
    this.hypeOk = false;
    this.chatOk = false;
    this.onStatus = onStatus || (() => {});
    this.redirectUri = redirectUri;
    this.status = 'desconectado';
    this.detail = '';
    this.ws = null;
    this.pendingWs = null;
    this.stopped = true;
    this.backoff = 1000;
    this.seen = new Set();
  }

  get s() {
    return this.store.data.secrets.twitch;
  }

  setStatus(status, detail = '') {
    this.status = status;
    this.detail = detail;
    this.onStatus();
  }

  info() {
    return { status: this.status, detail: this.detail, login: this.s.login, hasApp: !!(this.s.clientId && this.s.clientSecret), redirectUri: this.redirectUri };
  }

  // ---------- OAuth ----------
  authUrl(state) {
    const q = new URLSearchParams({
      client_id: this.s.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      state,
      force_verify: 'true',
    });
    return `https://id.twitch.tv/oauth2/authorize?${q}`;
  }

  async exchangeCode(code) {
    const r = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: this.s.clientId,
        client_secret: this.s.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.message || `Error ${r.status}`);
    this.s.accessToken = j.access_token;
    this.s.refreshToken = j.refresh_token;
    const me = await this.helix('GET', '/users');
    this.s.userId = me.data[0].id;
    this.s.login = me.data[0].login;
    this.store.save();
    this.start();
  }

  async refresh() {
    if (!this.s.refreshToken) throw new Error('No hay refresh token, vuelve a conectar Twitch');
    const r = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: this.s.clientId,
        client_secret: this.s.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: this.s.refreshToken,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      this.s.accessToken = '';
      this.store.save();
      throw new Error('La sesión de Twitch expiró, vuelve a conectar (' + (j.message || r.status) + ')');
    }
    this.s.accessToken = j.access_token;
    this.s.refreshToken = j.refresh_token || this.s.refreshToken;
    this.store.save();
  }

  async helix(method, path, body, retry = true) {
    const r = await fetch('https://api.twitch.tv/helix' + path, {
      method,
      headers: {
        'Client-Id': this.s.clientId,
        Authorization: 'Bearer ' + this.s.accessToken,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401 && retry) {
      await this.refresh();
      return this.helix(method, path, body, false);
    }
    const text = await r.text();
    const j = text ? JSON.parse(text) : {};
    if (!r.ok) throw new Error(`${r.status} ${j.message || text}`);
    return j;
  }

  async sendChat(message, replyTo) {
    if (!this.chatOk) return false;
    try {
      const r = await this.helix('POST', '/chat/messages', {
        broadcaster_id: this.s.userId,
        sender_id: this.s.userId,
        message: message.slice(0, 450),
        ...(replyTo ? { reply_parent_message_id: replyTo } : {}),
      });
      const enviado = r.data?.[0];
      if (enviado && enviado.is_sent === false) { console.error('[Twitch] El chat no aceptó el mensaje:', enviado.drop_reason?.message || 'sin motivo'); return false; }
      return true;
    } catch (err) {
      console.error('[Twitch] No se pudo escribir en el chat:', err.message);
      return false;
    }
  }

  disconnect() {
    this.stop();
    Object.assign(this.s, { accessToken: '', refreshToken: '', userId: '', login: '' });
    this.store.save();
    this.setStatus('desconectado');
  }

  // ---------- EventSub WebSocket ----------
  start() {
    if (!this.s.accessToken || !this.s.userId) {
      this.setStatus('desconectado');
      return;
    }
    this.stop();
    this.stopped = false;
    this.setStatus('conectando');
    this.connect(EVENTSUB_URL, false);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.watchdog);
    for (const ws of [this.ws, this.pendingWs]) {
      try { ws?.close(); } catch {}
    }
    this.ws = null;
    this.pendingWs = null;
  }

  connect(url, isReconnect) {
    const ws = new WebSocket(url);
    if (isReconnect) this.pendingWs = ws;
    else this.ws = ws;

    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.onMessage(ws, msg, isReconnect).catch((err) => {
        console.error('[Twitch]', err.message);
        this.setStatus('error', err.message);
      });
    });
    ws.addEventListener('close', () => {
      if (ws === this.ws && !this.stopped) {
        this.setStatus('reconectando');
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(EVENTSUB_URL, false), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 60000);
      }
    });
    ws.addEventListener('error', () => console.error('[Twitch] Error en la conexión con Twitch'));
  }

  armWatchdog(ws) {
    if (ws !== this.ws) return;
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      console.warn('[Twitch] Sin mensajes de Twitch, reconectando…');
      this.ws = null;
      try { ws.close(); } catch {}
      if (!this.stopped) this.connect(EVENTSUB_URL, false);
    }, ((this.keepalive || 10) + 10) * 1000);
  }

  async onMessage(ws, msg, isReconnect) {
    const type = msg.metadata?.message_type;
    // Hora de Twitch: cada mensaje trae cuándo lo mandó Twitch. Con eso se calcula cuánto está corrido el reloj de esta PC
    const ts = Date.parse(msg.metadata?.message_timestamp || '');
    if (ts) {
      (this.muestras ||= []).push(ts - Date.now());
      if (this.muestras.length > 15) this.muestras.shift();
      const orden = [...this.muestras].sort((a, b) => a - b);
      this.desfase = orden[Math.floor(orden.length / 2)];
      if (!this.avisoHora && this.muestras.length >= 3 && Math.abs(this.desfase) > 3000) {
        this.avisoHora = true;
        console.warn(`⚠️ La hora de esta PC está ${Math.round(Math.abs(this.desfase) / 1000)} s ${this.desfase > 0 ? 'atrasada' : 'adelantada'} respecto de Twitch. El tren del hype se corrige solo, pero conviene sincronizar la hora de Windows (Configuración → Hora e idioma → Sincronizar ahora).`);
      }
    }
    if (type === 'session_welcome') {
      this.keepalive = msg.payload.session.keepalive_timeout_seconds || 10;
      if (isReconnect) {
        const old = this.ws;
        this.ws = ws;
        this.pendingWs = null;
        try { old?.close(); } catch {}
      } else {
        await this.subscribeAll(msg.payload.session.id);
      }
      this.backoff = 1000;
      this.armWatchdog(ws);
      return;
    }
    this.armWatchdog(ws);

    if (type === 'notification') {
      const id = msg.metadata.message_id;
      if (this.seen.has(id)) return;
      this.seen.add(id);
      if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000));
      this.handle(msg.payload.subscription.type, msg.payload.event, id);
    } else if (type === 'session_reconnect') {
      this.connect(msg.payload.session.reconnect_url, true);
    } else if (type === 'revocation') {
      const t = msg.payload.subscription.type;
      console.warn('[Twitch] Twitch revocó la suscripción', t, msg.payload.subscription.status);
      this.setStatus('error', `Twitch revocó ${t}. Vuelve a conectar.`);
    }
  }

  async trySub(type, sessionId) {
    try {
      await this.helix('POST', '/eventsub/subscriptions', {
        type,
        version: '1',
        condition: { broadcaster_user_id: this.s.userId },
        transport: { method: 'websocket', session_id: sessionId },
      });
      return true;
    } catch {
      return false;
    }
  }

  async subscribeAll(sessionId) {
    const failed = [];
    for (const [type, version] of TOPICS) {
      try {
        await this.helix('POST', '/eventsub/subscriptions', {
          type,
          version,
          condition: { broadcaster_user_id: this.s.userId },
          transport: { method: 'websocket', session_id: sessionId },
        });
      } catch (err) {
        if (type === 'channel.bits.use' && (await this.trySub('channel.cheer', sessionId))) {
          console.warn('[Twitch] Bits: usando channel.cheer (solo cheers en el chat, sin Power-ups)');
          continue;
        }
        failed.push(type);
        console.error(`[Twitch] No se pudo suscribir a ${type}:`, err.message);
      }
    }
    // Chat (comandos de mods): necesita los permisos user:read:chat
    this.chatOk = false;
    try {
      await this.helix('POST', '/eventsub/subscriptions', {
        type: 'channel.chat.message',
        version: '1',
        condition: { broadcaster_user_id: this.s.userId, user_id: this.s.userId },
        transport: { method: 'websocket', session_id: sessionId },
      });
      this.chatOk = true;
    } catch (err) {
      console.error('[Twitch] No se pudo leer el chat (¿falta reconectar Twitch?):', err.message);
    }
    // Tren del hype
    this.hypeOk = true;
    for (const [type, version] of HYPE_TOPICS) {
      try {
        await this.helix('POST', '/eventsub/subscriptions', { type, version, condition: { broadcaster_user_id: this.s.userId }, transport: { method: 'websocket', session_id: sessionId } });
      } catch (err) {
        this.hypeOk = false;
        console.error(`[Twitch] No se pudo escuchar ${type} (¿falta reconectar Twitch?):`, err.message);
      }
    }
    if (failed.length === TOPICS.length && !this.chatOk) throw new Error('No se pudo escuchar ningún evento de Twitch. ¿Tu canal es afiliado/partner?');
    const notes = [];
    if (failed.length) notes.push(`Sin acceso a: ${failed.join(', ')}`);
    if (!this.chatOk) notes.push('Comandos de chat desactivados: pulsa Desconectar y vuelve a Conectar con Twitch');
    if (!this.hypeOk) notes.push('Tren del hype sin permiso: pulsa Desconectar y vuelve a Conectar con Twitch');
    this.setStatus('conectado', notes.join(' · '));
    // Al abrir el programa: ¿el stream ya está en vivo?
    if (!this.checkedLive) {
      this.checkedLive = true;
      try {
        const r = await this.helix('GET', '/streams?user_id=' + this.s.userId);
        this.onStream(!!r.data?.length, true);
      } catch (err) {
        console.error('[Twitch] No se pudo consultar si estás en vivo:', err.message);
      }
    }
    console.log(`[Twitch] Conectado como ${this.s.login}, escuchando Bits, Subs${this.hypeOk ? ', Tren del hype' : ''}${this.chatOk ? ' y comandos del chat' : ''}`);
  }

  handle(type, e, id) {
    if (type === 'channel.chat.message') return this.onChat(e);
    if (type === 'stream.online') return this.onStream(true, false);
    if (type === 'stream.offline') return this.onStream(false, false);
    if (type.startsWith('channel.hype_train.')) return this.onHype(type.split('.').pop(), e, this.desfase || 0);
    const user = e.is_anonymous ? 'Anónimo' : e.user_name || e.user_login || 'Alguien';
    switch (type) {
      case 'channel.bits.use': {
        // type: 'cheer' (en el chat), 'power_up' (efectos, emotes gigantes, etc.) o 'combo'
        const how = e.type === 'power_up' ? 'Power-up' : e.type === 'combo' ? 'Combo' : null;
        this.onContribution({ source: 'bits', id, amount: e.bits, user, kind: how, message: e.message?.text || '' });
        break;
      }
      case 'channel.cheer':
        this.onContribution({ source: 'bits', id, amount: e.bits, user, message: e.message });
        break;
      case 'channel.subscribe':
        // Las subs regaladas también llegan aquí una por una: se cuentan en channel.subscription.gift
        if (e.is_gift) return;
        this.onContribution({ source: 'subs', kind: 'new', id, tier: tierNum(e.tier), count: 1, user });
        break;
      case 'channel.subscription.gift':
        this.onContribution({ source: 'subs', kind: 'gift', id, tier: tierNum(e.tier), count: e.total || 1, user });
        break;
      case 'channel.subscription.message':
        this.onContribution({ source: 'subs', kind: 'resub', id, tier: tierNum(e.tier), count: 1, user, months: e.cumulative_months });
        break;
    }
  }
}

module.exports = { TwitchClient };

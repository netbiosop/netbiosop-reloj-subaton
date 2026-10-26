// PayPal: dos formas de recibir donaciones
//  1) IPN (botón "Donar" de PayPal / pagos recibidos)  -> /webhooks/paypal-ipn
//  2) Webhooks REST (PAYMENT.CAPTURE.COMPLETED / PAYMENT.SALE.COMPLETED) -> /webhooks/paypal
// En ambos casos se verifica con PayPal que el aviso sea real antes de sumar tiempo.

const apiBase = (mode) => (mode === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com');
const ipnBase = (mode) => (mode === 'sandbox' ? 'https://ipnpb.sandbox.paypal.com/cgi-bin/webscr' : 'https://ipnpb.paypal.com/cgi-bin/webscr');

async function getToken(cfg) {
  const r = await fetch(apiBase(cfg.mode) + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json();
  if (!r.ok) throw new Error('PayPal rechazó las credenciales: ' + (j.error_description || r.status));
  return j.access_token;
}

async function verifyWebhook(cfg, headers, rawBody) {
  const token = await getToken(cfg);
  const h = (k) => JSON.stringify(headers[k] || '');
  // Se arma a mano para enviar el evento EXACTAMENTE como llegó (si se re-serializa, la firma puede fallar)
  const body = `{"auth_algo":${h('paypal-auth-algo')},"cert_url":${h('paypal-cert-url')},"transmission_id":${h('paypal-transmission-id')},"transmission_sig":${h('paypal-transmission-sig')},"transmission_time":${h('paypal-transmission-time')},"webhook_id":${JSON.stringify(cfg.webhookId)},"webhook_event":${rawBody}}`;
  const r = await fetch(apiBase(cfg.mode) + '/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body,
  });
  const j = await r.json();
  return j.verification_status === 'SUCCESS';
}

function payerName(resource) {
  const n = resource?.payer?.name || resource?.payer?.payer_info;
  if (n?.given_name) return n.given_name;
  if (n?.first_name) return n.first_name;
  return 'Donación PayPal';
}

async function handleWebhook(cfg, headers, rawBody) {
  if (!cfg.clientId || !cfg.clientSecret || !cfg.webhookId) {
    return { error: 'Webhook de PayPal recibido pero faltan Client ID / Secret / Webhook ID en el panel (no se sumó por seguridad)' };
  }
  const ok = await verifyWebhook(cfg, headers, rawBody);
  if (!ok) return { error: 'Webhook de PayPal con firma inválida (ignorado)' };

  const evt = JSON.parse(rawBody);
  const res = evt.resource || {};
  if (evt.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    return { event: { source: 'paypal', id: res.id, amount: Number(res.amount?.value), currency: res.amount?.currency_code, user: payerName(res) } };
  }
  if (evt.event_type === 'PAYMENT.SALE.COMPLETED') {
    return { event: { source: 'paypal', id: res.id, amount: Number(res.amount?.total), currency: res.amount?.currency, user: payerName(res) } };
  }
  return { ignored: `Evento ${evt.event_type} ignorado` };
}

async function handleIpn(cfg, rawBody) {
  const r = await fetch(ipnBase(cfg.mode), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'reloj-subaton' },
    body: 'cmd=_notify-validate&' + rawBody,
  });
  const answer = (await r.text()).trim();
  if (answer !== 'VERIFIED') return { error: `IPN de PayPal no verificado (${answer || r.status})` };

  const p = new URLSearchParams(rawBody);
  if (p.get('payment_status') !== 'Completed') return { ignored: `IPN con estado ${p.get('payment_status')}` };

  const mine = (cfg.receiverEmail || '').trim().toLowerCase();
  const to = [(p.get('receiver_email') || '').toLowerCase(), (p.get('business') || '').toLowerCase()];
  if (mine && !to.includes(mine)) return { error: `IPN para otra cuenta (${to[0]}), ignorado` };

  const amount = Number(p.get('mc_gross'));
  if (!(amount > 0)) return { ignored: 'IPN sin monto positivo' };

  const first = p.get('first_name') || '';
  const lastInitial = (p.get('last_name') || '').slice(0, 1);
  return {
    event: {
      source: 'paypal',
      id: p.get('txn_id'),
      amount,
      currency: p.get('mc_currency'),
      user: first ? `${first}${lastInitial ? ' ' + lastInitial + '.' : ''}` : 'Donación PayPal',
      message: p.get('memo') || '',
    },
  };
}

module.exports = { handleWebhook, handleIpn };

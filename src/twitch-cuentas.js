// Cuentas de Twitch de otras personas (ej. Nephallems) para que el bot escriba en tu chat CON SU NOMBRE.
// Twitch solo deja escribir como alguien si esa persona lo autoriza, así que cada una se vincula una vez:
//   el panel muestra un código → la persona entra a twitch.tv/activate con SU cuenta y lo escribe → listo.
// Los permisos se guardan en data/subaton.json → secrets.twitch.cuentas (nunca se suben a GitHub).
const ID = process.env.TWITCH_ID_BASE || 'https://id.twitch.tv';
const HELIX = process.env.TWITCH_HELIX || 'https://api.twitch.tv/helix';
const SCOPES = 'user:write:chat';
const GRANT_DISPOSITIVO = 'urn:ietf:params:oauth:grant-type:device_code';

function crearCuentas({ store, twitch }) {
  const s = () => twitch.s;
  const cuentas = () => (s().cuentas ||= {});
  const cuenta = (login) => (Object.hasOwn(cuentas(), login) ? cuentas()[login] : null); // "constructor" es un login válido
  const vinculando = Object.create(null); // login → { estado: 'esperando'|'listo'|'error', codigo, url, expira, mensaje }

  async function form(ruta, campos) {
    const r = await fetch(ID + ruta, { method: 'POST', body: new URLSearchParams(campos), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  }

  // Empieza a vincular la cuenta de "login": devuelve el código que esa persona escribe en twitch.tv/activate
  async function empezar(login) {
    if (!s().clientId) throw new Error('Primero conecta tu Twitch en Configuración');
    const { ok, j } = await form('/oauth2/device', { client_id: s().clientId, scopes: SCOPES });
    if (!ok) throw new Error('Twitch no dio un código (' + (j.message || 'error') + '). Revisa en dev.twitch.tv que tu aplicación permita el inicio de sesión con código de dispositivo.');
    const v = vinculando[login] = { estado: 'esperando', codigo: j.user_code, url: j.verification_uri || 'https://www.twitch.tv/activate', expira: Date.now() + (Number(j.expires_in) || 1800) * 1000 };
    const intervalo = Math.max(2, Number(j.interval) || 5) * 1000;
    const preguntar = async () => {
      if (vinculando[login] !== v) return; // se canceló o se pidió otro código
      if (Date.now() > v.expira) { Object.assign(v, { estado: 'error', mensaje: 'El código venció: pide uno nuevo' }); return; }
      try {
        const campos = { client_id: s().clientId, scopes: SCOPES, device_code: j.device_code, grant_type: GRANT_DISPOSITIVO };
        let r = await form('/oauth2/token', campos);
        if (!r.ok && /client.?secret|invalid client/i.test(r.j.message || '') && s().clientSecret) r = await form('/oauth2/token', { ...campos, client_secret: s().clientSecret });
        if (!r.ok) {
          const msg = String(r.j.message || '');
          if (/authorization_pending|slow_down/i.test(msg)) return setTimeout(preguntar, intervalo * (/slow_down/i.test(msg) ? 2 : 1));
          Object.assign(v, { estado: 'error', mensaje: /denied/i.test(msg) ? 'La persona no aceptó el permiso' : 'Twitch no lo aceptó (' + msg + ')' });
          return;
        }
        // ¿Entró con la cuenta correcta? El device_code ya se canjeó: si esto falla no se vuelve a preguntar con él
        let u;
        try {
          const ru = await fetch(HELIX + '/users', { headers: { 'Client-Id': s().clientId, Authorization: 'Bearer ' + r.j.access_token }, signal: AbortSignal.timeout(15000) });
          if (!ru.ok) throw new Error('Twitch respondió ' + ru.status);
          u = (await ru.json()).data?.[0];
          if (!u) throw new Error('respuesta sin cuenta');
        } catch (e) {
          console.error(`[Automensajes] No se pudo leer la cuenta de ${login} tras autorizar: ${e.message}`);
          Object.assign(v, { estado: 'error', mensaje: 'Twitch autorizó pero no se pudo leer la cuenta (' + e.message + '): pide un código nuevo' });
          return;
        }
        if (u.login.toLowerCase() !== login) { Object.assign(v, { estado: 'error', mensaje: `Entró con la cuenta "${u.login}", y tenía que ser "${login}". Que cierre sesión en Twitch y pida un código nuevo.` }); return; }
        cuentas()[login] = { userId: u.id, nombre: u.display_name || u.login, accessToken: r.j.access_token, refreshToken: r.j.refresh_token || '', at: Date.now() };
        store.save();
        Object.assign(v, { estado: 'listo', mensaje: `✔ Vinculada: los mensajes que active ${u.display_name || u.login} salen con su cuenta` });
        console.log(`[Automensajes] 🔗 Cuenta de ${u.display_name || u.login} vinculada: el bot puede escribir con su nombre`);
      } catch (e) {
        console.error(`[Automensajes] Vincular ${login}: ${e.message} (se vuelve a intentar)`);
        setTimeout(preguntar, intervalo * 2); // sin internet un momento: sigue esperando
      }
    };
    setTimeout(preguntar, intervalo);
    return estado(login);
  }

  async function renovar(login) {
    const c = cuenta(login);
    if (!c?.refreshToken) throw new Error('sin permiso guardado');
    const base = { client_id: s().clientId, grant_type: 'refresh_token', refresh_token: c.refreshToken };
    let r = s().clientSecret ? await form('/oauth2/token', { ...base, client_secret: s().clientSecret }) : await form('/oauth2/token', base);
    if (!r.ok && s().clientSecret) r = await form('/oauth2/token', base);
    if (!r.ok) throw new Error('el permiso venció o lo quitaron');
    c.accessToken = r.j.access_token; c.refreshToken = r.j.refresh_token || c.refreshToken;
    store.save();
  }

  // Escribe en TU chat con la cuenta de "login". Devuelve true si Twitch lo aceptó.
  async function enviar(login, texto, responderA, reintento = true) {
    const c = cuenta(login);
    if (!c || !s().userId) return false;
    try {
      const r = await fetch(HELIX + '/chat/messages', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { 'Client-Id': s().clientId, Authorization: 'Bearer ' + c.accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcaster_id: s().userId, sender_id: c.userId, message: String(texto).slice(0, 450), ...(responderA ? { reply_parent_message_id: responderA } : {}) }),
      });
      if (r.status === 401 && reintento) { await renovar(login); return enviar(login, texto, responderA, false); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { console.error(`[Automensajes] Twitch no dejó escribir como ${c.nombre}: ${j.message || r.status}`); return false; }
      const d = j.data?.[0];
      if (d && d.is_sent === false) { console.error(`[Automensajes] El chat no aceptó el mensaje de ${c.nombre}: ${d.drop_reason?.message || 'sin motivo'}`); return false; }
      return true;
    } catch (e) {
      console.error(`[Automensajes] No se pudo escribir como ${c.nombre}: ${e.message}`);
      return false;
    }
  }

  const tiene = (login) => !!cuenta(String(login || '').toLowerCase());
  function estado(login) {
    const v = vinculando[login];
    return { login, vinculada: tiene(login), ...(v ? { estado: v.estado, codigo: v.estado === 'esperando' ? v.codigo : undefined, url: v.url, mensaje: v.mensaje, venceEnSeg: Math.max(0, Math.round((v.expira - Date.now()) / 1000)) } : {}) };
  }
  function cancelar(login) { delete vinculando[login]; }
  function quitar(login) {
    delete vinculando[login];
    if (cuentas()[login]) { delete cuentas()[login]; store.save(); console.log(`[Automensajes] Cuenta de ${login} desvinculada`); }
  }
  const resumen = () => Object.fromEntries(Object.entries(cuentas()).map(([k, c]) => [k, { nombre: c.nombre }]));

  return { empezar, enviar, tiene, estado, cancelar, quitar, resumen };
}

module.exports = { crearCuentas };

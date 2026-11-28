// Mini servidor HTTP sin dependencias (rutas, JSON, archivos estáticos y eventos en vivo SSE)
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function readBody(req, limit = 1024 * 1024, binario = false) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Cuerpo demasiado grande'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(binario ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createApp({ staticDir, guard } = {}) {
  const routes = [];
  const add = (method) => (pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    routes.push({ method, re, keys, handler });
  };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    req.path = url.pathname;
    req.query = Object.fromEntries(url.searchParams);
    res.json = (obj, status = 200) => {
      res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    res.send = (text, status = 200, type = MIME['.html']) => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(text);
    };
    res.redirect = (to) => {
      res.writeHead(302, { Location: to });
      res.end();
    };
    if (guard && !guard(req, res)) return;

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = req.path.match(r.re);
      if (!m) continue;
      req.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      try {
        if (req.method !== 'GET') {
          // archivos (ej. subir una canción): hasta 40 MB, sin convertir a texto
          if ((req.headers['content-type'] || '').includes('application/octet-stream')) { req.rawBuffer = await readBody(req, 40 * 1024 * 1024, true); req.body = {}; await r.handler(req, res); return; }
          req.rawBody = await readBody(req);
          const isJson = (req.headers['content-type'] || '').includes('application/json');
          req.body = {};
          if (isJson && req.rawBody) {
            try { req.body = JSON.parse(req.rawBody); } catch { return res.json({ error: 'JSON inválido' }, 400); }
          }
        }
        await r.handler(req, res);
      } catch (err) {
        console.error('[http]', err);
        if (!res.headersSent) res.json({ error: err.message }, 500);
      }
      return;
    }

    if (req.method === 'GET' && staticDir) {
      let file = path.normalize(path.join(staticDir, req.path));
      if (!file.startsWith(staticDir)) return res.send('No encontrado', 404, 'text/plain');
      if (!path.extname(file)) file += '.html';
      fs.readFile(file, (err, buf) => {
        if (err) return res.send('No encontrado', 404, 'text/plain; charset=utf-8');
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(buf);
      });
      return;
    }
    res.send('No encontrado', 404, 'text/plain; charset=utf-8');
  }

  return { get: add('GET'), post: add('POST'), delete: add('DELETE'), handle };
}

// Eventos en vivo (Server-Sent Events): el panel y el overlay los reciben al instante
// ---------- WebSocket mínimo (solo lo que necesitan los overlays: el reloj manda, el overlay escucha) ----------
const crypto = require('crypto');
function aceptarWs(req, sock) {
  const clave = req.headers['sec-websocket-key'];
  if (!clave || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return false; }
  const acepto = crypto.createHash('sha1').update(clave + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acepto}\r\n\r\n`);
  sock.setNoDelay(true);
  return true;
}
function enviarWs(sock, texto, op = 0x1) {
  if (sock.destroyed) return;
  const datos = Buffer.from(texto, 'utf8'), n = datos.length;
  const cab = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | op, 127, 0, 0, 0, 0]), Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])]);
  try { sock.write(Buffer.concat([cab, datos])); } catch {}
}
// Lee los cuadros que manda el navegador (solo importan cerrar y ping; el resto se descarta)
function leerWs(sock, alCuadro) {
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 2) {
      let largo = buf[1] & 127, pos = 2;
      if (largo === 126) { if (buf.length < 4) return; largo = buf.readUInt16BE(2); pos = 4; }
      else if (largo === 127) { if (buf.length < 10) return; largo = Number(buf.readBigUInt64BE(2)); pos = 10; }
      const conMascara = buf[1] & 128; if (conMascara) pos += 4;
      if (buf.length < pos + largo) return;
      const op = buf[0] & 15;
      buf = buf.subarray(pos + largo);
      alCuadro(op);
      if (largo > 1e6) { sock.destroy(); return; }
    }
  });
}

function createLive() {
  const clients = new Set();
  setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 15000);
  const live = {
    onChange: null, // se llama cuando se conecta o desconecta alguien
    // ¿Cuántos paneles del dueño abiertos en esta PC?
    ownerCount() {
      let n = 0;
      for (const res of clients) if (res.localOwner) n++;
      return n;
    },
    // mode: 'full' (dueño) · 'mod' (panel de mods) · 'overlay' (solo el reloj)
    // transform(type, payload) → lo que recibe ese cliente (ej. ocultar montos a un mod), o null para no enviarlo
    attach(req, res, initial, mode = 'full', transform = null) {
      res.mode = mode;
      res.user = req.user;
      res.transform = transform;
      res.localOwner = mode === 'full' && req.localOwner === true;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 1500\n\n');
      clients.add(res);
      if (initial) for (const [type, payload] of initial) res.write(`data: ${JSON.stringify({ type, payload })}\n\n`);
      live.onChange?.();
      req.on('close', () => {
        clients.delete(res);
        live.onChange?.();
      });
    },
    // Lo mismo por WebSocket (/vivo): los overlays de OBS lo usan porque el navegador de OBS permite solo
    // 6 conexiones abiertas a la vez contra el reloj, y con varios overlays las de más quedaban esperando.
    attachWs(sock, initial, mode = 'overlay') {
      const cli = {
        mode, transform: null, localOwner: false,
        write(msg) {
          if (msg.startsWith('data: ')) enviarWs(sock, msg.slice(6).trim());
          else if (msg.startsWith(': ping')) enviarWs(sock, '', 0x9); // mantiene viva la conexión
        },
        end() { try { sock.end(Buffer.from([0x88, 0])); } catch {} },
      };
      clients.add(cli);
      if (initial) for (const [type, payload] of initial) cli.write(`data: ${JSON.stringify({ type, payload })}\n\n`);
      live.onChange?.();
      const salir = () => { if (clients.delete(cli)) live.onChange?.(); };
      sock.on('close', salir); sock.on('error', salir);
      leerWs(sock, (op) => { if (op === 0x8) { cli.end(); salir(); } else if (op === 0x9) enviarWs(sock, '', 0xA); });
    },
    // Corta en vivo la conexión de un usuario al que se le quitó el acceso
    kick(user) {
      for (const res of clients) if (res.user === user) { res.end(); clients.delete(res); }
    },
    broadcast(type, payload) {
      const msg = `data: ${JSON.stringify({ type, payload })}\n\n`;
      // El overlay solo recibe el reloj y los "+tiempo"; los mods, además, el historial y los multiplicadores
      const forOverlay = type === 'state' || type === 'added' || type === 'sound' || type === 'shutdown' || type === 'aporte' || type === 'codigo' || type === 'hype' || type === 'podio' || type === 'recargar' || type === 'debug-revisar' || type === 'estilo';
      const forMod = forOverlay || type === 'log' || type === 'multiplier' || type === 'reset';
      for (const res of clients) {
        if (!(res.mode === 'overlay' ? forOverlay : res.mode === 'mod' ? forMod : true)) continue;
        if (!res.transform) {
          res.write(msg);
          continue;
        }
        const p = res.transform(type, payload);
        if (p !== null) res.write(`data: ${JSON.stringify({ type, payload: p })}\n\n`);
      }
    },
  };
  return live;
}

module.exports = { aceptarWs, createApp, createLive };

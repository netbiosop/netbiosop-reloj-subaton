// Lanzador del reloj (lo usan iniciar.bat y detener.bat)
//   node iniciar.js            → arranca el reloj en segundo plano y abre el panel
//   node iniciar.js --detener  → apaga el reloj que está corriendo
//
// Si ya hay un reloj corriendo de una versión anterior, lo apaga (el tiempo queda guardado)
// y arranca esta versión. Si algo falla, abre logs/errores.txt para ver el motivo.
//
// Al abrir (si el reloj no estaba funcionando) revisa en GitHub si hay una versión nueva y la instala
// sin tocar tus datos. node iniciar.js --actualizar-ahora → apaga el reloj, actualiza y lo vuelve a abrir.
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, spawnSync, exec } = require('child_process');

const DIR = __dirname;
const PORT = Number(process.env.PORT || 3000);
const BASE = `http://127.0.0.1:${PORT}`;
const VERSION = require('./package.json').version;
const LOG_DIR = path.join(DIR, 'logs');
const ERR_FILE = path.join(LOG_DIR, 'errores.txt');
const PID_FILE = path.join(process.env.DATA_DIR || path.join(DIR, 'data'), 'reloj.pid');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ¿El puerto está ocupado? (aunque el programa que lo ocupa no responda)
function portBusy() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(true));
    s.once('listening', () => s.close(() => resolve(false)));
    s.listen(PORT, '127.0.0.1');
  });
}
// Último recurso: cerrar el proceso anterior del reloj usando su número guardado
async function killStale() {
  let pid;
  try { pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim()); } catch { return false; }
  if (!pid || pid === process.pid) return false;
  // kill(pid, 0) solo pregunta si el proceso existe; si no existe, el archivo quedó viejo
  try { process.kill(pid, 0); } catch {
    try { fs.rmSync(PID_FILE, { force: true }); } catch (e) { console.warn('  (No se pudo borrar ' + PID_FILE + ': ' + e.message + ')'); }
    return false;
  }
  if (!(await portBusy())) return false; // el número existe pero no es el reloj: no se toca
  console.log(`  Cerrando un reloj anterior que no respondía (proceso ${pid})…`);
  try { process.kill(pid); } catch { /* ya terminó solo */ }
  for (let i = 0; i < 20; i++) {
    await wait(250);
    if (!(await portBusy())) return true;
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* ya terminó solo */ }
  await wait(500);
  return !(await portBusy());
}

function openUrl(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
function fail(msg) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(ERR_FILE, `\r\n[${new Date().toLocaleString()}] NO SE PUDO INICIAR EL RELOJ: ${msg}\r\n`);
  console.error('\n  ❌ ' + msg + '\n  Detalles en: ' + ERR_FILE + '\n');
  if (process.platform === 'win32') exec(`start "" notepad "${ERR_FILE}"`, () => {});
  process.exit(1);
}

// ¿Hay un reloj escuchando? → { version } | { old: true } | null
async function probe() {
  try {
    const r = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(1500) });
    if (r.ok) return await r.json();
    return { old: true }; // responde pero no conoce /api/version: versión anterior
  } catch {
    return null;
  }
}
async function shutdown() {
  try {
    await fetch(BASE + '/api/shutdown', { method: 'POST', signal: AbortSignal.timeout(3000) });
  } catch { /* el reloj corta la conexión al apagarse; abajo se confirma que cerró */ }
  for (let i = 0; i < 40; i++) {
    if (!(await probe())) return true;
    await wait(250);
  }
  return false;
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) {
    openUrl('https://nodejs.org');
    fail(`Tienes Node.js ${process.versions.node}. Necesitas la versión 22 o más nueva (LTS) desde https://nodejs.org`);
  }

  if (process.argv.includes('--detener')) {
    if (!(await probe())) {
      if (await killStale()) return console.log('  Reloj apagado.');
      return console.log('  El reloj no estaba encendido.');
    }
    if (await shutdown()) return console.log('  Reloj apagado. El tiempo quedó guardado.');
    console.log((await killStale()) ? '  Reloj apagado (a la fuerza).' : '  No se pudo apagar el reloj.');
    return;
  }

  // ---------- Actualización automática (solo al abrir; nunca con el reloj funcionando) ----------
  if (!process.argv.includes('--sin-actualizar')) {
    const forzar = process.argv.includes('--actualizar-ahora');
    if (forzar) { await wait(1500); if (await probe()) { console.log('  Apagando el reloj para actualizar (el tiempo queda guardado)…'); if (!(await shutdown())) await killStale(); } }
    if (!(await probe())) {
      let r = null;
      try { r = await require('./src/actualizador').alAbrir((t) => console.log(t), forzar); } catch (e) { console.log('  (Actualizador: ' + e.message + ')'); }
      if (r) {
        // arranca de nuevo con el lanzador nuevo (la versión cambió)
        const res = spawnSync(process.execPath, [__filename, '--sin-actualizar'], { cwd: DIR, stdio: 'inherit', env: process.env });
        process.exit(res.status || 0);
      }
    }
  }

  const running = await probe();
  if (running && running.version === VERSION) {
    console.log('  El reloj ya estaba funcionando. Abriendo el menú…');
    openUrl(`http://localhost:${PORT}/menu`);
    return;
  }
  if (running) {
    console.log(`  Hay un reloj de otra versión funcionando (${running.version || 'anterior'}). Apagándolo para abrir la ${VERSION}…`);
    if (!(await shutdown()) && !(await killStale())) fail(`Hay otro programa ocupando el puerto ${PORT} y no se pudo cerrar. Reinicia la PC o ciérralo desde el Administrador de tareas (proceso "Node.js").`);
  } else if (await portBusy()) {
    // El puerto está ocupado pero nadie responde: un reloj colgado
    if (!(await killStale())) fail(`El puerto ${PORT} está ocupado por otro programa. Ciérralo o reinicia la PC.`);
  }

  // Arranca el servidor en segundo plano, sin ventana
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const errFd = fs.openSync(ERR_FILE, 'a');
  const child = spawn(process.execPath, [path.join(DIR, 'server.js')], {
    cwd: DIR,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'ignore', errFd],
    env: { ...process.env, NO_OPEN: '1' },
  });
  let exited = null;
  child.on('exit', (code) => (exited = code));
  child.unref();

  // Espera a que responda y abre el panel
  for (let i = 0; i < 60; i++) {
    await wait(250);
    const r = await probe();
    if (r && r.version === VERSION) {
      // Si quedó abierta una pestaña del panel, se reconecta sola: no abrimos otra
      for (let k = 0; k < 10; k++) {
        await wait(500);
        const p = await fetch(BASE + '/api/panels').then((x) => x.json()).catch(() => ({ owners: 0 }));
        if (p.owners > 0) return console.log('  ⏱  Reloj funcionando. El panel que ya tenías abierto se reconectó.');
      }
      console.log('  ⏱  Reloj funcionando en segundo plano. Abriendo el menú…');
      openUrl(`http://localhost:${PORT}/menu`);
      return;
    }
    if (exited !== null) break;
  }
  const tail = fs.existsSync(ERR_FILE) ? fs.readFileSync(ERR_FILE, 'utf8').trim().split(/\r?\n/).slice(-6).join(' | ') : '';
  fail(`El reloj se cerró al arrancar${exited !== null ? ` (código ${exited})` : ''}. ${tail}`);
}

main().catch((err) => fail(err.message));

// Actualizador automático desde GitHub (github.com/netbiosop/netbiosop-reloj-subaton).
//  • Solo se usa al ABRIR el reloj (iniciar.bat), nunca en medio de un stream.
//  • Baja la versión nueva a una carpeta aparte, revisa que llegó completa y recién ahí reemplaza el programa.
//  • NUNCA toca tus datos: data (subs, bits, donaciones, podio, ajustes), logs, sonidos, videos, copias de seguridad.
//  • Guarda la versión anterior en ".version-anterior" por si hay que volver atrás.
const fs = require('fs');
const path = require('path');

const REPO = process.env.UPDATE_REPO || 'netbiosop/netbiosop-reloj-subaton';
const RAIZ = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(RAIZ, 'data');
const TMP = path.join(RAIZ, '.actualizacion');
const ANTERIOR = path.join(RAIZ, '.version-anterior');
const MARCA = path.join(DATA_DIR, 'actualizacion.json');
const API = process.env.UPDATE_API || 'https://api.github.com';
const RAW = process.env.UPDATE_RAW || 'https://raw.githubusercontent.com';
const HEADERS = { 'User-Agent': 'reloj-subaton-actualizador', Accept: 'application/vnd.github+json' };

// Lo que nunca se pisa ni se borra
const CARPETAS_PROTEGIDAS = new Set(['data', 'logs', 'sonidos', 'videos', 'node_modules', '.version-anterior', '.actualizacion', '.git']);
const LANZADORES = new Set(['iniciar.bat', 'detener.bat', 'iniciar-con-consola.bat', 'iniciar-silencioso.vbs', 'iniciar.sh']);
function protegido(rel) {
  const p = rel.replace(/\\/g, '/');
  return CARPETAS_PROTEGIDAS.has(p.split('/')[0]) || p === 'respaldo-config.json' || p === 'respaldo-github.json' || p.endsWith('.zip') || p.startsWith('.github/');
}

const versionLocal = () => { try { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; } };
function masNueva(a, b) { // ¿a es más nueva que b?
  const x = String(a).replace(/^v/, '').split('.').map(Number), y = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}
function autoActivado() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'subaton.json'), 'utf8')).settings?.actualizarAuto !== false; } catch { return true; }
}
async function pedir(url, ms = 8000) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`GitHub respondió ${r.status}`);
  return r;
}

// ¿Hay versión nueva? Mira el último cambio de la rama principal y su package.json → { version, tag, notas, url } o null
const RAMA = process.env.UPDATE_BRANCH || 'main';
async function buscar() {
  const c = await (await pedir(`${API}/repos/${REPO}/commits/${RAMA}`)).json();
  if (!c.sha) return null;
  const pk = JSON.parse(Buffer.from(await (await pedir(`${RAW}/${REPO}/${c.sha}/package.json`)).arrayBuffer()).toString('utf8'));
  const version = String(pk.version || '').replace(/^v/, '');
  if (!version) return null;
  const notas = String(c.commit?.message || '').split('\n').filter((l) => !/^(Co-Authored-By|Claude-Session):/i.test(l)).join('\n').trim().slice(0, 2000);
  return { version, tag: c.sha, notas, url: c.html_url, nueva: masNueva(version, versionLocal()) };
}

// Instala una versión: baja todo, verifica y reemplaza solo los archivos del programa
async function instalar(info, log = console.log) {
  const de = versionLocal();
  const arbol = await (await pedir(`${API}/repos/${REPO}/git/trees/${encodeURIComponent(info.tag)}?recursive=1`)).json();
  if (arbol.truncated) throw new Error('La lista de archivos llegó incompleta');
  const archivos = (arbol.tree || []).filter((f) => f.type === 'blob' && !protegido(f.path));
  if (!archivos.some((f) => f.path === 'server.js') || !archivos.some((f) => f.path === 'package.json')) throw new Error('La versión nueva no parece completa');

  // 1) bajar todo a una carpeta aparte y revisar que cada archivo llegó entero
  fs.rmSync(TMP, { recursive: true, force: true });
  let n = 0;
  for (const f of archivos) {
    const url = `${RAW}/${REPO}/${encodeURIComponent(info.tag)}/${f.path.split('/').map(encodeURIComponent).join('/')}`;
    const buf = Buffer.from(await (await pedir(url, 20000)).arrayBuffer());
    if (buf.length !== f.size) throw new Error(`El archivo ${f.path} llegó incompleto`);
    const dest = path.join(TMP, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    if (++n % 10 === 0) log(`  Bajando la versión ${info.version}… ${n}/${archivos.length}`);
  }
  const pk = JSON.parse(fs.readFileSync(path.join(TMP, 'package.json'), 'utf8'));
  if (String(pk.version) !== info.version) throw new Error('La versión bajada no coincide');

  // 2) guardar la versión actual por si hay que volver atrás
  fs.rmSync(ANTERIOR, { recursive: true, force: true });
  const cambiados = [], lanzadoresPendientes = [];
  for (const f of archivos) {
    const actual = path.join(RAIZ, f.path), nuevo = path.join(TMP, f.path);
    const igual = fs.existsSync(actual) && fs.readFileSync(actual).equals(fs.readFileSync(nuevo));
    if (igual) continue;
    if (fs.existsSync(actual)) { const b = path.join(ANTERIOR, f.path); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(actual, b); }
    cambiados.push(f.path);
  }
  // 3) reemplazar (los .bat que se están usando se cambian unos segundos después, al cerrarse esta ventana)
  for (const rel of cambiados) {
    if (LANZADORES.has(rel) && process.platform === 'win32') { lanzadoresPendientes.push(rel); continue; }
    const dest = path.join(RAIZ, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try { fs.chmodSync(dest, 0o644); } catch {}
    fs.copyFileSync(path.join(TMP, rel), dest);
  }
  if (lanzadoresPendientes.length) {
    const { spawn } = require('child_process');
    const cmds = lanzadoresPendientes.map((rel) => `copy /y "${path.join(TMP, rel)}" "${path.join(RAIZ, rel)}" >nul`).join(' & ');
    spawn('cmd.exe', ['/c', `ping -n 6 127.0.0.1 >nul & ${cmds}`], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
  } else fs.rmSync(TMP, { recursive: true, force: true });

  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(MARCA, JSON.stringify({ de, a: info.version, at: Date.now(), notas: info.notas, archivos: cambiados.length, visto: false }, null, 2)); } catch {}
  try { fs.mkdirSync(path.join(RAIZ, 'logs'), { recursive: true }); fs.appendFileSync(path.join(RAIZ, 'logs', 'actualizaciones.txt'), `[${new Date().toLocaleString('es')}] ${de} → ${info.version} (${cambiados.length} archivos)\r\n${info.notas ? info.notas.replace(/\n/g, '\r\n') + '\r\n' : ''}\r\n`); } catch {}
  return { de, a: info.version, archivos: cambiados.length };
}

// Lo que corre al abrir el reloj. Nunca frena el arranque: si no hay internet o GitHub falla, sigue con la versión que hay.
async function alAbrir(log = console.log, forzar = false) {
  if (!forzar && !autoActivado()) return null;
  let info;
  try { info = await buscar(); } catch (e) { log('  (No se pudo revisar si hay versión nueva: ' + e.message + ')'); return null; }
  if (!info || !info.nueva) return null;
  log(`  ⬆️  Hay una versión nueva: ${info.version} (tienes ${versionLocal()}). Actualizando…`);
  // copia de seguridad de los datos antes de actualizar (por las dudas; los datos no se tocan)
  try { require('./respaldo').respaldar('antes de actualizar', true); } catch {}
  try {
    const r = await instalar(info, log);
    log(`  ✅ Actualizado a la versión ${r.a} (${r.archivos} archivos). Tus datos quedaron igual.`);
    return r;
  } catch (e) {
    fs.rmSync(TMP, { recursive: true, force: true });
    log('  ⚠️ No se pudo actualizar (' + e.message + '). Sigue la versión ' + versionLocal() + '.');
    return null;
  }
}

function marca() { try { return JSON.parse(fs.readFileSync(MARCA, 'utf8')); } catch { return null; } }
function marcarVisto() { const m = marca(); if (m) { m.visto = true; try { fs.writeFileSync(MARCA, JSON.stringify(m, null, 2)); } catch {} } }

module.exports = { REPO, buscar, instalar, alAbrir, marca, marcarVisto, versionLocal, masNueva, protegido };

// Copia de seguridad silenciosa en un repositorio PRIVADO de GitHub (aparte del repositorio público del programa).
//  • No sale en el menú ni en la ventana: solo se configura en /respaldo-github (escribiendo la dirección a mano).
//  • Sube subs, bits, donaciones, podio, metas y ajustes. NUNCA sube claves, tokens ni contraseñas ("secrets").
//  • Cada copia es un commit: el historial de GitHub guarda todas las versiones anteriores.
//  • Lo que pasa queda solo en logs/respaldo-github.txt.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(RAIZ, 'data');
const LOG_DIR = process.env.LOG_DIR || path.join(RAIZ, 'logs');
const CONF = path.join(RAIZ, 'respaldo-github.json'); // fuera de "data", nunca se sube a ningún lado
const API = process.env.GH_BACKUP_API || 'https://api.github.com';
const ARCHIVOS = ['subaton.json', 'podio.json', 'codigo.json', 'hype.json', 'automensajes.json'];
const MIN_ENTRE_COPIAS = 5 * 60000; // como mucho una subida cada 5 minutos

let conf = { repo: '', token: '', rama: 'main' };
try { conf = { ...conf, ...JSON.parse(fs.readFileSync(CONF, 'utf8')) }; } catch {}
let estado = { ultima: null, error: '', subiendo: false };
let ultimoContenido = '', ultimaSubida = 0, pendiente = null;

function anotar(txt) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.appendFileSync(path.join(LOG_DIR, 'respaldo-github.txt'), `[${new Date().toLocaleString('es')}] ${txt}\r\n`); } catch {}
}
const configurado = () => !!(conf.repo && conf.token);

async function gh(method, ruta, body) {
  const r = await fetch(API + ruta, {
    method,
    headers: { Authorization: 'Bearer ' + conf.token, Accept: 'application/vnd.github+json', 'User-Agent': 'reloj-subaton-respaldo', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`GitHub ${r.status}: ${j.message || 'error'}`); e.status = r.status; throw e; }
  return j;
}

// Los archivos tal como se suben (subaton.json sin la parte de claves y contraseñas)
function leerArchivos() {
  const out = [];
  for (const f of ARCHIVOS) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); } catch { continue; }
    if (f === 'subaton.json') delete j.secrets;
    out.push({ path: 'datos/' + f, content: JSON.stringify(j, null, 2) + '\n' });
  }
  return out;
}

async function subir(motivo = 'automática') {
  if (!configurado() || estado.subiendo) return null;
  const archivos = leerArchivos();
  if (!archivos.length) return null;
  const huella = JSON.stringify(archivos);
  if (huella === ultimoContenido) return null; // nada cambió
  estado.subiendo = true;
  try {
    const repo = '/repos/' + conf.repo, rama = conf.rama || 'main';
    let base = null;
    try { base = (await gh('GET', `${repo}/git/ref/heads/${rama}`)).object.sha; }
    catch (e) { if (e.status !== 404 && e.status !== 409) throw e; }
    if (!base) { // repositorio vacío: el primer archivo crea la rama
      await gh('PUT', `${repo}/contents/LEEME.md`, { message: 'Copias de seguridad del Reloj Subatón', branch: rama,
        content: Buffer.from('# Copias de seguridad del Reloj Subatón\n\nLas guarda el reloj solo. Cada cambio es una versión: mira el historial ("History") de la carpeta `datos`.\n\nNo contiene claves ni contraseñas.\n').toString('base64') });
      base = (await gh('GET', `${repo}/git/ref/heads/${rama}`)).object.sha;
    }
    const commitBase = await gh('GET', `${repo}/git/commits/${base}`);
    const arbol = await gh('POST', `${repo}/git/trees`, { base_tree: commitBase.tree.sha, tree: archivos.map((a) => ({ path: a.path, mode: '100644', type: 'blob', content: a.content })) });
    if (arbol.sha === commitBase.tree.sha) { ultimoContenido = huella; return null; } // igual a lo que ya está en GitHub
    const commit = await gh('POST', `${repo}/git/commits`, { message: `Copia ${motivo} · ${new Date().toLocaleString('es')}`, tree: arbol.sha, parents: [base] });
    await gh('PATCH', `${repo}/git/refs/heads/${rama}`, { sha: commit.sha });
    ultimoContenido = huella; ultimaSubida = Date.now();
    estado.ultima = { at: Date.now(), motivo }; estado.error = '';
    anotar(`Copia subida (${motivo})`);
    return estado.ultima;
  } catch (e) {
    estado.error = e.message;
    anotar('No se pudo subir: ' + e.message);
    return null;
  } finally { estado.subiendo = false; }
}

// Pedido de copia: se junta con otros y sale como mucho una cada 5 minutos (al cerrar sale enseguida)
function pedir(motivo, ya = false) {
  if (!configurado()) return;
  clearTimeout(pendiente);
  const espera = ya ? 0 : Math.max(10000, ultimaSubida + MIN_ENTRE_COPIAS - Date.now());
  pendiente = setTimeout(() => { subir(motivo).catch(() => {}); }, espera);
}

function info() {
  return { configurado: configurado(), repo: conf.repo, rama: conf.rama || 'main', tieneToken: !!conf.token, ...estado, subiendo: undefined };
}
async function setConfig(b = {}) {
  const repo = String(b.repo ?? conf.repo).trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$|\/$/g, '');
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Escribe el repositorio como usuario/nombre, ej. netbiosop/reloj-respaldos');
  const token = b.desactivar ? '' : b.token ? String(b.token).trim() : conf.token;
  const prueba = { ...conf, repo, token };
  if (repo && token) {
    const viejo = conf; conf = prueba;
    try {
      const r = await gh('GET', '/repos/' + repo);
      if (!r.private) throw new Error('Ese repositorio es PÚBLICO: cualquiera vería tus datos. Hazlo privado (Settings → Change visibility) o usa otro.');
      if (r.permissions && !r.permissions.push) throw new Error('El token no tiene permiso para escribir en ese repositorio (Contents: Read and write)');
    } catch (e) { conf = viejo; throw e.status === 404 ? new Error('No encuentro ese repositorio con ese token: revisa el nombre y que el token tenga acceso a él') : e.status === 401 ? new Error('El token no es válido o venció') : e; }
  }
  conf = prueba;
  try { fs.writeFileSync(CONF, JSON.stringify(conf, null, 2)); } catch (e) { throw new Error('No se pudo guardar: ' + e.message); }
  anotar(repo && token ? `Configurado: ${repo}` : 'Desactivado');
  ultimoContenido = '';
  if (configurado()) await subir('al configurar');
  return info();
}

module.exports = { pedir, subir, info, setConfig };

// Copias de seguridad automáticas de los datos del reloj (subs, bits, donaciones, podio, ajustes).
//  • Se guardan FUERA de la carpeta del programa (por defecto en Documentos\Reloj Subaton - Respaldos),
//    así sobreviven aunque se borre o se reemplace la carpeta del reloj.
//  • Copia cada vez que entra una donación, sub o bits (si llegan varios juntos, una sola copia con todo),
//    al abrir, al terminar cada stream y al cerrar el reloj.
//  • Guarda las últimas 100 copias + 1 por día de los últimos 60 días. También copia los registros (logs).
//  • Al abrir: si falta un archivo o está dañado, lo recupera solo de la última copia buena.
const fs = require('fs');
const path = require('path');
const os = require('os');

const RAIZ = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(RAIZ, 'data');
const LOG_DIR = process.env.LOG_DIR || path.join(RAIZ, 'logs');
const CONF = path.join(RAIZ, 'respaldo-config.json'); // fuera de "data" a propósito
const ARCHIVOS = ['subaton.json', 'podio.json', 'codigo.json', 'hype.json', 'automensajes.json'];
const IMPORTANTES = ['subaton.json', 'podio.json'];
const RECIENTES = 100, DIAS = 60, ESPERA_SEG = 5;

function carpetaPorDefecto() {
  if (process.env.BACKUP_DIR) return process.env.BACKUP_DIR;
  const h = os.homedir();
  const cands = [path.join(h, 'OneDrive', 'Documentos'), path.join(h, 'OneDrive', 'Documents'), path.join(h, 'Documentos'), path.join(h, 'Documents')];
  const base = cands.find((c) => { try { return fs.statSync(c).isDirectory(); } catch { return false; } }) || path.join(h, 'Documents');
  return path.join(base, 'Reloj Subaton - Respaldos');
}

let conf = { carpeta: '', extra: '', on: true };
try { conf = { ...conf, ...JSON.parse(fs.readFileSync(CONF, 'utf8')) }; } catch {}
const carpetas = () => [conf.carpeta || carpetaPorDefecto(), conf.extra].filter(Boolean);
function guardarConf() { try { fs.writeFileSync(CONF, JSON.stringify(conf, null, 2)); } catch (e) { console.error('[Respaldo] No se pudo guardar la configuración:', e.message); } }

const sello = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};
const leeJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const valido = (f) => leeJSON(f) !== null;

function copias(base) {
  try {
    return fs.readdirSync(base).filter((n) => /^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d/.test(n))
      .filter((n) => { try { return fs.statSync(path.join(base, n)).isDirectory(); } catch { return false; } })
      .sort().reverse();
  } catch { return []; }
}

// ---------- Al abrir: recuperar archivos borrados o dañados ----------
function alInicio() {
  const recuperados = [];
  for (const f of ARCHIVOS) {
    const dest = path.join(DATA_DIR, f);
    const existe = fs.existsSync(dest);
    if (existe && valido(dest)) continue;
    // buscar la copia más nueva que esté sana
    let origen = null;
    for (const base of carpetas()) for (const c of copias(base)) { const p = path.join(base, c, f); if (fs.existsSync(p) && valido(p)) { origen = p; break; } }
    if (!origen) continue;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      if (existe) fs.renameSync(dest, dest + '.danado-' + sello());
      fs.copyFileSync(origen, dest);
      recuperados.push(`${f} (copia ${path.basename(path.dirname(origen))})`);
    } catch (e) { console.error('[Respaldo] No se pudo recuperar', f, '-', e.message); }
  }
  // restauración pedida desde el panel (se hace al reiniciar, antes de cargar los datos)
  const pedido = path.join(DATA_DIR, 'restaurar.json');
  const r = leeJSON(pedido);
  if (r && r.copia) {
    for (const base of carpetas()) {
      const dir = path.join(base, r.copia);
      if (!fs.existsSync(dir)) continue;
      for (const f of ARCHIVOS) {
        const src = path.join(dir, f), dest = path.join(DATA_DIR, f);
        if (!fs.existsSync(src) || !valido(src)) continue;
        try { if (fs.existsSync(dest)) fs.copyFileSync(dest, dest + '.antes-de-restaurar-' + sello()); fs.copyFileSync(src, dest); recuperados.push(`${f} (restaurado de ${r.copia})`); } catch (e) { console.error('[Respaldo]', e.message); }
      }
      break;
    }
    try { fs.unlinkSync(pedido); } catch {}
  }
  return recuperados;
}

// ---------- Hacer una copia ----------
let ultimaHuella = '', ultima = null;
function huella() {
  return ARCHIVOS.map((f) => { try { const s = fs.statSync(path.join(DATA_DIR, f)); return f + s.size + ':' + s.mtimeMs; } catch { return f + '-'; } }).join('|');
}
function respaldar(motivo = 'automática', forzar = false) {
  try { require('./respaldo-github').pedir(motivo); } catch {} // copia silenciosa en GitHub (si está configurada)
  if (!conf.on && !forzar) return null;
  const h = huella();
  if (!forzar && h === ultimaHuella) return null;
  const nombre = sello(), hechas = [];
  for (const base of carpetas()) {
    try {
      const dir = path.join(base, nombre);
      fs.mkdirSync(dir, { recursive: true });
      let n = 0;
      for (const f of ARCHIVOS) {
        const src = path.join(DATA_DIR, f);
        if (fs.existsSync(src) && valido(src)) { fs.copyFileSync(src, path.join(dir, f)); n++; }
      }
      fs.writeFileSync(path.join(dir, 'info.txt'), `Copia ${motivo} del Reloj Subatón · ${new Date().toLocaleString('es')}\nPara volver a esta copia: panel → Respaldos → Restaurar.\n`);
      if (!n) { fs.rmSync(dir, { recursive: true, force: true }); continue; }
      copiarLogs(base);
      limpiar(base);
      hechas.push(base);
    } catch (e) { console.error(`[Respaldo] No se pudo copiar en ${base}:`, e.message); }
  }
  if (hechas.length) { ultimaHuella = h; ultima = { at: Date.now(), nombre, motivo, carpetas: hechas }; console.log(`💾 Copia de seguridad (${motivo})`); }
  return ultima;
}
// los registros de cada stream: se copian los nuevos o los que crecieron
function copiarLogs(base) {
  try {
    const dest = path.join(base, 'logs'); fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!f.endsWith('.log')) continue;
      const a = path.join(LOG_DIR, f), b = path.join(dest, f);
      const sa = fs.statSync(a); let sb = null; try { sb = fs.statSync(b); } catch {}
      if (!sb || sb.size !== sa.size) fs.copyFileSync(a, b);
    }
  } catch {}
}
// deja las últimas 48 copias y una por día de los últimos 60 días
function limpiar(base) {
  const lista = copias(base), dias = new Set();
  const limite = Date.now() - DIAS * 86400000;
  lista.forEach((n, i) => {
    const dia = n.slice(0, 10), fecha = Date.parse(dia + 'T12:00:00');
    let queda = i < RECIENTES;
    if (!queda && !dias.has(dia) && fecha >= limite) queda = true;
    dias.add(dia);
    if (!queda) try { fs.rmSync(path.join(base, n), { recursive: true, force: true }); } catch {}
  });
}

// antesDeCopiar: lo pone el servidor para guardar en disco lo último antes de copiar
let antesDeCopiar = () => {}, timerAporte = null, aportesJuntos = 0;
function iniciar(guardar) {
  if (guardar) antesDeCopiar = guardar;
  setTimeout(() => { try { antesDeCopiar(); } catch {} respaldar('al abrir', true); }, 15000);
}
// cada donación, sub o bits: espera unos segundos por si llegan más juntos y hace una sola copia
function alAporte() {
  if (!conf.on) { try { antesDeCopiar(); require('./respaldo-github').pedir('aporte nuevo'); } catch {} return; }
  aportesJuntos++;
  clearTimeout(timerAporte);
  timerAporte = setTimeout(() => {
    const n = aportesJuntos; aportesJuntos = 0;
    try { antesDeCopiar(); } catch {}
    respaldar(n > 1 ? `${n} aportes nuevos` : 'aporte nuevo', true);
  }, ESPERA_SEG * 1000);
}

function info() {
  const base = carpetas()[0];
  return {
    on: conf.on, carpeta: base, porDefecto: !conf.carpeta, extra: conf.extra || '', ultima,
    copias: copias(base).slice(0, 80).map((n) => {
      const dir = path.join(base, n);
      const tam = ARCHIVOS.reduce((t, f) => { try { return t + fs.statSync(path.join(dir, f)).size; } catch { return t; } }, 0);
      let resumen = '';
      try { const p = leeJSON(path.join(dir, 'podio.json')); if (p && Array.isArray(p.events)) resumen = p.events.length + ' aportes en el podio'; } catch {}
      return { nombre: n, tam, resumen };
    }),
    total: copias(base).length,
  };
}
function setConfig(b = {}) {
  if ('on' in b) conf.on = !!b.on;
  for (const k of ['carpeta', 'extra']) if (k in b) {
    const v = String(b[k] || '').trim();
    if (v) { if (!path.isAbsolute(v)) throw new Error('Escribe la ruta completa de la carpeta (ej. D:\\Respaldos)'); fs.mkdirSync(v, { recursive: true }); }
    conf[k] = v;
  }
  guardarConf();
  return info();
}
function pedirRestaurar(copia) {
  if (!copias(carpetas()[0]).includes(copia) && !carpetas().some((b) => copias(b).includes(copia))) throw new Error('No encuentro esa copia');
  respaldar('antes de restaurar', true);
  fs.writeFileSync(path.join(DATA_DIR, 'restaurar.json'), JSON.stringify({ copia }));
}

module.exports = { alInicio, iniciar, alAporte, respaldar, info, setConfig, pedirRestaurar, carpetas };

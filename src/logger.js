// Guarda todo lo que pasa en archivos de texto dentro de la carpeta "logs".
// Un archivo por stream: se abre al iniciar (o al volver a estar en vivo) y se cierra cuando el stream termina.
const fs = require('fs');
const path = require('path');
const util = require('util');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const fileStamp = (d = new Date()) => stamp(d).replace(' ', '_').replace(/:/g, '-');

const logger = {
  dir: LOG_DIR,
  file: null,
  _orig: {},

  install() {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    for (const level of ['log', 'warn', 'error']) {
      this._orig[level] = console[level].bind(console);
      console[level] = (...args) => {
        this._orig[level](...args);
        this.write(level, util.format(...args));
      };
    }
    process.on('uncaughtException', (err) => {
      console.error('ERROR INESPERADO:', err.stack || err);
    });
    process.on('unhandledRejection', (err) => {
      console.error('ERROR INESPERADO (promesa):', err?.stack || err);
    });
  },

  open(title = 'Sesión iniciada') {
    this.file = path.join(LOG_DIR, `stream_${fileStamp()}.log`);
    fs.appendFileSync(this.file, `==================== ${title} · ${stamp()} ====================\n`);
  },

  write(level, text) {
    if (!this.file) this.open('Actividad fuera de stream');
    const tag = level === 'error' ? 'ERROR ' : level === 'warn' ? 'AVISO ' : '';
    const clean = String(text).replace(/^\s*\n/, '').trimEnd();
    if (!clean) return;
    try {
      fs.appendFileSync(this.file, `[${stamp()}] ${tag}${clean}\n`);
    } catch (err) {
      // No se puede anotar en el archivo: al menos que quede en la consola original
      this._orig.error?.('[Log] No se pudo escribir en', this.file, '-', err.message);
    }
  },

  // Cierra el archivo actual (fin del stream). El siguiente mensaje abre uno nuevo.
  close(summaryLines = []) {
    if (!this.file) return;
    const body = summaryLines.map((l) => `   ${l}`).join('\n');
    fs.appendFileSync(this.file, `${body ? body + '\n' : ''}==================== Fin · ${stamp()} ====================\n`);
    this.file = null;
  },

  latestFile() {
    if (this.file) return this.file;
    try {
      const files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith('.log')).sort();
      return files.length ? path.join(LOG_DIR, files[files.length - 1]) : null;
    } catch {
      return null;
    }
  },
};

module.exports = logger;

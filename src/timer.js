// Cuenta regresiva basada en una hora de fin (no se desfasa aunque la PC se trabe)
const EventEmitter = require('events');

class Timer extends EventEmitter {
  constructor(remainingMs) {
    super();
    this.stored = Math.max(0, remainingMs || 0);
    this.running = false;
    this.endsAt = null;
    this.ended = false;
    setInterval(() => this._tick(), 200);
  }

  get remainingMs() {
    return this.running ? Math.max(0, this.endsAt - Date.now()) : this.stored;
  }

  start() {
    if (this.running || this.stored <= 0) return false;
    this.endsAt = Date.now() + this.stored;
    this.running = true;
    this.ended = false;
    this._changed();
    return true;
  }

  pause() {
    if (!this.running) return false;
    this.stored = this.remainingMs;
    this.running = false;
    this.endsAt = null;
    this._changed();
    return true;
  }

  set(ms) {
    ms = Math.max(0, Math.round(ms));
    if (this.running) this.endsAt = Date.now() + ms;
    else this.stored = ms;
    if (ms > 0) this.ended = false;
    this._changed();
  }

  // Suma (o resta) tiempo respetando el tope. Devuelve los ms realmente sumados.
  add(ms, maxMs = 0) {
    const current = this.remainingMs;
    let next = Math.max(0, current + ms);
    if (ms > 0 && maxMs > 0) next = Math.min(next, Math.max(current, maxMs));
    this.set(next);
    return next - current;
  }

  snapshot() {
    return { remainingMs: this.remainingMs, running: this.running, ended: this.ended, serverNow: Date.now() };
  }

  _tick() {
    if (this.running && Date.now() >= this.endsAt) {
      this.running = false;
      this.stored = 0;
      this.endsAt = null;
      this.ended = true;
      this.emit('ended');
      this._changed();
    }
  }

  _changed() {
    this.emit('change', this.snapshot());
  }
}

module.exports = { Timer };

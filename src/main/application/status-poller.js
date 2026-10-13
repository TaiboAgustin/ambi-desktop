// Planificador del sondeo de estado.
//  - Una sola ejecución a la vez: un pedido durante una ejecución se encola (una vez).
//  - Aislamiento de errores: una excepción se registra y el ciclo sigue (antes lo cortaba para siempre).
//  - Dos ritmos: rápido con la ventana visible y lento en la bandeja.
const { nullLogger } = require('../adapters/logging/logger');

class StatusPoller {
  // task(mode): mode = 'full' (ventana visible) | 'light' (en bandeja). Puede ser async.
  constructor({ task, fastMs = 3000, slowMs = 15000, logger = nullLogger, setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { task, fastMs, slowMs, log: logger, setTimer, clearTimer });
    this.visible = true;
    this.running = false;
    this.queued = false;
    this.timer = null;
    this.stopped = true;
  }

  start() { this.stopped = false; this.runNow(); }

  stop() {
    this.stopped = true;
    this.clearTimer(this.timer);
    this.timer = null;
  }

  setVisible(visible) {
    const changed = visible !== this.visible;
    this.visible = visible;
    if (changed && visible) this.runNow(); // al mostrar la ventana, datos frescos ya
  }

  // Pide una ejecución inmediata (p. ej. después de una acción del usuario).
  runNow(delayMs = 0) {
    if (this.stopped) return;
    if (delayMs) { this.schedule(delayMs); return; }
    if (this.running) { this.queued = true; return; }
    this.run();
  }

  async run() {
    this.clearTimer(this.timer);
    this.timer = null;
    this.running = true;
    try {
      await this.task(this.visible ? 'full' : 'light');
    } catch (e) {
      this.log.error('falló el sondeo de estado', e);
    } finally {
      this.running = false;
      if (this.queued) { this.queued = false; this.run(); } else this.schedule(this.visible ? this.fastMs : this.slowMs);
    }
  }

  schedule(ms) {
    if (this.stopped) return;
    this.clearTimer(this.timer);
    this.timer = this.setTimer(() => this.runNow(), ms);
  }
}

module.exports = { StatusPoller };

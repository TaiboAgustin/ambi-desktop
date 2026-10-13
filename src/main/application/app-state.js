// Estado observable de la app: lo leen la UI (ventana y bandeja) y lo escriben los servicios.
const { EventEmitter } = require('events');

class AppState extends EventEmitter {
  constructor(initial = {}) {
    super();
    this.value = {
      remote: { state: 'idle', detail: '' },
      tv: { power: 'unknown', device: null, volume: null, muted: false, foreground: null, installed: {}, input: null },
      light: null,
      ambient: { on: false, sourceId: null, error: null },
      mirror: { state: 'idle', detail: '' },
      smartthings: { connected: false, label: null, error: null, needsReauth: false },
      ...initial,
    };
  }

  get() { return this.value; }

  // Mezcla superficial por sección y avisa solo si algo cambió.
  set(section, patch) {
    const prev = this.value[section];
    const next = patch === null ? null : (prev && typeof prev === 'object' && typeof patch === 'object' ? { ...prev, ...patch } : patch);
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    this.value = { ...this.value, [section]: next };
    this.emit('change', section, this.value);
  }
}

module.exports = { AppState };

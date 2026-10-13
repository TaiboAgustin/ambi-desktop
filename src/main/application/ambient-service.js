// Modo ambiente: la luz WiZ sigue los colores de la pantalla de la PC.
// El puerto de captura entrega colores ya calculados; acá se aplican a la lámpara y, al terminar,
// se la devuelve al estado previo.
const { dimmingFor, restoreCommands } = require('../domain/light');
const { nullLogger } = require('../adapters/logging/logger');

class AmbientService {
  /**
   * @param {object} deps
   * @param {import('./ports').LightPort} deps.light
   * @param {import('./ports').CapturePort} deps.capture
   * @param {object} deps.config   sección `ambient` viva ({ sourceId, maxDim })
   * @param {() => void} deps.save
   * @param {import('./app-state').AppState} deps.state
   */
  constructor({ light, capture, config, save, state, logger = nullLogger }) {
    Object.assign(this, { light, capture, config, save, state, log: logger });
    this.session = null; // { stop } de la captura activa
    this.saved = null;   // getPilot previo, para restaurar
  }

  get active() { return !!this.session; }

  async start({ sourceId, maxDim } = {}) {
    const source = sourceId || this.config.sourceId || (await this.capture.listScreens())[0]?.id;
    if (!source) throw new Error('No hay pantallas para seguir');
    if (maxDim) this.config.maxDim = maxDim;
    this.config.sourceId = source;
    this.save();

    this.session?.stop();
    if (!this.saved) this.saved = await this.light.getPilot();
    // Cada sesión solo se desactiva a sí misma: evita la carrera al cambiar de pantalla.
    const session = this.capture.startAmbient({
      sourceId: source,
      onColor: ({ r, g, b, level }) => {
        if (this.session !== session) return;
        this.light.fire({ state: true, r, g, b, dimming: dimmingFor(level, this.config.maxDim) });
      },
      onError: (message) => {
        if (this.session !== session) return;
        this.log.warn('captura del modo ambiente', message);
        this.stop().then(() => this.publish(message));
      },
    });
    this.session = session;
    this.publish(null);
  }

  setMaxDim(maxDim) {
    this.config.maxDim = maxDim;
    this.save();
  }

  async stop({ restore = true } = {}) {
    const session = this.session;
    this.session = null;
    session?.stop();
    const saved = this.saved;
    this.saved = null;
    if (restore) for (const cmd of restoreCommands(saved)) await this.light.set(cmd);
    this.publish(null);
  }

  publish(error) {
    this.state.set('ambient', { on: this.active, sourceId: this.config.sourceId, maxDim: this.config.maxDim, error });
  }
}

module.exports = { AmbientService };

// Modo ambiente: la luz sigue los colores de la pantalla de la PC.
// El puerto de captura entrega colores ya calculados; acá se envían a la luz (capacidad color-stream) y,
// al terminar, se la devuelve al estado previo.
const { dimmingFor, restoreCommands } = require('../domain/light');
const { CAP } = require('../domain/capabilities');
const { nullLogger } = require('../adapters/logging/logger');

class AmbientService {
  /**
   * @param {object} deps
   * @param {import('./device-manager').DeviceManager} deps.devices
   * @param {import('./ports').CapturePort} deps.capture
   * @param {object} deps.config   sección `ambient` viva ({ sourceId, maxDim })
   * @param {() => void} deps.save
   * @param {import('./app-state').AppState} deps.state
   */
  constructor({ devices, capture, config, save, state, logger = nullLogger }) {
    Object.assign(this, { devices, capture, config, save, state, log: logger });
    this.session = null; // { stop } de la captura activa
    this.saved = null;   // estado normalizado previo de la luz, para restaurarla
    this.target = null;  // luz controlada por la sesión
  }

  get active() { return !!this.session; }

  async start({ sourceId, maxDim } = {}) {
    const light = this.devices.get('light');
    if (!light) throw new Error('Todavía no se encontró la luz en la red');
    if (!this.devices.has('light', CAP.COLOR_STREAM)) throw new Error('Esta luz no soporta el modo ambiente');
    const source = sourceId || this.config.sourceId || (await this.capture.listScreens())[0]?.id;
    if (!source) throw new Error('No hay pantallas para seguir');
    if (maxDim) this.config.maxDim = maxDim;
    this.config.sourceId = source;
    this.save();

    this.session?.stop();
    if (!this.saved) this.saved = await light.status();
    this.target = light;
    // Cada sesión solo actúa mientras es la vigente: evita la carrera al cambiar de pantalla.
    const session = this.capture.startAmbient({
      sourceId: source,
      onColor: ({ r, g, b, level }) => {
        if (this.session !== session) return;
        light.stream({ state: true, r, g, b, dimming: dimmingFor(level, this.config.maxDim) });
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
    const light = this.target;
    this.saved = null;
    this.target = null;
    if (restore && light) for (const cmd of restoreCommands(saved)) await light.set(cmd);
    this.publish(null);
  }

  publish(error) {
    this.state.set('ambient', { on: this.active, sourceId: this.config.sourceId, maxDim: this.config.maxDim, error });
  }
}

module.exports = { AmbientService };

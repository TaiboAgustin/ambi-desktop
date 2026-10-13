// Casos de uso de la luz WiZ.
const { normalizePilot, lightCommand } = require('../domain/light');

class LightService {
  /**
   * @param {object} deps
   * @param {import('./ports').LightPort} deps.light
   * @param {import('./app-state').AppState} deps.state
   * @param {() => Promise<void>} deps.beforeManualChange  p. ej. apagar el modo ambiente
   */
  constructor({ light, state, beforeManualChange = async () => {} }) {
    Object.assign(this, { light, state, beforeManualChange });
  }

  async poll() {
    this.state.set('light', normalizePilot(await this.light.getPilot()));
  }

  // Un cambio manual (color, escena, encendido) toma el control de la luz.
  async set(params) {
    const cmd = lightCommand(params);
    await this.beforeManualChange();
    const ok = await this.light.set(cmd);
    if (ok) await this.poll();
    return ok;
  }

  async toggle() {
    const current = this.state.get().light;
    if (!current) return false;
    return this.set({ state: !current.on });
  }
}

module.exports = { LightService };

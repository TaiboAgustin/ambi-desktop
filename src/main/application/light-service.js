// Casos de uso de la luz, independientes de la marca.
const { lightCommand } = require('../domain/light');

class LightService {
  /**
   * @param {object} deps
   * @param {import('./device-manager').DeviceManager} deps.devices
   * @param {import('./app-state').AppState} deps.state
   * @param {() => Promise<void>} deps.beforeManualChange  p. ej. apagar el modo ambiente
   */
  constructor({ devices, state, beforeManualChange = async () => {} }) {
    Object.assign(this, { devices, state, beforeManualChange });
  }

  get light() { return this.devices.get('light'); }

  async poll() {
    const light = this.light;
    if (!light) {
      this.state.set('light', null);
      await this.devices.ensure('light');
      return;
    }
    this.state.set('light', await light.status());
  }

  // Un cambio manual (color, escena, encendido) toma el control de la luz.
  async set(params) {
    const cmd = lightCommand(params);
    const light = this.light;
    if (!light) throw new Error('Todavía no se encontró la luz en la red');
    await this.beforeManualChange();
    const ok = await light.set(cmd);
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
